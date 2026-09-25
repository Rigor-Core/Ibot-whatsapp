import { DEFAULT_TIMEZONE } from '../core/utils.js';
import { isValidTimeZone } from './message-scheduler.js';

const SETTINGS_ID = 'panel';
const CACHE_TTL_MS = 10000;
let cached = null;

function envPublicRegistration() {
  return String(process.env.PANEL_ALLOW_PUBLIC_REGISTRATION || 'false').toLowerCase() === 'true';
}

// Valores efectivos: lo guardado por el administrador tiene prioridad sobre el .env.
export async function getSystemSettings(collections) {
  const doc = await collections.settings.findOne({ _id: SETTINGS_ID });
  return {
    publicRegistration: typeof doc?.publicRegistration === 'boolean' ? doc.publicRegistration : envPublicRegistration(),
    defaultTimezone: isValidTimeZone(doc?.defaultTimezone) ? doc.defaultTimezone : DEFAULT_TIMEZONE,
    maxUsers: Number.isInteger(doc?.maxUsers) && doc.maxUsers > 0 ? doc.maxUsers : 0,
    // Los usuarios pueden usar Dipisik con la clave del servidor (DIPISIK_API_KEY).
    aiSharedDipisik: doc?.aiSharedDipisik !== false,
    // Endpoints de IA personalizados: el servidor haría peticiones a URLs que
    // elige el usuario, por eso vienen desactivados por defecto.
    aiAllowCustomEndpoints: doc?.aiAllowCustomEndpoints === true,
    updatedAt: doc?.updatedAt || null,
  };
}

// Versión con caché corta para rutas calientes (por ejemplo, cada mensaje del modo IA).
export async function getSystemSettingsCached(collections) {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const value = await getSystemSettings(collections);
  cached = { value, at: Date.now() };
  return value;
}

export async function updateSystemSettings(collections, patch = {}) {
  const set = {};
  if (patch.publicRegistration !== undefined) set.publicRegistration = patch.publicRegistration === true;
  if (patch.aiSharedDipisik !== undefined) set.aiSharedDipisik = patch.aiSharedDipisik === true;
  if (patch.aiAllowCustomEndpoints !== undefined) set.aiAllowCustomEndpoints = patch.aiAllowCustomEndpoints === true;
  if (patch.defaultTimezone !== undefined) {
    const timezone = String(patch.defaultTimezone || '').trim();
    if (!isValidTimeZone(timezone)) throw new Error('Zona horaria inválida');
    set.defaultTimezone = timezone;
  }
  if (patch.maxUsers !== undefined) {
    const maxUsers = Number(patch.maxUsers);
    if (!Number.isInteger(maxUsers) || maxUsers < 0 || maxUsers > 100000) {
      throw new Error('El límite de usuarios debe ser un número entero entre 0 y 100000 (0 = sin límite)');
    }
    set.maxUsers = maxUsers;
  }
  if (Object.keys(set).length) {
    await collections.settings.updateOne(
      { _id: SETTINGS_ID },
      { $set: { ...set, updatedAt: new Date() } },
      { upsert: true },
    );
    cached = null;
  }
  return getSystemSettings(collections);
}

// Lanza un error si ya se alcanzó el límite de usuarios configurado.
export async function assertUserCapacity(collections) {
  const { maxUsers } = await getSystemSettings(collections);
  if (!maxUsers) return;
  const total = await collections.users.countDocuments({ role: { $ne: 'owner' } });
  if (total >= maxUsers) {
    throw Object.assign(new Error(`Se alcanzó el límite de ${maxUsers} usuarios configurado por el administrador.`), { status: 409 });
  }
}
