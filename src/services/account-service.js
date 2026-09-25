import path from 'path';
import { DEFAULT_TIMEZONE, normalizeAccountId, now } from '../core/utils.js';
import { getSystemSettings } from './settings-service.js';
import { normalizeIaConfig } from './ai-providers.js';
import { CONFIG_SCHEMA_VERSION } from '../db/migrations.js';

export function getStorageRoot() {
  return process.env.STORAGE_DIR || 'storage/accounts';
}

export function getAccountSessionPath(accountId) {
  return path.join(getStorageRoot(), normalizeAccountId(accountId));
}

export function defaultBotConfig(accountId, { timezone = DEFAULT_TIMEZONE } = {}) {
  return {
    accountId,
    activo: false,
    respuestas: false,
    estado: 'inicial',
    qr: null,
    modo: 'repartidor',
    schemaVersion: CONFIG_SCHEMA_VERSION,
    repartidor: {
      globalLimit: 1,
      filterEnabled: true,
      ignoreOwnMessages: true,
    },
    ia: normalizeIaConfig({}),
    logs: {
      maxConsoleLines: 1000,
      maxChatMessages: 3000,
    },
    connectionNotification: {
      enabled: false,
      groupId: '',
      message: '¡Bot de WhatsApp en línea!'
    },
    timezone,
    adminCommands: {
      enabled: false,
      definitions: {
        help: { enabled: true, roles: ['user', 'admin', 'owner'] },
        status: { enabled: true, roles: ['admin', 'owner'] },
        ban: { enabled: true, roles: ['admin', 'owner'] },
        demote: { enabled: true, roles: ['owner'] },
        group: { enabled: true, roles: ['admin', 'owner'] },
        promote: { enabled: true, roles: ['owner'] },
      },
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

// Cada usuario (no administrador) tiene una única cuenta donde vincula su
// WhatsApp. Se crea la primera vez que el usuario entra a su panel.
export async function ensureUserAccount(collections, user) {
  const userId = String(user?._id || user?.uid || '').trim();
  if (!userId) throw new Error('Usuario de panel inválido');
  if (user?.role === 'owner') throw new Error('Los administradores no vinculan WhatsApp');

  const existing = await collections.accounts.findOne(
    { userId },
    { sort: { createdAt: 1 } },
  );
  if (existing) return existing;

  const accountId = normalizeAccountId(`bot-${userId}`);
  const label = String(user?.username || 'Mi WhatsApp').trim() || 'Mi WhatsApp';
  const sessionPath = getAccountSessionPath(accountId);
  const setOnInsert = {
    accountId,
    userId,
    label,
    status: 'stopped',
    phoneJid: null,
    phoneName: null,
    sessionPath,
    createdAt: now(),
  };

  await collections.accounts.updateOne(
    { userId },
    {
      $setOnInsert: setOnInsert,
      $set: { updatedAt: now() },
    },
    { upsert: true },
  );
  const { defaultTimezone } = await getSystemSettings(collections);
  const defaultConfig = defaultBotConfig(accountId, { timezone: defaultTimezone });
  delete defaultConfig.updatedAt;
  await collections.configs.updateOne(
    { accountId },
    { $setOnInsert: defaultConfig, $set: { updatedAt: now() } },
    { upsert: true },
  );
  await collections.counters.updateOne(
    { accountId, name: 'OrdenesRecibidas' },
    { $setOnInsert: { accountId, name: 'OrdenesRecibidas', seq: 0, createdAt: now() } },
    { upsert: true },
  );
  return collections.accounts.findOne({ accountId });
}

export async function getUserAccount(collections, user) {
  return ensureUserAccount(collections, user);
}

export async function getConfig(collections, accountId) {
  return collections.configs.findOne({ accountId: normalizeAccountId(accountId) });
}
