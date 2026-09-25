import fs from 'fs';
import path from 'path';

export const DEFAULT_TIMEZONE = 'America/Hermosillo';

export function now() {
  return new Date();
}

const dayFormatters = new Map();

function dayFormatter(timeZone) {
  const zone = timeZone || DEFAULT_TIMEZONE;
  let formatter = dayFormatters.get(zone);
  if (!formatter) {
    const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
    try {
      formatter = new Intl.DateTimeFormat('en-CA', { ...options, timeZone: zone });
    } catch {
      formatter = new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' });
    }
    dayFormatters.set(zone, formatter);
  }
  return formatter;
}

// Día calendario (YYYY-MM-DD) de una fecha en la zona horaria indicada.
export function dayKey(date, timeZone) {
  const parts = Object.fromEntries(
    dayFormatter(timeZone).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function normalizeAccountId(value) {
  return String(value || 'default')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default';
}

export function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

export function safeJsonParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

export function publicSafeAccount(account) {
  if (!account) return null;
  const clone = structuredClone(account);
  delete clone._id;
  delete clone.userId;
  delete clone.sessionPath;
  delete clone.accountId;
  return clone;
}

export function publicSafeConfig(config) {
  if (!config) return null;
  const clone = structuredClone(config);
  if (clone._id) delete clone._id;
  if (clone.ia?.apiKey) clone.ia.apiKey = '********';
  return clone;
}

export function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

export function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function asNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function atomicWriteJson(filePath, data) {
  ensureDirSync(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}
