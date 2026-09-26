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

  recordMessage(message) {
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
      preview: message.text || (message.mediaType ? this.mediaPreview(message.mediaType) : ''),
    };

    // Save to MongoDB in background
    this.collections.chatMessages.updateOne(
      { accountId: this.accountId, id: entry.id },
      { $set: entry, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    ).catch(() => null);

    this.upsertGroup(entry.groupId, {
      type: entry.type,
      subject: entry.groupName,
      lastMessagePreview: entry.preview,
      lastMessageAt: entry.ts,
    });

    this.eventBus?.emit(`chat-message:${this.accountId}`, entry);
    return entry;
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

  async readMessages(groupId, { limit = 200 } = {}) {
    await this.init();
    const max = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const rows = await this.collections.chatMessages
      .find({ accountId: this.accountId, groupId })
      .sort({ ts: -1 })
      .limit(max)
      .toArray();
    return rows.reverse();
  }

  async clear() {
    await this.collections.chatMessages.deleteMany({ accountId: this.accountId });
    await this.collections.chatGroups.deleteMany({ accountId: this.accountId });
    this.groups = new Map();
  }
}
