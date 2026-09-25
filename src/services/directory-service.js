const DIRECTORY_CACHE_TTL_MS = 15_000;
const MAX_CONTACTS = 50_000;
const VALID_SCOPES = new Set(['all', 'groups', 'external']);
const VALID_SORTS = new Set(['name', 'phone', 'groupName', 'admin', 'lastSeen']);

function compactText(value) {
  return String(value ?? '').trim();
}

export function normalizeJid(value) {
  const raw = compactText(value).split('/')[0];
  if (!raw) return '';
  const atIndex = raw.indexOf('@');
  if (atIndex === -1) return raw.split(':')[0];
  const user = raw.slice(0, atIndex).split(':')[0];
  const server = raw.slice(atIndex + 1).toLowerCase();
  return user && server ? `${user}@${server}` : '';
}

function isPhoneJid(value) {
  const jid = normalizeJid(value);
  return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us');
}

function isLidJid(value) {
  return normalizeJid(value).endsWith('@lid');
}

function validPhone(value) {
  const phone = compactText(value).replace(/\D/g, '');
  return phone.length >= 7 && phone.length <= 15 ? phone : '';
}

function phoneFromJid(value) {
  if (!isPhoneJid(value)) return '';
  return validPhone(normalizeJid(value).split('@')[0]);
}

function isUsefulName(value, identifiers = []) {
  const name = compactText(value);
  if (!name || ['bot', 'miembro', 'admin', 'undefined', 'null'].includes(name.toLowerCase())) return false;
  if (/^\S+@(lid|s\.whatsapp\.net|c\.us|g\.us)$/i.test(name)) return false;
  return !identifiers.some((identifier) => identifier && name === identifier);
}

function preferredName(raw, identifiers = []) {
  const candidates = [
    raw?.name,
    raw?.notify,
    raw?.verifiedName,
    raw?.pushName,
    raw?.senderName,
    raw?.username,
  ];
  return candidates.find((value) => isUsefulName(value, identifiers))?.trim() || '';
}

function identityFrom(raw = {}) {
  const ids = [raw.id, raw.jid, raw.phoneNumber, raw.lid, raw.senderId]
    .map(normalizeJid)
    .filter(Boolean);
  const phoneJid = ids.find(isPhoneJid) || '';
  const lid = ids.find(isLidJid) || '';
  const phone = phoneFromJid(phoneJid) || validPhone(raw.phone);
  const jid = phoneJid || lid || ids[0] || '';
  const key = phone ? `phone:${phone}` : (lid ? `lid:${lid}` : (jid ? `jid:${jid}` : ''));
  return {
    jid,
    phoneJid,
    lid,
    phone,
    key,
    aliases: new Set([...ids, ...ids.map((id) => id.split('@')[0]), phone].filter(Boolean)),
  };
}

function mergeIdentity(base, incoming) {
  const phone = base.phone || incoming.phone;
  const phoneJid = base.phoneJid || incoming.phoneJid;
  const lid = base.lid || incoming.lid;
  const jid = phoneJid || base.jid || incoming.jid || lid;
  return {
    jid,
    phoneJid,
    lid,
    phone,
    key: phone ? `phone:${phone}` : (lid ? `lid:${lid}` : (jid ? `jid:${jid}` : '')),
    aliases: new Set([...(base.aliases || []), ...(incoming.aliases || [])]),
  };
}

function identityType(identity) {
  if (identity.phone) return 'phone';
  if (identity.lid) return 'lid';
  return 'jid';
}

function publicIdentity(identity) {
  return {
    id: identity.jid || identity.lid || '',
    jid: identity.jid || identity.lid || '',
    phone: identity.phone || null,
    hasPhone: !!identity.phone,
    identityType: identityType(identity),
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function loadGroupMetadata(runtime, collections, accountId, configuredGroups, refresh) {
  return mapWithConcurrency(configuredGroups, 4, async (configuration) => {
    const groupId = compactText(configuration.groupId);
    if (!groupId) return null;

    let metadata = runtime.groupMetadataCache.get(groupId) || configuration.metadata || null;
    const shouldFetch = runtime.socket && (refresh || !Array.isArray(metadata?.participants));
    if (shouldFetch) {
      try {
        metadata = await runtime.socket.groupMetadata(groupId);
        runtime.groupMetadataCache.set(groupId, metadata);
        await collections.groups.updateOne(
          { accountId, groupId },
          { $set: { metadata, updatedAt: new Date() } },
        );
      } catch (error) {
        runtime.logger?.warn('directory', 'No se pudo actualizar la metadata de un grupo', {
          groupId,
          error: error.message,
        });
      }
    }

    return {
      groupId,
      name: compactText(configuration.nombre || metadata?.subject || groupId),
      metadata,
    };
  });
}

function collectContactRecords(runtimeContacts, databaseContacts) {
  const records = new Map();
  const aliasToKey = new Map();

  const add = (raw) => {
    const identity = identityFrom(raw);
    if (!identity.key) return;

    const matchedKey = [...identity.aliases].map((alias) => aliasToKey.get(alias)).find(Boolean);
    const currentKey = matchedKey || identity.key;
    const existing = records.get(currentKey);
    const mergedIdentity = existing ? mergeIdentity(existing.identity, identity) : identity;
    const identifiers = [...mergedIdentity.aliases];
    const name = preferredName(raw, identifiers) || existing?.name || '';
    const record = { identity: mergedIdentity, name };

    if (existing && mergedIdentity.key !== currentKey) records.delete(currentKey);
    records.set(mergedIdentity.key, record);
    for (const alias of mergedIdentity.aliases) aliasToKey.set(alias, mergedIdentity.key);
    if (mergedIdentity.phone) aliasToKey.set(mergedIdentity.phone, mergedIdentity.key);
  };

  for (const contact of runtimeContacts) add(contact);
  for (const contact of databaseContacts) add(contact);

  return { records, aliasToKey };
}

function contactForIdentity(identity, contactIndex) {
  for (const alias of identity.aliases) {
    const key = contactIndex.aliasToKey.get(alias);
    if (key && contactIndex.records.has(key)) return contactIndex.records.get(key);
  }
  return null;
}

async function resolveParticipantIdentity(participant, runtime, contactIndex) {
  let identity = identityFrom(participant);
  const knownContact = contactForIdentity(identity, contactIndex);
  if (knownContact) identity = mergeIdentity(identity, knownContact.identity);

  if (!identity.phone && identity.lid && runtime.socket?.signalRepository?.lidMapping) {
    try {
      const phoneJid = await runtime.socket.signalRepository.lidMapping.getPNForLID(identity.lid);
      if (phoneJid) {
        identity = mergeIdentity(identity, identityFrom({ phoneNumber: phoneJid, lid: identity.lid }));
      }
    } catch (error) {
      runtime.logger?.debug('directory', 'No se pudo resolver un identificador LID', {
        lid: identity.lid,
        error: error.message,
      });
    }
  }

  return identity;
}

function aliasesBelongToGroup(identity, groupIdentityKeys, groupAliases) {
  if (identity.key && groupIdentityKeys.has(identity.key)) return true;
  return [...identity.aliases].some((alias) => groupAliases.has(alias));
}

export async function buildDirectorySnapshot({ accountId, collections, runtime, refresh = false }) {
  const cached = runtime.directorySnapshot;
  if (!refresh && cached && Date.now() - cached.createdAt < DIRECTORY_CACHE_TTL_MS) {
    return cached.data;
  }

  const [databaseContacts, senders, configuredGroups] = await Promise.all([
    collections.contacts
      ? collections.contacts.find(
        { accountId },
        { projection: { _id: 0, id: 1, jid: 1, phoneNumber: 1, lid: 1, name: 1, updatedAt: 1 } },
      ).limit(MAX_CONTACTS).toArray()
      : [],
    collections.chatMessages.aggregate([
      { $match: { accountId, senderId: { $exists: true, $nin: ['', 'bot'] } } },
      { $sort: { ts: -1 } },
      {
        $group: {
          _id: '$senderId',
          name: { $first: '$senderName' },
          lastSeen: { $first: '$iso' },
          lastGroupId: { $first: '$groupId' },
          lastGroupName: { $first: '$groupName' },
        },
      },
      { $limit: MAX_CONTACTS },
    ]).toArray(),
    collections.groups.find({ accountId }).toArray(),
  ]);

  const contactIndex = collectContactRecords(
    Array.from(runtime.contactsMap.values()),
    databaseContacts,
  );
  const groupSources = (await loadGroupMetadata(
    runtime,
    collections,
    accountId,
    configuredGroups,
    refresh,
  )).filter(Boolean);

  const groups = [];
  const groupMembers = [];
  const groupIdentityKeys = new Set();
  const groupAliases = new Set();
  const participantSources = [];

  for (const source of groupSources) {
    const participants = Array.isArray(source.metadata?.participants)
      ? source.metadata.participants
      : [];
    groups.push({
      groupId: source.groupId,
      nombre: source.name,
      memberCount: participants.length,
      metadataAvailable: Array.isArray(source.metadata?.participants),
    });
    for (const participant of participants) participantSources.push({ participant, source });
  }

  const resolvedParticipants = await mapWithConcurrency(participantSources, 20, async ({ participant, source }) => {
    const identity = await resolveParticipantIdentity(participant, runtime, contactIndex);
    if (!identity.key) return null;
    const knownContact = contactForIdentity(identity, contactIndex);
    const identifiers = [...identity.aliases];
    const name = preferredName(participant, identifiers) || knownContact?.name || '';
    return {
      ...publicIdentity(identity),
      personKey: identity.key,
      name: name || 'Sin nombre registrado',
      hasKnownName: !!name,
      groupId: source.groupId,
      groupName: source.name,
      admin: participant.admin || (participant.isSuperAdmin ? 'superadmin' : (participant.isAdmin ? 'admin' : 'miembro')),
      aliases: identity.aliases,
    };
  });

  for (const member of resolvedParticipants.filter(Boolean)) {
    groupIdentityKeys.add(member.personKey);
    for (const alias of member.aliases) groupAliases.add(alias);
    groupMembers.push({
      id: member.id,
      jid: member.jid,
      phone: member.phone,
      hasPhone: member.hasPhone,
      identityType: member.identityType,
      personKey: member.personKey,
      name: member.name,
      hasKnownName: member.hasKnownName,
      groupId: member.groupId,
      groupName: member.groupName,
      admin: member.admin,
      type: 'group',
    });
  }

  const externalByKey = new Map();
  const addExternal = (raw, messageData = {}) => {
    let identity = identityFrom(raw);
    const knownContact = contactForIdentity(identity, contactIndex);
    if (knownContact) identity = mergeIdentity(identity, knownContact.identity);
    if (!identity.key || aliasesBelongToGroup(identity, groupIdentityKeys, groupAliases)) return;

    const identifiers = [...identity.aliases];
    const name = preferredName(raw, identifiers) || knownContact?.name || '';
    const existing = externalByKey.get(identity.key);
    const lastSeen = messageData.lastSeen || existing?.lastSeen || null;
    const incomingTimestamp = lastSeen ? Date.parse(lastSeen) || 0 : 0;
    const existingTimestamp = existing?.lastSeen ? Date.parse(existing.lastSeen) || 0 : 0;
    const useIncomingChat = incomingTimestamp >= existingTimestamp;

    externalByKey.set(identity.key, {
      ...publicIdentity(identity),
      personKey: identity.key,
      type: 'external',
      name: name || existing?.name || 'Sin nombre registrado',
      hasKnownName: !!(name || existing?.hasKnownName),
      lastSeen: incomingTimestamp >= existingTimestamp ? lastSeen : existing?.lastSeen || null,
      lastChat: useIncomingChat
        ? compactText(messageData.lastGroupName || messageData.lastGroupId || 'Contacto guardado')
        : existing?.lastChat || 'Contacto guardado',
    });
  };

  for (const sender of senders) {
    addExternal(
      { senderId: sender._id, senderName: sender.name },
      sender,
    );
  }
  for (const contact of contactIndex.records.values()) {
    addExternal({ ...publicIdentity(contact.identity), ...contact, name: contact.name });
  }

  const externalContacts = Array.from(externalByKey.values());
  const namedPeople = new Set();
  for (const row of [...groupMembers, ...externalContacts]) {
    if (row.hasKnownName) namedPeople.add(row.personKey);
  }

  const data = {
    groupMembers,
    externalContacts,
    groups: groups.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
    stats: {
      totalGroupMembers: groupMembers.length,
      uniqueGroupMembers: groupIdentityKeys.size,
      totalExternal: externalContacts.length,
      totalKnownNames: namedPeople.size,
    },
    generatedAt: new Date().toISOString(),
  };

  runtime.directorySnapshot = { createdAt: Date.now(), data };
  return data;
}

function normalizedQuery(query = {}) {
  const scope = VALID_SCOPES.has(query.scope) ? query.scope : 'all';
  const sort = VALID_SORTS.has(query.sort) ? query.sort : 'name';
  const order = query.order === 'desc' ? 'desc' : 'asc';
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 50, 10), 200);
  return {
    scope,
    sort,
    order,
    page,
    limit,
    groupId: compactText(query.groupId || 'all'),
    search: compactText(query.q).slice(0, 100).toLocaleLowerCase('es'),
  };
}

export function filterAndSortDirectory(snapshot, query = {}) {
  const options = normalizedQuery(query);
  let rows = [];
  if (options.scope !== 'external') rows.push(...snapshot.groupMembers);
  if (options.scope !== 'groups') rows.push(...snapshot.externalContacts);

  if (options.groupId !== 'all' && options.scope !== 'external') {
    rows = rows.filter((row) => row.type !== 'group' || row.groupId === options.groupId);
  }
  if (options.search) {
    rows = rows.filter((row) => [
      row.name,
      row.phone,
      row.jid,
      row.groupName,
      row.lastChat,
      row.admin,
    ].some((value) => compactText(value).toLocaleLowerCase('es').includes(options.search)));
  }

  const direction = options.order === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const aValue = compactText(a[options.sort] || (options.sort === 'groupName' ? a.lastChat : ''));
    const bValue = compactText(b[options.sort] || (options.sort === 'groupName' ? b.lastChat : ''));
    const comparison = aValue.localeCompare(bValue, 'es', { numeric: true, sensitivity: 'base' });
    if (comparison !== 0) return comparison * direction;
    return compactText(a.name).localeCompare(compactText(b.name), 'es', { sensitivity: 'base' });
  });

  return { rows, options };
}

export function paginateDirectory(snapshot, query = {}) {
  const { rows, options } = filterAndSortDirectory(snapshot, query);
  const totalItems = rows.length;
  const totalPages = Math.max(Math.ceil(totalItems / options.limit), 1);
  const page = Math.min(options.page, totalPages);
  const offset = (page - 1) * options.limit;
  return {
    items: rows.slice(offset, offset + options.limit),
    groups: snapshot.groups,
    stats: snapshot.stats,
    generatedAt: snapshot.generatedAt,
    pagination: {
      page,
      limit: options.limit,
      totalItems,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
  };
}

function csvCell(value) {
  let text = compactText(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function directoryCsv(snapshot, query = {}) {
  const { rows } = filterAndSortDirectory(snapshot, query);
  const header = [
    'Tipo',
    'Nombre de usuario',
    'Teléfono de WhatsApp',
    'Identificador JID',
    'Grupo u origen',
    'Rol o estado',
    'Última actividad',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push([
      row.type === 'group' ? 'Miembro de grupo' : 'Contacto externo',
      row.name,
      row.phone || '',
      row.jid || '',
      row.type === 'group' ? row.groupName : row.lastChat,
      row.type === 'group' ? row.admin : 'Externo',
      row.lastSeen || '',
    ].map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
