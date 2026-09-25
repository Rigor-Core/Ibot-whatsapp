import { EventBus } from './event-bus.js';
import { BotRuntime } from '../bot/bot-runtime.js';
import { normalizeAccountId } from './utils.js';

const ACTIVE_STATUSES = ['connected', 'connecting', 'qr', 'starting', 'reconnecting'];
const POLL_INTERVAL_MS = 5000;
const STREAM_RETRY_MIN_MS = 30000;
const STREAM_RETRY_MAX_MS = 5 * 60 * 1000;

export class RuntimeRegistry {
  constructor({ collections }) {
    this.collections = collections;
    this.eventBus = new EventBus();
    this.runtimes = new Map();
    this.loading = new Map();
    this.streams = [];
    this.streamsReady = 0;
    this.pollTimer = null;
    this.retryTimer = null;
    this.retryDelay = STREAM_RETRY_MIN_MS;
    this.closed = false;
    this.syncMode = 'idle';
  }

  async get(accountIdRaw) {
    const accountId = normalizeAccountId(accountIdRaw);
    if (this.runtimes.has(accountId)) return this.runtimes.get(accountId);
    // Evita crear dos runtimes si llegan peticiones simultáneas para la misma cuenta.
    if (!this.loading.has(accountId)) {
      this.loading.set(accountId, this.load(accountId).finally(() => this.loading.delete(accountId)));
    }
    return this.loading.get(accountId);
  }

  async load(accountId) {
    const existing = await this.collections.accounts.findOne({ accountId });
    if (!existing) throw new Error('La cuenta de WhatsApp no existe');
    const runtime = new BotRuntime({ accountId, collections: this.collections, eventBus: this.eventBus });
    await runtime.init();
    this.runtimes.set(accountId, runtime);
    this.startSync();

    // Solo reanudar sesiones vinculadas que el usuario dejó activas. Consultar
    // una pantalla del panel nunca debe encender una cuenta detenida manualmente.
    if (
      runtime.config?.activo === true
      && !ACTIVE_STATUSES.includes(runtime.status)
      && await runtime.hasSavedSession()
    ) {
      runtime.start().catch((err) => {
        console.error(`[registry] Error reanudando ${accountId}:`, err.message);
      });
    }
    return runtime;
  }

  // Al arrancar el servidor reanuda las cuentas que quedaron encendidas.
  async resumeActiveAccounts() {
    const configs = await this.collections.configs
      .find({ activo: true }, { projection: { accountId: 1 } })
      .toArray();
    for (const { accountId } of configs) {
      this.get(accountId)
        .then(() => console.log(`[registry] Cuenta cargada al arrancar: ${accountId}`))
        .catch((err) => console.error(`[registry] No se pudo cargar ${accountId}:`, err.message));
    }
  }

  isRunning(accountId) {
    return ACTIVE_STATUSES.includes(this.runtimes.get(accountId)?.status);
  }

  liveStatus(accountId) {
    return this.runtimes.get(accountId)?.status || 'stopped';
  }

  async start(accountId) {
    const runtime = await this.get(accountId);
    await runtime.start();
    return runtime.getPublicStatus();
  }

  async stop(accountId, reason = 'manual_stop') {
    const runtime = await this.get(accountId);
    await runtime.stop(reason);
    return runtime.getPublicStatus();
  }

  async logout(accountId) {
    const runtime = await this.get(accountId);
    await runtime.logout();
    return runtime.getPublicStatus();
  }

  // Quita un runtime de memoria (por ejemplo, al eliminar al usuario).
  forget(accountIdRaw) {
    this.runtimes.delete(normalizeAccountId(accountIdRaw));
  }

  async stopAll(reason = 'stop_all') {
    this.closed = true;
    this.stopSync();
    const list = Array.from(this.runtimes.values());
    await Promise.allSettled(list.map((runtime) => runtime.stop(reason)));
  }

  // ─── Sincronización de cambios de MongoDB ────────────────────────────────
  // Un change stream por colección para todas las cuentas; si el servidor no
  // los soporta (MongoDB sin replica set) se usa polling y se reintenta.

  startSync() {
    if (this.closed || this.streams.length || this.retryTimer) return;
    this.streamsReady = 0;
    const opened = this.openStream(this.collections.configs, 'configs', (change) => this.onConfigChange(change));
    if (opened) this.openStream(this.collections.groups, 'groups', (change) => this.onGroupChange(change));
  }

  openStream(collection, name, onChange) {
    let stream;
    try {
      stream = collection.watch(
        [{ $match: { operationType: { $in: ['insert', 'update', 'replace', 'delete'] } } }],
        { fullDocument: 'updateLookup' },
      );
    } catch (err) {
      this.onStreamFailure(name, err);
      return false;
    }
    stream.on('init', () => {
      this.streamsReady += 1;
      if (this.streamsReady >= 2) {
        this.retryDelay = STREAM_RETRY_MIN_MS;
        this.setSyncMode('change-streams');
      }
    });
    stream.on('change', (change) => {
      Promise.resolve(onChange(change)).catch((err) => {
        console.error(`[registry] Error aplicando cambio de ${name}:`, err.message);
      });
    });
    stream.on('error', (err) => this.onStreamFailure(name, err));
    this.streams.push(stream);
    return true;
  }

  onStreamFailure(name, err) {
    if (this.closed || this.retryTimer) return;
    const seconds = Math.round(this.retryDelay / 1000);
    console.warn(`[registry] Change stream ${name} no disponible; usando polling y reintentando en ${seconds} s (${err.message})`);
    this.closeStreams();
    this.setSyncMode('polling');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.startSync();
    }, this.retryDelay);
    this.retryTimer.unref?.();
    this.retryDelay = Math.min(this.retryDelay * 2, STREAM_RETRY_MAX_MS);
  }

  setSyncMode(mode) {
    this.syncMode = mode;
    if (mode === 'polling' && !this.pollTimer) {
      this.pollTimer = setInterval(() => this.pollAll(), POLL_INTERVAL_MS);
      this.pollTimer.unref?.();
    }
    if (mode !== 'polling' && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  pollAll() {
    for (const runtime of this.runtimes.values()) {
      Promise.all([runtime.reloadConfig(), runtime.reloadGroups()]).catch((err) => {
        console.warn(`[registry] Polling de ${runtime.accountId} falló:`, err.message);
      });
    }
  }

  closeStreams() {
    const streams = this.streams;
    this.streams = [];
    this.streamsReady = 0;
    for (const stream of streams) {
      stream.removeAllListeners();
      stream.on('error', () => null);
      stream.close().catch(() => null);
    }
  }

  stopSync() {
    this.closeStreams();
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.setSyncMode('idle');
  }

  async onConfigChange(change) {
    const accountId = change.fullDocument?.accountId;
    const runtime = accountId && this.runtimes.get(accountId);
    if (runtime) await runtime.reloadConfig();
  }

  async onGroupChange(change) {
    if (change.operationType === 'delete') {
      const docId = String(change.documentKey?._id || '');
      for (const runtime of this.runtimes.values()) {
        if (runtime.ownsGroupDocument(docId)) await runtime.reloadGroups();
      }
      return;
    }
    const doc = change.fullDocument;
    const runtime = doc?.accountId && this.runtimes.get(doc.accountId);
    if (runtime) runtime.applyGroupDocument(doc);
  }
}
