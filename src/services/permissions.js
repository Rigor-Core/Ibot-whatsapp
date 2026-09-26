import { EXTENSION_CATALOG } from '../extensions/index.js';

// Permisos que el administrador asigna a cada usuario. Lo que no está permitido
// no aparece en el panel del usuario y la API lo rechaza.
export const PERMISSION_CATALOG = Object.freeze({
  pages: {
    grupos: 'Grupos',
    chats: 'Chats',
    contactos: 'Contactos',
    comandos: 'Comandos (en Ajustes)',
    configuracion: 'Configuración',
  },
  modes: {
    repartidor: 'Modo repartidor',
    normal: 'Modo normal (comandos)',
    watch: 'Modo watch',
    ia: 'Modo IA',
  },
  features: {
    manageGroups: 'Crear, editar y borrar grupos',
    sendMessages: 'Enviar mensajes desde el panel',
    scheduleMessages: 'Programar mensajes',
    exportContacts: 'Exportar contactos',
    iaSettings: 'Configurar la IA',
    pushNotifications: 'Notificaciones push',
    unlinkWhatsapp: 'Desvincular su WhatsApp',
  },
  // Herramientas externas para la IA: apagadas hasta que el administrador las permite.
  extensions: EXTENSION_CATALOG,
});

const MAX_GROUPS_LIMIT = 10000;

function flags(section, raw = {}, defaultAllowed = true) {
  return Object.fromEntries(Object.keys(PERMISSION_CATALOG[section]).map((key) => [
    key,
    defaultAllowed ? raw?.[key] !== false : raw?.[key] === true,
  ]));
}

// Por defecto todo está permitido; solo se guarda lo que el administrador cambia.
export function normalizePermissions(raw = {}) {
  const maxGroups = Number(raw?.limits?.maxGroups ?? 0);
  const permissions = {
    pages: flags('pages', raw?.pages),
    modes: flags('modes', raw?.modes),
    features: flags('features', raw?.features),
    extensions: flags('extensions', raw?.extensions, false),
    limits: {
      maxGroups: Number.isInteger(maxGroups) && maxGroups > 0 ? Math.min(maxGroups, MAX_GROUPS_LIMIT) : 0,
    },
  };
  // Siempre debe quedar al menos un modo disponible.
  if (!Object.values(permissions.modes).some(Boolean)) permissions.modes.repartidor = true;
  return permissions;
}

export function allowedModes(permissions) {
  return Object.entries(permissions.modes).filter(([, allowed]) => allowed).map(([mode]) => mode);
}

// Páginas del panel de usuario y la sección de permisos que las controla.
export const PAGE_PERMISSIONS = Object.freeze({
  '/grupos': 'grupos', '/grupos.html': 'grupos',
  '/grupos-moderno': 'grupos', '/grupos-moderno.html': 'grupos',
  '/chats': 'chats', '/chats.html': 'chats',
  '/contactos': 'contactos', '/contactos.html': 'contactos',
  '/configuracion': 'configuracion', '/configuracion.html': 'configuracion',
});

// Rutas de la API del usuario y el permiso que requieren.
const API_RULES = [
  { pattern: /^\/api\/bot\/grupos(\/|$)/, page: 'grupos' },
  { pattern: /^\/api\/bot\/grupos(\/|$)/, methods: ['POST', 'PUT', 'DELETE'], feature: 'manageGroups' },
  { pattern: /^\/api\/bot\/(chats|events\/chats)(\/|$)/, page: 'chats' },
  { pattern: /^\/api\/bot\/chats\/[^/]+\/send$/, feature: 'sendMessages' },
  { pattern: /^\/api\/bot\/directory\/export\.csv$/, feature: 'exportContacts' },
  { pattern: /^\/api\/bot\/directory(\/|$)/, page: 'contactos' },
  { pattern: /^\/api\/bot\/scheduled-messages(\/|$)/, feature: 'scheduleMessages' },
  { pattern: /^\/api\/bot\/push(\/|$)/, feature: 'pushNotifications' },
  { pattern: /^\/api\/bot\/logout$/, feature: 'unlinkWhatsapp' },
  { pattern: /^\/api\/bot\/ia(\/|$)/, feature: 'iaSettings' },
  { pattern: /^\/api\/bot\/extensions(\/|$)/, feature: 'iaSettings' },
  { pattern: /^\/api\/bot\/(storage|preferences)(\/|$)/, page: 'configuracion' },
];

export function deniedApiPermission(permissions, method, path) {
  for (const rule of API_RULES) {
    if (!rule.pattern.test(path)) continue;
    if (rule.methods && !rule.methods.includes(method)) continue;
    if (rule.page && !permissions.pages[rule.page]) return PERMISSION_CATALOG.pages[rule.page];
    if (rule.feature && !permissions.features[rule.feature]) return PERMISSION_CATALOG.features[rule.feature];
  }
  return null;
}

// Secciones de la configuración que dependen de un permiso.
export function deniedConfigChange(permissions, body = {}) {
  if (body.modo !== undefined && !permissions.modes[body.modo]) return PERMISSION_CATALOG.modes[body.modo] || 'Modo';
  if (body.ia !== undefined && !permissions.features.iaSettings) return PERMISSION_CATALOG.features.iaSettings;
  if (body.notifications !== undefined && !permissions.features.pushNotifications) return PERMISSION_CATALOG.features.pushNotifications;
  if (body.adminCommands !== undefined && !permissions.pages.comandos) return PERMISSION_CATALOG.pages.comandos;
  return null;
}
