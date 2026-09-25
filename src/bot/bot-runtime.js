import path from 'path';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { FileLogStore } from '../core/file-log-store.js';
import { ChatStore } from '../core/chat-store.js';
import { WriteBehindQueue } from '../core/write-behind-queue.js';
import { ensureDir, now } from '../core/utils.js';
import { getAccountSessionPath } from '../services/account-service.js';
import { normalizeGroupDoc } from './utils/group-normalizer.js';
import { extractMessage } from './utils/message-extractor.js';
import { handleNormal } from './modes/normal.js';
import { handleWatch } from './modes/watch.js';
import { handleIa } from './modes/ia.js';
import { useMongoDBAuthState } from './utils/mongo-auth-state.js';
import {
  handleAdminCommand,
  normalizeAdminCommandsConfig,
  normalizeGroupCommandSettings,
  renderGroupEventMessage,
} from '../services/admin-command-service.js';

function normalizeContactJid(value) {
  const raw = String(value || '').trim().split('/')[0];
  if (!raw) return '';
  const atIndex = raw.indexOf('@');
  if (atIndex === -1) return raw.split(':')[0];
  const user = raw.slice(0, atIndex).split(':')[0];
  const server = raw.slice(atIndex + 1).toLowerCase();
  return user && server ? `${user}@${server}` : '';
}

function sameContact(left, right) {
  const a = normalizeContactJid(left);
  const b = normalizeContactJid(right);
  if (!a || !b) return false;
  return a === b || a.split('@')[0] === b.split('@')[0];
}

export class BotRuntime {
  constructor({ accountId, collections, eventBus }) {
    this.accountId = accountId;
    this.collections = collections;
    this.eventBus = eventBus;
    this.sessionPath = getAccountSessionPath(accountId);
    this.authPath = path.join(this.sessionPath, 'auth');
    this.logger = new FileLogStore({ accountId, sessionPath: this.sessionPath, eventBus });
    this.chatStore = new ChatStore({ accountId, collections, eventBus });
    this.queue = new WriteBehindQueue({ collections, accountId, logger: this.logger });
    this.groupsById = new Map();
    this.groupMetadataCache = new Map();
    this.contactsMap = new Map();
    this.aiMemory = new Map();
    this.recentlyBanned = new Map();
    this.socket = null;
    this.config = null;
    this.status = 'stopped';
    this.qr = null;
    this.isStarting = false;
    this.isStopping = false;
    this.reconnectTimer = null;
    this.generation = 0;
    this.watchers = [];
    this.pollTimer = null;
    this.state = {
      ordenesRecibidas: 0,
      mensajesRespondidos: 0,
      independentLockGroupId: null,
      aiCooldowns: new Map(),
      notificationSent: false,
    };
    this.connectTime = null;
  }

  async init() {
    await ensureDir(this.sessionPath);
    await ensureDir(this.authPath);
    await this.logger.init();
    await this.chatStore.init();
    await this.reloadConfig();
    await this.reloadGroups();
    await this.loadCounter();
    await this.loadContacts();
    this.startWatchers();
  }

  async loadContacts() {
    if (!this.collections.contacts) return;
    const docs = await this.collections.contacts.find({ accountId: this.accountId }).toArray().catch(() => []);
    this.contactsMap.clear();
    for (const d of docs) {
      if (!d.id || !d.name) continue;
      for (const alias of [d.id, d.phoneNumber, d.lid].map(normalizeContactJid).filter(Boolean)) {
        this.contactsMap.set(alias, d);
      }
    }
    this.logger.info('runtime', 'Contactos cargados en memoria', { total: this.contactsMap.size });
  }

  saveContact(contactOrId, suppliedName) {
    const contact = typeof contactOrId === 'object' && contactOrId !== null
      ? contactOrId
      : { id: contactOrId, name: suppliedName };
    const sourceId = normalizeContactJid(contact.id);
    const phoneNumber = normalizeContactJid(
      contact.phoneNumber || (sourceId.endsWith('@s.whatsapp.net') || sourceId.endsWith('@c.us') ? sourceId : ''),
    );
    const lid = normalizeContactJid(contact.lid || (sourceId.endsWith('@lid') ? sourceId : ''));
    const id = phoneNumber || lid || sourceId;
    const name = String(
      contact.name || contact.notify || contact.verifiedName || contact.pushName || contact.pushname || suppliedName || '',
    ).trim();
    if (!id || !name || name === id || name === 'Bot') return;

    const entry = {
      id,
      name,
      ...(phoneNumber ? { phoneNumber } : {}),
      ...(lid ? { lid } : {}),
      updatedAt: Date.now(),
    };
    const aliases = [id, sourceId, phoneNumber, lid].filter(Boolean);
    const existing = aliases.map((alias) => this.contactsMap.get(alias)).find(Boolean);
    if (
      existing
      && existing.name === name
      && (existing.phoneNumber || '') === phoneNumber
      && (existing.lid || '') === lid
    ) return;
    for (const alias of aliases) this.contactsMap.set(alias, entry);
    this.directorySnapshot = null;
    this.collections.contacts?.updateOne(
      { accountId: this.accountId, id },
      {
        $set: {
          name,
          ...(phoneNumber ? { phoneNumber } : {}),
          ...(lid ? { lid } : {}),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    ).catch((error) => {
      this.logger.warn('contacts', 'No se pudo guardar un contacto', { id, error: error.message });
    });
  }

  async loadCounter() {
    const counter = await this.collections.counters.findOne({ accountId: this.accountId, name: 'OrdenesRecibidas' });
    this.state.ordenesRecibidas = Number(counter?.seq || 0);
  }

  async reloadConfig() {
    const oldRespuestas = this.config?.respuestas;
    const config = await this.collections.configs.findOne({ accountId: this.accountId });
    this.config = config || { accountId: this.accountId, activo: false, respuestas: false, modo: 'normal' };
    if (this.config.modo === 'flash') this.config.modo = 'normal';
    this.config.adminCommands = normalizeAdminCommandsConfig(this.config.adminCommands);

    if (!oldRespuestas && this.config.respuestas) {
      this.state.mensajesRespondidos = 0;
      this.logger.info('runtime', 'Respuestas globales activadas; reiniciando contador global de mensajes a 0');
    }
    return this.config;
  }

  async reloadGroups() {
    const groups = await this.collections.groups.find({ accountId: this.accountId }).toArray();
    this.groupsById.clear();
    this.directorySnapshot = null;
    for (const g of groups) {
      const parsed = normalizeGroupDoc(g);
      this.groupsById.set(parsed.groupId, parsed);
      if (parsed.metadata) this.groupMetadataCache.set(parsed.groupId, parsed.metadata);
    }
    this.logger.info('runtime', 'Grupos cargados en memoria', { total: this.groupsById.size });
  }

  startWatchers() {
    if (this.watchers.length || this.pollTimer) return;
    const watchCollection = (collection, name, onChange) => {
      try {
        const stream = collection.watch([{ $match: { 'fullDocument.accountId': this.accountId } }], { fullDocument: 'updateLookup' });
        stream.on('change', onChange);
        stream.on('error', (err) => {
          this.logger.warn('mongo', `Change stream ${name} falló; usando polling`, { error: err.message });
          this.startPollingFallback();
        });
        stream.on('close', () => this.logger.warn('mongo', `Change stream ${name} cerrado`));
        this.watchers.push(stream);
      } catch (err) {
        this.logger.warn('mongo', `No se pudo iniciar change stream ${name}; usando polling`, { error: err.message });
        this.startPollingFallback();
      }
    };

    watchCollection(this.collections.configs, 'configs', async (change) => {
      if (change.fullDocument?.accountId !== this.accountId) return;
      await this.reloadConfig();
      this.logger.info('config', 'Configuración recargada', { modo: this.config.modo, respuestas: this.config.respuestas });
    });

    try {
      const stream = this.collections.groups.watch([], { fullDocument: 'updateLookup' });
      stream.on('change', async (change) => {
        const full = change.fullDocument;
        if (full && full.accountId !== this.accountId) return;
        if (change.operationType === 'delete' || !full) {
          await this.reloadGroups();
          return;
        }
        const parsed = normalizeGroupDoc(full);
        this.groupsById.set(parsed.groupId, parsed);
        this.logger.info('groups', 'Grupo actualizado en memoria', { groupId: parsed.groupId });
      });
      stream.on('error', (err) => {
        this.logger.warn('mongo', 'Change stream groups falló; usando polling', { error: err.message });
        this.startPollingFallback();
      });
      this.watchers.push(stream);
    } catch (err) {
      this.logger.warn('mongo', 'No se pudo iniciar change stream groups; usando polling', { error: err.message });
      this.startPollingFallback();
    }
  }

  startPollingFallback() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      Promise.all([this.reloadConfig(), this.reloadGroups()]).catch((err) => {
        this.logger.warn('mongo', 'Polling de configuración falló', { error: err.message });
      });
    }, 5000);
    this.pollTimer.unref?.();
  }

  async updateStatus(status, extra = {}) {
    this.status = status;
    await this.collections.accounts.updateOne(
      { accountId: this.accountId },
      { $set: { status, updatedAt: now(), ...extra } },
    ).catch(() => null);
    await this.collections.configs.updateOne(
      { accountId: this.accountId },
      { $set: { estado: status, updatedAt: now(), ...(extra.qr !== undefined ? { qr: extra.qr } : {}) } },
    ).catch(() => null);
    this.eventBus.emit(`status:${this.accountId}`, this.getPublicStatus());
  }

  async start() {
    if (this.socket && ['connected', 'connecting', 'qr', 'starting', 'reconnecting'].includes(this.status)) {
      return this.getPublicStatus();
    }
    if (this.isStarting) return this.getPublicStatus();
    this.isStarting = true;
    this.isStopping = false;
    this.state.notificationSent = false;
    const myGeneration = ++this.generation;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    try {
      await this.collections.configs.updateOne({ accountId: this.accountId }, { $set: { activo: true, updatedAt: now() } });
      this.config.activo = true;
      this.startWatchers();
      const isReconnecting = (this.status === 'reconnecting');
      await this.updateStatus(isReconnecting ? 'reconnecting' : 'starting', { qr: null });

      const { state, saveCreds } = await useMongoDBAuthState(this.collections.whatsappSessions, this.accountId);
      // Use the internal Baileys version — fetchLatestBaileysVersion returns a version that WhatsApp
      // may reject with 408 (connectionLost) when the bundled Baileys is behind. Passing undefined
      // lets the library use its own hardcoded stable version.
      const versionInfo = await fetchLatestBaileysVersion().catch(() => ({ version: undefined, isLatest: false }));
      const version = versionInfo.version;
      this.logger.info('baileys', 'Iniciando socket', { version, latest: versionInfo.isLatest });

      // Create a dummy logger to suppress verbose Baileys logging and avoid disk/console clutter.
      const childLogger = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        child: () => childLogger
      };

      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, childLogger),
        },
        logger: childLogger,
        version,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        // Use the standard Baileys browser descriptor — custom names like 'IbotV2'
        // cause WhatsApp to reject the QR handshake with error 408 (connectionLost).
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        cachedGroupMetadata: async (jid) => {
          const cached = this.groupMetadataCache.get(jid);
          if (cached && Array.isArray(cached.participants)) return cached;
          return undefined;
        },
      });

      this.socket = sock;
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', (update) => this.handleConnectionUpdate(update, myGeneration).catch((err) => {
        this.logger.error('connection', 'Error procesando connection.update', { error: err.message });
      }));
      sock.ev.on('messages.upsert', (payload) => this.handleMessages(payload).catch((err) => {
        this.logger.error('messages', 'Error procesando messages.upsert', { error: err.message });
      }));
      sock.ev.on('groups.update', (updates) => {
        this.directorySnapshot = null;
        for (const update of updates) {
          const cached = this.groupMetadataCache.get(update.id);
          if (cached) {
            const merged = { ...cached, ...update };
            this.groupMetadataCache.set(update.id, merged);
            this.collections.groups.updateOne(
              { accountId: this.accountId, groupId: update.id },
              { $set: { metadata: merged, updatedAt: new Date() } }
            ).catch(() => null);
          }
        }
      });
      sock.ev.on('group-participants.update', (update) => {
        this.handleGroupParticipantsUpdate(update).catch((error) => {
          this.logger.warn('groups', 'No se pudo procesar un cambio de participantes', {
            groupId: update.id,
            error: error.message,
          });
        });
      });
      sock.ev.on('contacts.upsert', (contacts) => {
        for (const c of contacts) {
          const name = c.name || c.notify || c.verifiedName;
          if (c.id && name) this.saveContact(c);
        }
      });
      sock.ev.on('contacts.update', (updates) => {
        for (const c of updates) {
          const name = c.name || c.notify || c.verifiedName;
          if (c.id && name) this.saveContact(c);
        }
      });
      sock.ev.on('messaging-history.set', ({ contacts = [], chats = [], messages = [] }) => {
        this.logger.info('runtime', `Historial sincronizado: ${contacts.length} contactos, ${chats.length} chats, ${messages.length} mensajes`);
        for (const c of contacts) {
          const name = c.name || c.notify || c.verifiedName || c.pushname;
          if (c.id && name) this.saveContact(c);
        }
        for (const m of messages) {
          if (!m?.message) continue;
          const extracted = extractMessage(m);
          if (extracted.senderId && extracted.senderName) {
            this.saveContact(extracted.senderId, extracted.senderName);
          }
          if (this.config?.modo === 'watch') {
            this.recordChatMessage(extracted);
          }
        }
      });
      await this.updateStatus(isReconnecting ? 'reconnecting' : 'connecting');
      this.logger.info('runtime', 'Socket inicializado');
      return this.getPublicStatus();
    } catch (err) {
      await this.updateStatus('error', { lastError: err.message });
      this.logger.error('runtime', 'No se pudo iniciar bot', { error: err.message });
      throw err;
    } finally {
      this.isStarting = false;
    }
  }

  async handleConnectionUpdate({ connection, lastDisconnect, qr }, generation) {
    if (generation !== this.generation) return;
    if (qr) {
      const dataUrl = await QRCode.toDataURL(qr);
      this.qr = dataUrl;
      await this.collections.qrHistory.insertOne({ accountId: this.accountId, qr: dataUrl, createdAt: now() }).catch(() => null);
      await this.updateStatus('qr', { qr: dataUrl });
      this.logger.info('connection', 'QR generado');
      return;
    }
    if (connection === 'connecting') {
      const isReconnecting = (this.status === 'reconnecting');
      await this.updateStatus(isReconnecting ? 'reconnecting' : 'connecting');
      return;
    }
    if (connection === 'open') {
      this.qr = null;
      this.connectTime = Math.floor(Date.now() / 1000);
      await this.collections.qrHistory.deleteMany({ accountId: this.accountId }).catch(() => null);
      // Enviar notificación si está configurada antes de pasar al estado connected
      await this.sendConnectionNotification().catch((err) => {
        this.logger.error('connection', 'Error enviando notificación de conexión', { error: err.message });
      });
      await this.updateStatus('connected', { qr: null, phoneJid: this.socket?.user?.id || null, phoneName: this.socket?.user?.name || null });
      this.logger.info('connection', 'WhatsApp conectado', { user: this.socket?.user });
      
      // Pre-cargar la metadata de todos los grupos configurados en segundo plano
      for (const groupId of this.groupsById.keys()) {
        this.refreshGroupMetadata(groupId, true).catch(() => null);
      }
      return;
    }
    if (connection === 'close') {
      this.connectTime = null;
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut || code === 401;
      this.logger.warn('connection', 'Conexión cerrada', { code, loggedOut });
      if (this.isStopping || loggedOut) {
        if (loggedOut) {
            this.logger.warn('connection', 'Sesión invalidada (401). Se requiere nuevo inicio de sesión.');
            await this.logout();
            return;
        }
        await this.updateStatus('stopped', { qr: null });
        return;
      }
      await this.updateStatus('disconnected', { qr: null });
      await this.scheduleReconnect();
    }
  }

  async scheduleReconnect() {
    if (this.reconnectTimer || this.isStopping) return;
    const active = (await this.collections.configs.findOne({ accountId: this.accountId }))?.activo;
    if (!active) return;
    await this.updateStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.stopSocketOnly().finally(() => this.start().catch((err) => {
        this.logger.error('runtime', 'Reconexion fallida', { error: err.message });
      }));
    }, 2500);
    this.reconnectTimer.unref?.();
  }

  async sendConnectionNotification() {
    if (this.state.notificationSent) return;
    const notifyConfig = this.config?.connectionNotification;
    if (notifyConfig?.enabled && notifyConfig.groupId && notifyConfig.message) {
      this.logger.info('connection', 'Enviando notificación de conexión', { groupId: notifyConfig.groupId });
      await this.socket.sendMessage(notifyConfig.groupId, { text: notifyConfig.message });
      this.state.notificationSent = true;
    }
  }

  async handleMessages(payload) {
    const msgs = payload?.messages || [];
    const isHistory = payload?.type === 'append';
    for (const msg of msgs) {
      if (!msg?.message) continue;
      const msgStartTime = performance.now();
      const extracted = extractMessage(msg);

      if (extracted.senderId && extracted.senderName) {
        this.saveContact(extracted.senderId, extracted.senderName);
      }

      if (this.config?.modo === 'watch') {
        this.recordChatMessage(extracted);
        if (extracted.isGroup) {
          this.refreshGroupMetadata(extracted.groupId).catch(() => null);
        }
      }

      if (!extracted.isGroup) continue;

      // Ignore historical sync messages, messages sent before the bot connected, and messages older than 15 seconds
      if (isHistory) continue;
      if (this.connectTime && Number(extracted.messageTimestamp || 0) < this.connectTime) continue;
      const messageAge = Math.floor(Date.now() / 1000) - Number(extracted.messageTimestamp || 0);
      if (messageAge > 15) continue;

      const extractionTime = performance.now() - msgStartTime;
      this.refreshGroupMetadata(extracted.groupId).catch(() => null);
      const ctx = this.createModeContext();
      ctx.msgStartTime = msgStartTime;
      ctx.extractionTime = extractionTime;
      try {
        const commandHandled = await handleAdminCommand(extracted, ctx);
        if (commandHandled) continue;
        if (this.config.modo === 'watch') {
          handleWatch(extracted, ctx);
          continue;
        }
        if (this.config.modo === 'ia') await handleIa(extracted, ctx);
        else handleNormal(extracted, ctx);
      } catch (err) {
        this.logger.error('messages', 'Error en modo de bot', { groupId: extracted.groupId, error: err.message });
      }
    }
  }

  async getGroupMetadata(groupId) {
    const cached = this.groupMetadataCache.get(groupId);
    if (cached && Array.isArray(cached.participants)) return cached;
    if (!this.socket) return cached || null;
    const metadata = await this.socket.groupMetadata(groupId);
    this.groupMetadataCache.set(groupId, metadata);
    return metadata;
  }

  markBanned(groupId, participant) {
    const key = `${groupId}:${normalizeContactJid(participant)}`;
    this.recentlyBanned.set(key, Date.now() + 60_000);
  }

  unmarkBanned(groupId, participant) {
    const key = `${groupId}:${normalizeContactJid(participant)}`;
    this.recentlyBanned.delete(key);
  }

  consumeBanned(groupId, participant) {
    const key = `${groupId}:${normalizeContactJid(participant)}`;
    const expiresAt = this.recentlyBanned.get(key);
    this.recentlyBanned.delete(key);
    return Number(expiresAt || 0) > Date.now();
  }

  async handleGroupParticipantsUpdate(update) {
    this.directorySnapshot = null;
    const cached = this.groupMetadataCache.get(update.id);
    if (cached && Array.isArray(cached.participants)) {
      if (update.action === 'add') {
        for (const participant of update.participants) {
          if (!cached.participants.some((item) => item.id === participant)) {
            cached.participants.push({ id: participant, admin: null });
          }
        }
      } else if (update.action === 'remove') {
        cached.participants = cached.participants.filter((item) => !update.participants.includes(item.id));
      } else if (update.action === 'promote') {
        for (const participant of update.participants) {
          const item = cached.participants.find((entry) => entry.id === participant);
          if (item) item.admin = 'admin';
        }
      } else if (update.action === 'demote') {
        for (const participant of update.participants) {
          const item = cached.participants.find((entry) => entry.id === participant);
          if (item) item.admin = null;
        }
      }
      this.groupMetadataCache.set(update.id, cached);
      await this.collections.groups.updateOne(
        { accountId: this.accountId, groupId: update.id },
        { $set: { metadata: cached, updatedAt: new Date() } },
      ).catch(() => null);
    }

    if (!this.config?.adminCommands?.enabled) return;
    const group = this.groupsById.get(update.id);
    const settings = normalizeGroupCommandSettings(group?.commandSettings);
    if (!settings.enabled || !['add', 'remove'].includes(update.action)) return;

    const metadata = cached || await this.getGroupMetadata(update.id).catch(() => null);
    const groupName = metadata?.subject || group?.nombre || update.id;
    for (const participant of update.participants || []) {
      const removedByAdmin = update.action === 'remove'
        && update.author
        && !sameContact(update.author, participant);
      const bannedByCommand = update.action === 'remove' && this.consumeBanned(update.id, participant);
      if (removedByAdmin || bannedByCommand) continue;
      const template = update.action === 'add' ? settings.welcomeMessage : settings.farewellMessage;
      const text = renderGroupEventMessage(template, { userJid: participant, groupName });
      if (!text) continue;
      await this.socket?.sendMessage(update.id, { text, mentions: [participant] });
    }
  }

  recordChatMessage(extracted) {
    this.directorySnapshot = null;
    const cfg = this.groupsById.get(extracted.groupId);
    const cached = this.chatStore.groups.get(extracted.groupId);
    if (extracted.senderId && extracted.senderName) {
      this.saveContact(extracted.senderId, extracted.senderName);
    }
    this.chatStore.recordMessage({
      id: extracted.id,
      groupId: extracted.groupId,
      groupName: cfg?.nombre || cached?.subject || (extracted.isGroup ? extracted.groupId : 'Chat Privado / Watch'),
      senderId: extracted.senderId,
      senderName: extracted.senderName,
      fromMe: extracted.fromMe,
      text: extracted.text,
      mediaType: extracted.mediaType,
    });
  }

  async refreshGroupMetadata(groupId, force = false) {
    if (!this.socket) return;
    if (!force && this.groupMetadataCache.has(groupId)) {
      const cached = this.groupMetadataCache.get(groupId);
      if (cached && Array.isArray(cached.participants)) return;
    }
    try {
      const meta = await this.socket.groupMetadata(groupId);
      this.groupMetadataCache.set(groupId, meta);
      this.directorySnapshot = null;
      const normalized = {
        subject: meta.subject || groupId,
        description: meta.desc || '',
        owner: meta.owner || '',
        creation: meta.creation || null,
        participantCount: meta.participants?.length || meta.size || 0,
      };
      let pictureUrl = null;
      try { pictureUrl = await this.socket.profilePictureUrl(groupId, 'image'); } catch {
        // Algunos grupos no tienen foto o WhatsApp restringe su lectura.
      }
      await this.chatStore.upsertGroup(groupId, { ...normalized, pictureUrl });

      // Save full meta in main groups collection to persist across restarts
      await this.collections.groups.updateOne(
        { accountId: this.accountId, groupId },
        { $set: { metadata: meta, nombre: meta.subject || groupId, updatedAt: new Date() } }
      ).catch(() => null);
    } catch (err) {
      this.logger.debug('metadata', 'No se pudo obtener metadata del grupo', { groupId, error: err.message });
    }
  }

  createModeContext() {
    return {
      accountId: this.accountId,
      socket: this.socket,
      collections: this.collections,
      config: this.config,
      groupsById: this.groupsById,
      state: this.state,
      logger: this.logger,
      chatStore: this.chatStore,
      queue: this.queue,
      aiMemory: this.aiMemory,
      runtimeStatus: this.status,
      getGroupMetadata: (groupId) => this.getGroupMetadata(groupId),
      markBanned: (groupId, participant) => this.markBanned(groupId, participant),
      unmarkBanned: (groupId, participant) => this.unmarkBanned(groupId, participant),
    };
  }

  async stopSocketOnly() {
    const sock = this.socket;
    this.socket = null;
    if (!sock) return;
    try { sock.ev.removeAllListeners?.(); } catch {
      // El socket puede haberse cerrado antes de retirar los listeners.
    }
    try { sock.end?.(); } catch {
      // Finalizar un socket ya cerrado no requiere una segunda acción.
    }
  }

  async stop(reason = 'manual_stop') {
    this.isStopping = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    ++this.generation;
    await this.stopSocketOnly();

    // Close all MongoDB Change Streams to prevent resource leaks
    for (const watcher of this.watchers) {
      try { await watcher.close(); } catch { /* already closed */ }
    }
    this.watchers = [];

    // Stop polling fallback timer if active
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    await this.queue.flush().catch(() => null);
    this.qr = null;
    
    if (reason !== 'server_shutdown') {
      this.config.activo = false;
      this.config.respuestas = false;
      await this.collections.configs.updateOne(
        { accountId: this.accountId },
        { $set: { activo: false, respuestas: false, qr: null, estado: 'stopped', updatedAt: now() } },
      ).catch(() => null);
    } else {
      await this.collections.configs.updateOne(
        { accountId: this.accountId },
        { $set: { qr: null, estado: 'stopped', updatedAt: now() } },
      ).catch(() => null);
    }

    await this.updateStatus('stopped', { qr: null, stopReason: reason });
    this.isStopping = false;
    this.logger.info('runtime', 'Bot detenido sin borrar sesión', { reason });
  }

  async logout() {
    this.isStopping = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    ++this.generation;
    const sock = this.socket;
    this.socket = null;
    try { await sock?.logout?.(); } catch (err) { this.logger.warn('runtime', 'logout de Baileys falló', { error: err.message }); }
    await this.stopSocketOnly();

    // Close all MongoDB Change Streams to prevent resource leaks
    for (const watcher of this.watchers) {
      try { await watcher.close(); } catch { /* already closed */ }
    }
    this.watchers = [];
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    await this.collections.whatsappSessions.deleteMany({ accountId: this.accountId }).catch(() => null);
    await this.collections.configs.updateOne(
      { accountId: this.accountId },
      { $set: { activo: false, respuestas: false, qr: null, estado: 'logged_out', updatedAt: now() } },
    ).catch(() => null);
    await this.updateStatus('logged_out', { qr: null });
    this.isStopping = false;
    this.logger.warn('runtime', 'Sesión cerrada y auth eliminado');
  }

  getPublicStatus() {
    return {
      status: this.status,
      qr: this.qr || this.config?.qr || null,
      modo: this.config?.modo || 'normal',
      activo: !!this.config?.activo,
      respuestas: !!this.config?.respuestas,
      ordenesRecibidas: this.state.ordenesRecibidas,
      gruposConfigurados: this.groupsById.size,
    };
  }

  async hasSavedSession() {
    const doc = await this.collections.whatsappSessions.findOne({ accountId: this.accountId, key: 'creds' });
    return !!doc?.data;
  }
}
