export class ChatStore {
  constructor({ accountId, collections, eventBus }) {
    this.accountId = accountId;
    this.collections = collections;
    this.eventBus = eventBus;
    this.groups = new Map();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      const docs = await this.collections.chatGroups.find({ accountId: this.accountId }).toArray();
      this.groups = new Map(docs.map((g) => [g.groupId, g]));
      this.initialized = true;
    } catch {
      // Ignorar errores o reintentar en próxima llamada
    }
  }

  upsertGroup(groupId, data = {}) {
    const existing = this.groups.get(groupId) || { groupId, accountId: this.accountId };
    const createdAtVal = existing.createdAt || data.createdAt || Date.now();
    // eslint-disable-next-line no-unused-vars
    const { _id, createdAt: _exCreated, ...existingClean } = existing;
    // eslint-disable-next-line no-unused-vars
    const { _id: _dataId, createdAt: _dataCreated, ...dataClean } = data;
    const merged = {
      ...existingClean,
      ...dataClean,
      groupId,
      accountId: this.accountId,
      createdAt: createdAtVal,
      updatedAt: Date.now(),
    };
    this.groups.set(groupId, merged);

    // Persist to MongoDB in background — exclude _id and createdAt from $set so they never conflict with immutable fields or $setOnInsert
    // eslint-disable-next-line no-unused-vars
    const { _id: _ignoreId, createdAt: _ignoreCreated, ...setPayload } = merged;
    this.collections.chatGroups.updateOne(
      { accountId: this.accountId, groupId },
      { $set: setPayload, $setOnInsert: { createdAt: merged.createdAt } },
      { upsert: true }
    ).catch((err) => {
      console.error(`[ChatStore] Error en upsertGroup para ${groupId}:`, err.message);
    });

    this.eventBus?.emit(`chat-groups:${this.accountId}`, merged);
    return merged;
  }

  mediaPreview(mediaType) {
    const map = {
      image: 'Se envió una foto',
      video: 'Se envió un video',
      audio: 'Se envió un audio',
      sticker: 'Se envió un sticker',
      document: 'Se envió un documento',
      contact: 'Se envió un contacto',
      location: 'Se envió una ubicación',
    };
    return map[mediaType] || 'Se envió un mensaje multimedia';
  }

  // Registra un mensaje. Con persist=false solo actualiza la lista de chats y la
  // vista en vivo (el usuario eligió no guardar ese tipo de mensajes).
  recordMessage(message, { persist = true } = {}) {
    const entry = {
      ts: Date.now(),
      iso: new Date().toISOString(),
      accountId: this.accountId,
      id: message.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      groupId: message.groupId,
      groupName: message.groupName || this.groups.get(message.groupId)?.subject || message.groupId,
      type: message.type || (String(message.groupId).endsWith('@g.us') ? 'group' : 'contact'),
      senderId: message.senderId || '',
      senderName: message.senderName || '',
      fromMe: !!message.fromMe,
      text: message.text || '',
      mediaType: message.mediaType || null,
      // Quién envió un mensaje propio: bot (IA/comandos), panel o programado.
      origin: message.origin || null,
      preview: message.preview || message.text || (message.mediaType ? this.mediaPreview(message.mediaType) : ''),
    };

    if (persist) {
      this.collections.chatMessages.updateOne(
        { accountId: this.accountId, id: entry.id },
        { $set: entry, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      ).catch(() => null);
    }

    this.upsertGroup(entry.groupId, {
      type: entry.type,
      subject: entry.groupName,
      lastMessagePreview: entry.preview,
      lastMessageAt: entry.ts,
    });

    this.eventBus?.emit(`chat-message:${this.accountId}`, entry);
    return entry;
  }

  // Asocia la imagen o el sticker descargado a su mensaje y avisa al panel.
  attachMedia(messageId, groupId, media) {
    this.collections.chatMessages.updateOne(
      { accountId: this.accountId, id: messageId },
      { $set: { mediaId: media.id, mediaMime: media.mime } },
    ).catch(() => null);
    this.eventBus?.emit(`chat-media:${this.accountId}`, { id: messageId, groupId, mediaId: media.id, mediaType: media.kind });
  }

  // Lista de chats (grupos y/o contactos) ordenada por el último mensaje.
  async listGroups({ q, type, limit = 500 } = {}) {
    const query = String(q || '').trim();
    const filter = { accountId: this.accountId };
    if (type === 'group') filter.groupId = { $regex: '@g\\.us$' };
    if (type === 'contact') filter.groupId = { $not: /@g\.us$/ };

    if (query) {
      // Escape regex special characters for safe literal search
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { subject: { $regex: escaped, $options: 'i' } },
        { groupId: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
      ];
    }

    const maxResults = Math.min(Math.max(Number(limit) || 500, 1), 1000);
    const rows = await this.collections.chatGroups
      .find(filter)
      .sort({ lastMessageAt: -1 })
      .limit(maxResults)
      .toArray();

    // Refresh in-memory cache with the fetched results
    for (const row of rows) {
      this.groups.set(row.groupId, row);
    }

    return rows;
  }

  // Mensajes de un chat en orden cronológico. before/after (ms) permiten
  // paginar hacia atrás o leer solo lo posterior a una fecha.
  async readMessages(groupId, { limit = 200, before, after } = {}) {
    await this.init();
    const max = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const filter = { accountId: this.accountId, groupId };
    const ts = {};
    if (Number(before) > 0) ts.$lt = Number(before);
    if (Number(after) > 0) ts.$gt = Number(after);
    if (Object.keys(ts).length) filter.ts = ts;
    const rows = await this.collections.chatMessages
      .find(filter, { projection: { _id: 0, accountId: 0, iso: 0 } })
      .sort({ ts: -1 })
      .limit(max)
      .toArray();
    return rows.reverse();
  }

  // Busca texto en el historial (todos los chats o algunos), del más reciente al más antiguo.
  async searchMessages({ q, chatIds, since, until, fromMe, sender, limit = 30 } = {}) {
    const filter = { accountId: this.accountId };
    const words = String(q || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
    if (words.length) {
      filter.$and = words.map((word) => ({ text: { $regex: word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }));
    }
    if (Array.isArray(chatIds) && chatIds.length) filter.groupId = { $in: chatIds };
    const ts = {};
    if (Number(since) > 0) ts.$gte = Number(since);
    if (Number(until) > 0) ts.$lte = Number(until);
    if (Object.keys(ts).length) filter.ts = ts;
    if (typeof fromMe === 'boolean') filter.fromMe = fromMe;
    if (sender) {
      const escaped = String(sender).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ senderName: { $regex: escaped, $options: 'i' } }, { senderId: { $regex: escaped, $options: 'i' } }];
    }
    return this.collections.chatMessages
      .find(filter, { projection: { _id: 0, accountId: 0, iso: 0 } })
      .sort({ ts: -1 })
      .limit(Math.min(Math.max(Number(limit) || 30, 1), 200))
      .toArray();
  }
}
