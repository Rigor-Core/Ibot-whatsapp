// Qué guarda cada cuenta de sus chats y cuándo se borra solo.
export const RETENTION_DAYS = Object.freeze([0, 1, 3, 7, 15, 30, 90, 180, 365]);
export const RETENTION_SCOPES = Object.freeze(['all', 'groups', 'contacts', 'selected']);
export const CLEAR_SCOPES = Object.freeze(['all', 'groups', 'contacts', 'chats']);
const MAX_CHAT_LIST = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const JANITOR_INTERVAL_MS = 60 * 60 * 1000;

const GROUP_FILTER = { $regex: '@g\\.us$' };
const CONTACT_FILTER = { $not: /@g\.us$/ };

function chatList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((jid) => String(jid || '').trim()).filter((jid) => /@(g\.us|s\.whatsapp\.net|lid)$/.test(jid)))]
    .slice(0, MAX_CHAT_LIST);
}

export function normalizeStorageConfig(raw = {}) {
  const retentionDays = Number(raw?.retentionDays);
  return {
    // Qué se guarda de los mensajes nuevos.
    saveText: raw?.saveText !== false,
    saveImages: raw?.saveImages !== false,
    saveStickers: raw?.saveStickers !== false,
    // Chats de los que nunca se guarda nada.
    excludedChats: chatList(raw?.excludedChats),
    // Borrado automático de mensajes antiguos (0 = nunca).
    retentionDays: RETENTION_DAYS.includes(retentionDays) ? retentionDays : 0,
    retentionScope: RETENTION_SCOPES.includes(raw?.retentionScope) ? raw.retentionScope : 'all',
    retentionChats: chatList(raw?.retentionChats),
  };
}

// Filtro de chats de un alcance: todos, solo grupos, solo contactos o una lista.
function chatFilter(scope, chatIds = []) {
  if (scope === 'groups') return GROUP_FILTER;
  if (scope === 'contacts') return CONTACT_FILTER;
  if (scope === 'chats' || scope === 'selected') return { $in: chatList(chatIds) };
  return null;
}

export class StorageService {
  constructor({ collections, registry, media }) {
    this.collections = collections;
    this.registry = registry;
    this.media = media;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.applyRetention().catch((error) => {
      console.error('[storage] Error en la limpieza automática:', error.message);
    }), JANITOR_INTERVAL_MS);
    this.timer.unref?.();
    setTimeout(() => this.applyRetention().catch(() => null), 60_000).unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  // Borra los mensajes más antiguos que el plazo que eligió cada cuenta y los
  // archivos subidos que nunca se usaron.
  async applyRetention() {
    if (this.running) return;
    this.running = true;
    try {
      await this.releaseStaleUploads();
      const configs = await this.collections.configs
        .find({ 'storage.retentionDays': { $gt: 0 } }, { projection: { accountId: 1, storage: 1 } })
        .toArray();
      for (const config of configs) {
        const storage = normalizeStorageConfig(config.storage);
        if (!storage.retentionDays) continue;
        if (storage.retentionScope === 'selected' && !storage.retentionChats.length) continue;
        const result = await this.clear(config.accountId, {
          scope: storage.retentionScope,
          chatIds: storage.retentionChats,
          olderThanDays: storage.retentionDays,
        });
        if (result.messages) {
          const runtime = this.registry.runtimes.get(config.accountId);
          runtime?.logger.info('storage', 'Limpieza automática de chats', { mensajes: result.messages, dias: storage.retentionDays });
        }
      }
    } finally {
      this.running = false;
    }
  }

  // Imágenes subidas para enviar o programar que quedaron sin uso (por
  // ejemplo, si se cerró la ventana sin programar el mensaje).
  async releaseStaleUploads() {
    const stale = await this.collections.media
      .find({ origin: 'upload', createdAt: { $lt: new Date(Date.now() - DAY_MS) } }, { projection: { accountId: 1 } })
      .limit(500)
      .toArray();
    const byAccount = new Map();
    for (const doc of stale) {
      if (!byAccount.has(doc.accountId)) byAccount.set(doc.accountId, []);
      byAccount.get(doc.accountId).push(String(doc._id));
    }
    for (const [accountId, ids] of byAccount) await this.media.releaseUnused(accountId, ids);
  }

  // Vacía mensajes (o solo sus imágenes y stickers) de todos los chats, de un
  // tipo de chat o de chats concretos, opcionalmente solo los más antiguos.
  async clear(accountId, { scope = 'all', chatIds = [], olderThanDays = 0, mediaOnly = false } = {}) {
    const filter = { accountId };
    const chats = chatFilter(scope, chatIds);
    if (chats) filter.groupId = chats;
    if (scope === 'chats' && !chats.$in.length) return { messages: 0, media: 0 };
    if (olderThanDays > 0) filter.ts = { $lt: Date.now() - olderThanDays * DAY_MS };

    const withMedia = await this.collections.chatMessages
      .find({ ...filter, mediaId: { $type: 'string' } }, { projection: { mediaId: 1 } })
      .toArray();
    const mediaIds = withMedia.map((row) => row.mediaId);
    let messages = 0;
    if (mediaOnly) {
      await this.collections.chatMessages.updateMany({ ...filter, mediaId: { $type: 'string' } }, { $unset: { mediaId: '' } });
    } else {
      messages = (await this.collections.chatMessages.deleteMany(filter)).deletedCount || 0;
      if (!olderThanDays) await this.resetPreviews(accountId, chats);
    }
    const media = await this.media.releaseUnused(accountId, mediaIds);
    return { messages, media };
  }

  // Tras vaciar chats por completo, su vista previa ya no corresponde.
  async resetPreviews(accountId, chats) {
    const filter = { accountId, ...(chats ? { groupId: chats } : {}) };
    await this.collections.chatGroups.updateMany(filter, { $set: { lastMessagePreview: '' } });
    const runtime = this.registry.runtimes.get(accountId);
    if (!runtime) return;
    for (const group of runtime.chatStore.groups.values()) {
      const matches = !chats
        || (chats.$in ? chats.$in.includes(group.groupId) : (chats === GROUP_FILTER) === group.groupId.endsWith('@g.us'));
      if (matches) group.lastMessagePreview = '';
    }
  }

  async usage(accountId) {
    const [messages, groupMessages, chats, media, library] = await Promise.all([
      this.collections.chatMessages.countDocuments({ accountId }),
      this.collections.chatMessages.countDocuments({ accountId, groupId: GROUP_FILTER }),
      this.collections.chatGroups.countDocuments({ accountId }),
      this.media.usage(accountId),
      this.collections.stickers.countDocuments({ accountId }),
    ]);
    return {
      messages,
      groupMessages,
      contactMessages: messages - groupMessages,
      chats,
      images: media.image,
      stickers: media.sticker,
      library,
    };
  }
}
