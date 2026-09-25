import { EventBus } from './event-bus.js';
import { BotRuntime } from '../bot/bot-runtime.js';
import { normalizeAccountId } from './utils.js';

export class RuntimeRegistry {
  constructor({ collections }) {
    this.collections = collections;
    this.eventBus = new EventBus();
    this.runtimes = new Map();
  }

  async get(accountIdRaw) {
    const accountId = normalizeAccountId(accountIdRaw);
    if (this.runtimes.has(accountId)) return this.runtimes.get(accountId);
    const existing = await this.collections.accounts.findOne({ accountId });
    if (!existing) throw new Error('El bot del usuario no existe');
    const runtime = new BotRuntime({ accountId, collections: this.collections, eventBus: this.eventBus });
    await runtime.init();
    this.runtimes.set(accountId, runtime);

    // Solo reanudar sesiones que el usuario dejó activas. Consultar una pantalla
    // del panel nunca debe encender una cuenta detenida manualmente.
    const hasSession = await runtime.hasSavedSession();
    if (
      hasSession
      && runtime.config?.activo === true
      && !['connected', 'connecting', 'qr', 'starting', 'reconnecting'].includes(runtime.status)
    ) {
      runtime.start().catch((err) => {
        console.error(`[registry] Error auto-starting runtime for ${accountId}:`, err);
      });
    }

    return runtime;
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

  async stopAll(reason = 'stop_all') {
    const list = Array.from(this.runtimes.values());
    await Promise.allSettled(list.map((runtime) => runtime.stop(reason)));
  }
}
