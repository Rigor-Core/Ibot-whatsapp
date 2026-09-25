import fs from 'fs';
import path from 'path';
import { ObjectId } from 'mongodb';
import { APP_VERSION } from '../core/app-info.js';
import { dayKey } from '../core/utils.js';
import { getAccountSessionPath, getStorageRoot } from './account-service.js';
import { getSystemSettings } from './settings-service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const STARTED_AT = new Date();

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function countByAccount(collection, match = {}) {
  const rows = await collection.aggregate([
    { $match: match },
    { $group: { _id: '$accountId', count: { $sum: 1 } } },
  ]).toArray();
  return new Map(rows.map((row) => [row._id, row.count]));
}

// Cuenta mensajes por cuenta usando el índice { accountId, ... } en lugar de
// recorrer toda la colección.
async function countMessagesPerAccount(collections, accountIds) {
  const counts = await Promise.all(
    accountIds.map((accountId) => collections.chatMessages.countDocuments({ accountId })),
  );
  return new Map(accountIds.map((accountId, index) => [accountId, counts[index]]));
}

function objectIdOrNull(value) {
  return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

function isAccountUser(user) {
  return user && user.role !== 'owner';
}

export async function buildOverview({ collections, registry }) {
  const [users, accounts, configs, counters, groupCounts, contactCounts, pendingScheduled] = await Promise.all([
    collections.users.find({}, { projection: { password: 0 } }).sort({ createdAt: 1 }).toArray(),
    collections.accounts.find({}).toArray(),
    collections.configs.find({}, { projection: { accountId: 1, activo: 1, respuestas: 1, modo: 1 } }).toArray(),
    collections.counters.find({ name: 'OrdenesRecibidas' }).toArray(),
    countByAccount(collections.groups),
    countByAccount(collections.contacts),
    countByAccount(collections.scheduledMessages, { status: 'pending' }),
  ]);
  const messageCounts = await countMessagesPerAccount(collections, accounts.map((account) => account.accountId));
  const configsByAccount = new Map(configs.map((config) => [config.accountId, config]));
  const ordersByAccount = new Map(counters.map((counter) => [counter.accountId, Number(counter.seq || 0)]));
  const accountUsersById = new Map(users.filter(isAccountUser).map((user) => [String(user._id), user]));

  const describeAccount = (account) => {
    const config = configsByAccount.get(account.accountId);
    return {
      accountId: account.accountId,
      label: account.label,
      status: registry.liveStatus(account.accountId),
      phoneJid: account.phoneJid || null,
      phoneName: account.phoneName || null,
      active: config?.activo === true,
      respuestas: config?.respuestas === true,
      mode: config?.modo || 'repartidor',
      groups: groupCounts.get(account.accountId) || 0,
      contacts: contactCounts.get(account.accountId) || 0,
      messages: messageCounts.get(account.accountId) || 0,
      scheduled: pendingScheduled.get(account.accountId) || 0,
      orders: ordersByAccount.get(account.accountId) || 0,
      createdAt: account.createdAt || null,
    };
  };

  const accountsByUser = new Map();
  const orphanAccounts = [];
  for (const account of accounts) {
    if (accountUsersById.has(String(account.userId))) accountsByUser.set(String(account.userId), account);
    else orphanAccounts.push(describeAccount(account));
  }

  const userRows = users.filter(isAccountUser).map((user) => {
    const account = accountsByUser.get(String(user._id));
    return {
      username: user.username,
      disabled: user.disabled === true,
      createdAt: user.createdAt || null,
      lastLoginAt: user.lastLoginAt || null,
      account: account ? describeAccount(account) : null,
    };
  });

  const allAccounts = [...userRows.map((row) => row.account).filter(Boolean), ...orphanAccounts];
  const sum = (values) => values.reduce((total, value) => total + value, 0);

  return {
    summary: {
      users: userRows.length,
      activeUsers: userRows.filter((row) => !row.disabled).length,
      suspendedUsers: userRows.filter((row) => row.disabled).length,
      linkedAccounts: allAccounts.filter((account) => account.phoneJid).length,
      connected: allAccounts.filter((account) => account.status === 'connected').length,
      configuredGroups: sum([...groupCounts.values()]),
      orders: sum([...ordersByAccount.values()]),
      observedMessages: sum([...messageCounts.values()]),
      pendingScheduled: sum([...pendingScheduled.values()]),
    },
    users: userRows,
    orphanAccounts,
    admins: users.filter((user) => user.role === 'owner').map((user) => ({
      username: user.username,
      createdAt: user.createdAt || null,
      lastLoginAt: user.lastLoginAt || null,
    })),
  };
}

export async function buildStats({ collections, registry, days: requestedDays }) {
  const days = Math.min(Math.max(Number(requestedDays) || 14, 7), 90);
  const { defaultTimezone: timeZone } = await getSystemSettings(collections);
  const now = Date.now();
  const dayList = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = dayKey(new Date(now - offset * DAY_MS), timeZone);
    if (dayList[dayList.length - 1] !== key) dayList.push(key);
  }
  const since = now - days * DAY_MS;

  const [orderRows, observedRows, signupRows, topRows, scheduledRows, accounts, users] = await Promise.all([
    collections.statsDaily.aggregate([
      { $match: { day: { $in: dayList } } },
      { $group: { _id: '$day', total: { $sum: '$orders' } } },
    ]).toArray(),
    collections.chatMessages.aggregate([
      { $match: { ts: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: { $toDate: '$ts' }, timezone: timeZone } }, total: { $sum: 1 } } },
    ]).toArray(),
    collections.users.aggregate([
      { $match: { role: { $ne: 'owner' }, createdAt: { $gte: new Date(since) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: timeZone } }, total: { $sum: 1 } } },
    ]).toArray(),
    collections.statsDaily.aggregate([
      { $match: { day: { $in: dayList } } },
      { $group: { _id: '$accountId', total: { $sum: '$orders' } } },
      { $sort: { total: -1 } },
      { $limit: 5 },
    ]).toArray(),
    collections.scheduledMessages.aggregate([
      { $group: { _id: '$status', total: { $sum: 1 } } },
    ]).toArray(),
    collections.accounts.find({}, { projection: { accountId: 1, userId: 1, label: 1 } }).toArray(),
    collections.users.find({}, { projection: { username: 1 } }).toArray(),
  ]);

  const series = (rows) => {
    const byDay = new Map(rows.map((row) => [row._id, row.total]));
    return dayList.map((day) => byDay.get(day) || 0);
  };
  const usernames = new Map(users.map((user) => [String(user._id), user.username]));
  const accountNames = new Map(accounts.map((account) => [
    account.accountId,
    usernames.get(String(account.userId)) || account.label || account.accountId,
  ]));
  const statusCounts = {};
  for (const account of accounts) {
    const status = registry.liveStatus(account.accountId);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  return {
    timeZone,
    days: dayList,
    orders: series(orderRows),
    observed: series(observedRows),
    signups: series(signupRows),
    topAccounts: topRows.map((row) => ({ name: accountNames.get(row._id) || row._id, total: row.total })),
    statusCounts,
    scheduled: Object.fromEntries(scheduledRows.map((row) => [row._id, row.total])),
  };
}

export function systemInfo({ registry, scheduler }) {
  const memory = process.memoryUsage();
  const runtimes = [...registry.runtimes.keys()];
  return {
    version: APP_VERSION,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    environment: process.env.NODE_ENV || 'development',
    startedAt: STARTED_AT,
    uptimeSeconds: Math.round(process.uptime()),
    memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal },
    database: process.env.MONGODB_DB || 'Ibotv2',
    syncMode: registry.syncMode,
    runtimesLoaded: runtimes.length,
    runningBots: runtimes.filter((accountId) => registry.isRunning(accountId)).length,
    schedulerRunning: scheduler.isRunning(),
    panelAuthEnabled: String(process.env.PANEL_AUTH_ENABLED || 'true').toLowerCase() !== 'false',
    secureCookies: process.env.NODE_ENV === 'production' && String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true',
    persistentSecret: !!(process.env.PANEL_SECRET || process.env.PANEL_PASSWORD),
    dipisikKeyConfigured: !!(process.env.DIPISIK_API_KEY || process.env.DEEPSEEK_API_KEY),
  };
}

async function removeAccountStorage(accountId) {
  const root = path.resolve(getStorageRoot());
  const target = path.resolve(getAccountSessionPath(accountId));
  if (!target.startsWith(`${root}${path.sep}`)) return;
  await fs.promises.rm(target, { recursive: true, force: true });
}

// Cierra la sesión de WhatsApp y elimina todos los datos de una cuenta.
export async function deleteAccountData({ collections, registry, accountId }) {
  await registry.logout(accountId).catch(() => null);
  registry.forget(accountId);
  await Promise.all([
    collections.accounts.deleteMany({ accountId }),
    collections.configs.deleteMany({ accountId }),
    collections.groups.deleteMany({ accountId }),
    collections.contacts.deleteMany({ accountId }),
    collections.chatMessages.deleteMany({ accountId }),
    collections.chatGroups.deleteMany({ accountId }),
    collections.scheduledMessages.deleteMany({ accountId }),
    collections.counters.deleteMany({ accountId }),
    collections.statsDaily.deleteMany({ accountId }),
    collections.qrHistory.deleteMany({ accountId }),
    collections.whatsappSessions.deleteMany({ accountId }),
    collections.pushSubscriptions.deleteMany({ accountId }),
  ]);
  await removeAccountStorage(accountId).catch((err) => {
    console.error(`[admin] No se pudo borrar el almacenamiento de ${accountId}:`, err.message);
  });
}

export async function deleteUserWithData({ collections, registry, user }) {
  const account = await collections.accounts.findOne({ userId: String(user._id) });
  if (account) await deleteAccountData({ collections, registry, accountId: account.accountId });
  await collections.users.deleteOne({ _id: user._id });
}

// Verifica que una cuenta de WhatsApp no tenga un usuario normal como dueño
// (por ejemplo, la que usaba el administrador antes de separar los paneles).
export async function assertOrphanAccount(collections, accountId) {
  const account = await collections.accounts.findOne({ accountId });
  if (!account) throw httpError(404, 'Cuenta de WhatsApp no encontrada.');
  const ownerId = objectIdOrNull(account.userId);
  const owner = ownerId ? await collections.users.findOne({ _id: ownerId }) : null;
  if (isAccountUser(owner)) throw httpError(409, `La cuenta ya pertenece al usuario ${owner.username}.`);
  return account;
}

export async function assignAccountToUser({ collections, accountId, user }) {
  if (!isAccountUser(user)) throw httpError(400, 'Solo se puede asignar a un usuario normal.');
  await assertOrphanAccount(collections, accountId);
  const current = await collections.accounts.findOne({ userId: String(user._id) });
  if (current && current.accountId !== accountId) {
    throw httpError(409, `${user.username} ya tiene su propia cuenta de WhatsApp.`);
  }
  await collections.accounts.updateOne(
    { accountId },
    { $set: { userId: String(user._id), label: user.username, updatedAt: new Date() } },
  );
}
