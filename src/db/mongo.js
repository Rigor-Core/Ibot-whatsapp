import { MongoClient } from 'mongodb';

let client;
let db;

export async function connectDB() {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI no está configurado');
  const dbName = process.env.MONGODB_DB || 'Ibotv2';
  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 12000,
    maxPoolSize: 20,
    minPoolSize: 0,
    retryWrites: true,
  });
  await client.connect();
  db = client.db(dbName);
  console.log(`Conectado a MongoDB (${dbName})`);
  return db;
}

export function getCollections(database = db) {
  return {
    accounts: database.collection('accounts'),
    configs: database.collection('bot_configs'),
    groups: database.collection('groups'),
    counters: database.collection('counters'),
    qrHistory: database.collection('qr_history'),
    chatGroups: database.collection('chat_groups'),
    users: database.collection('panel_users'),
    whatsappSessions: database.collection('whatsapp_sessions'),
    chatMessages: database.collection('chat_messages'),
    contacts: database.collection('contacts'),
    scheduledMessages: database.collection('scheduled_messages'),
    statsDaily: database.collection('stats_daily'),
    settings: database.collection('system_settings'),
    pushSubscriptions: database.collection('push_subscriptions'),
  };
}

async function safeCreateIndex(collection, indexSpec, options = {}) {
  try {
    await collection.createIndex(indexSpec, options);
  } catch (error) {
    if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
      const indexName = options.name || Object.keys(indexSpec).map(key => `${key}_${indexSpec[key]}`).join('_');
      console.warn(`Conflicto de índice para ${collection.collectionName}.${indexName}. Eliminando y recreando...`);
      try {
        await collection.dropIndex(indexName);
        await collection.createIndex(indexSpec, options);
      } catch (dropError) {
        console.error(`Error al recrear índice ${indexName}:`, dropError);
        throw dropError;
      }
    } else {
      throw error;
    }
  }
}

export async function ensureIndexes(database = db) {
  const c = getCollections(database);
  await Promise.all([
    safeCreateIndex(c.accounts, { accountId: 1 }, { unique: true }),
    safeCreateIndex(c.configs, { accountId: 1 }, { unique: true }),
    safeCreateIndex(c.groups, { accountId: 1, groupId: 1 }, { unique: true }),
    safeCreateIndex(c.groups, { accountId: 1, grupo: 1 }),
    safeCreateIndex(c.counters, { accountId: 1, name: 1 }, { unique: true }),
    safeCreateIndex(c.qrHistory, { accountId: 1, createdAt: -1 }),
    safeCreateIndex(c.qrHistory, { createdAt: 1 }, { expireAfterSeconds: 900 }),
    safeCreateIndex(c.chatGroups, { accountId: 1, groupId: 1 }, { unique: true }),
    safeCreateIndex(c.chatGroups, { accountId: 1, lastMessageAt: -1 }),
    safeCreateIndex(c.users, { username: 1 }, { unique: true }),
    safeCreateIndex(c.accounts, { userId: 1, createdAt: 1 }),
    safeCreateIndex(c.accounts, { userId: 1 }, {
      name: 'unique_account_per_user',
      unique: true,
      partialFilterExpression: { userId: { $type: 'string' } },
    }),
    safeCreateIndex(c.whatsappSessions, { accountId: 1, key: 1 }, { unique: true }),
    safeCreateIndex(c.chatMessages, { accountId: 1, groupId: 1, ts: -1 }),
    safeCreateIndex(c.chatMessages, { accountId: 1, senderId: 1, ts: -1 }),
    safeCreateIndex(c.chatMessages, { accountId: 1, id: 1 }, { unique: true }),
    safeCreateIndex(c.contacts, { accountId: 1, id: 1 }, { unique: true }),
    safeCreateIndex(c.scheduledMessages, { accountId: 1, status: 1, scheduledFor: 1 }),
    safeCreateIndex(c.scheduledMessages, { status: 1, nextAttemptAt: 1 }),
    safeCreateIndex(c.statsDaily, { accountId: 1, day: 1 }, { unique: true }),
    safeCreateIndex(c.statsDaily, { day: 1 }),
    safeCreateIndex(c.chatMessages, { ts: 1 }),
    safeCreateIndex(c.pushSubscriptions, { endpoint: 1 }, { unique: true }),
    safeCreateIndex(c.pushSubscriptions, { accountId: 1, updatedAt: -1 }),
  ]);
}

export async function closeDB() {
  if (!client) return;
  await client.close();
  client = null;
  db = null;
}
