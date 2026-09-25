import path from 'path';
import { normalizeAccountId, now } from '../core/utils.js';

export function getStorageRoot() {
  return process.env.STORAGE_DIR || 'storage/accounts';
}

export function getAccountSessionPath(accountId) {
  return path.join(getStorageRoot(), normalizeAccountId(accountId));
}

export function defaultBotConfig(accountId) {
  return {
    accountId,
    activo: false,
    respuestas: false,
    estado: 'inicial',
    qr: null,
    modo: 'normal',
    normal: {
      globalLimit: 1,
      filterEnabled: true,
      ignoreOwnMessages: true,
    },
    ia: {
      enabled: false,
      provider: 'deepseek-compatible',
      apiKey: '',
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://dipisik.rigorcore.com/v1',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      commandMode: 'required',
      commands: ['/chat', '/gpt'],
      systemPrompt: 'Eres un asistente útil, breve y profesional dentro de un grupo de WhatsApp. Responde en español salvo que el usuario pida otro idioma.',
      temperature: 0.6,
      maxTokens: 500,
      timeoutMs: 20000,
      perGroupCooldownMs: 3000,
      historyLimit: 8,
      fallbackText: 'No pude generar una respuesta en este momento.',
      onlyConfiguredGroups: true,
      ignoreMedia: true,
      ignoreOwnMessages: true,
    },
    logs: {
      maxConsoleLines: 1000,
      maxChatMessages: 3000,
    },
    connectionNotification: {
      enabled: false,
      groupId: '',
      message: '¡Bot de WhatsApp en línea!'
    },
    timezone: 'America/Hermosillo',
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

export async function ensureUserAccount(collections, user) {
  const userId = String(user?._id || user?.uid || '').trim();
  if (!userId) throw new Error('Usuario de panel inválido');

  const existing = await collections.accounts.findOne(
    { userId },
    { sort: { createdAt: 1 } },
  );
  if (existing) return existing;

  const accountId = normalizeAccountId(`bot-${userId}`);
  const label = String(user?.username || 'Mi Bot').trim() || 'Mi Bot';
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
  const defaultConfig = defaultBotConfig(accountId);
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
