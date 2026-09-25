import { AiChatClient } from './ai-client.js';
import { decryptSecret, encryptSecret } from '../core/secrets.js';

function dipisikBaseUrl() {
  return (process.env.DIPISIK_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://dipisik.rigorcore.com/v1').replace(/\/+$/, '');
}

function dipisikSharedKey() {
  return process.env.DIPISIK_API_KEY || process.env.DEEPSEEK_API_KEY || '';
}

// Proveedores compatibles con chat/completions. Las URL de los proveedores
// conocidos son fijas: el usuario solo puede elegir una URL propia con
// "custom" y si el administrador lo permite.
export const AI_PROVIDERS = Object.freeze({
  dipisik: {
    name: 'Dipisik (DeepSeek especial)',
    description: 'DeepSeek a través del servidor Dipisik. Admite perfiles dedicados para WhatsApp, razonamiento y búsqueda web.',
    baseUrl: dipisikBaseUrl,
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-search'],
    supportsProfile: true,
  },
  deepseek: {
    name: 'DeepSeek (API oficial)',
    description: 'API oficial de DeepSeek con tu propia clave.',
    baseUrl: () => 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  openai: {
    name: 'OpenAI',
    description: 'Modelos GPT con tu clave de OpenAI.',
    baseUrl: () => 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'],
  },
  zai: {
    name: 'Z.ai (GLM)',
    description: 'Modelos GLM de Z.ai con tu propia clave.',
    baseUrl: () => 'https://api.z.ai/api/paas/v4',
    models: ['glm-4.5', 'glm-4.5-air', 'glm-4.6'],
  },
  gemini: {
    name: 'Google Gemini',
    description: 'Gemini mediante su endpoint compatible con OpenAI.',
    baseUrl: () => 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash'],
  },
  groq: {
    name: 'Groq',
    description: 'Modelos abiertos con respuestas muy rápidas.',
    baseUrl: () => 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
  openrouter: {
    name: 'OpenRouter',
    description: 'Acceso a muchos modelos con una sola clave.',
    baseUrl: () => 'https://openrouter.ai/api/v1',
    models: ['openrouter/auto'],
  },
  custom: {
    name: 'Personalizado (compatible con OpenAI)',
    description: 'Cualquier servicio compatible con OpenAI, por ejemplo Ollama o LM Studio.',
    baseUrl: null,
    models: [],
  },
});

export const IA_DEFAULTS = Object.freeze({
  provider: 'dipisik',
  model: 'deepseek-chat',
  baseUrl: '',
  temperature: 0.6,
  maxTokens: 500,
  timeoutMs: 20000,
  historyLimit: 8,
  perGroupCooldownMs: 3000,
  // Cuándo responde: off (desactivada), all (todos los mensajes),
  // command (mensajes que empiezan con un comando) o keyword (contienen un texto).
  triggerMode: 'command',
  commands: ['/chat', '/gpt'],
  keywords: [],
  systemPrompt: 'Eres un asistente útil, breve y profesional dentro de un grupo de WhatsApp. Responde en español salvo que el usuario pida otro idioma.',
  fallbackText: 'No pude generar una respuesta en este momento.',
  onlyConfiguredGroups: true,
  ignoreMedia: true,
  ignoreOwnMessages: true,
  replyQuoted: true,
  mentionSender: false,
  showTyping: true,
  includeSenderName: true,
  maxReplyChars: 0,
});

export const TRIGGER_MODES = Object.freeze(['off', 'all', 'command', 'keyword']);
const LEGACY_TRIGGERS = { required: 'command', all: 'all', optional: 'all' };

// Cada usuario tiene su propio profile en Dipisik (su chat dedicado).
export function dipisikProfileFor(accountId) {
  return `ibot-${String(accountId || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`.slice(0, 40);
}

function triggerModeOf(raw) {
  if (TRIGGER_MODES.includes(raw.triggerMode)) return raw.triggerMode;
  return LEGACY_TRIGGERS[raw.commandMode] || IA_DEFAULTS.triggerMode;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

function text(value, max, fallback = '') {
  return value === undefined || value === null ? fallback : String(value).slice(0, max);
}

function inferProvider(baseUrl) {
  const url = String(baseUrl || '').toLowerCase();
  if (!url || url.includes('dipisik')) return 'dipisik';
  if (url.includes('api.z.ai')) return 'zai';
  if (url.includes('api.deepseek.com')) return 'deepseek';
  if (url.includes('api.openai.com')) return 'openai';
  if (url.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (url.includes('api.groq.com')) return 'groq';
  if (url.includes('openrouter.ai')) return 'openrouter';
  return 'custom';
}

export function validateCustomBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('La URL base personalizada no es válida');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('La URL base debe usar http o https');
  return url.toString().replace(/\/+$/, '');
}

// Normaliza la configuración del modo IA (incluidas las guardadas por
// versiones anteriores, que no tenían proveedor y guardaban una sola apiKey).
export function normalizeIaConfig(raw = {}) {
  const legacyProvider = !raw.provider || raw.provider === 'deepseek-compatible';
  const provider = legacyProvider ? inferProvider(raw.baseUrl) : (AI_PROVIDERS[raw.provider] ? raw.provider : IA_DEFAULTS.provider);
  const apiKeys = { ...(raw.apiKeys && typeof raw.apiKeys === 'object' ? raw.apiKeys : {}) };
  if (raw.apiKey && !String(raw.apiKey).includes('*') && !apiKeys[provider]) apiKeys[provider] = raw.apiKey;
  const commands = (Array.isArray(raw.commands) ? raw.commands : IA_DEFAULTS.commands)
    .map((command) => String(command).trim())
    .filter((command) => command && command.length <= 20 && !/\s/.test(command))
    .slice(0, 10);
  const model = text(raw.model, 100).trim();
  const keywords = (Array.isArray(raw.keywords) ? raw.keywords : [])
    .map((keyword) => String(keyword).trim())
    .filter((keyword) => keyword && keyword.length <= 60)
    .slice(0, 20);
  return {
    provider,
    model: model || AI_PROVIDERS[provider].models[0] || '',
    baseUrl: provider === 'custom' ? text(raw.baseUrl, 300).trim() : '',
    temperature: clampNumber(raw.temperature, 0, 2, IA_DEFAULTS.temperature),
    maxTokens: Math.round(clampNumber(raw.maxTokens, 16, 8192, IA_DEFAULTS.maxTokens)),
    timeoutMs: Math.round(clampNumber(raw.timeoutMs, 3000, 120000, IA_DEFAULTS.timeoutMs)),
    historyLimit: Math.round(clampNumber(raw.historyLimit, 0, 30, IA_DEFAULTS.historyLimit)),
    perGroupCooldownMs: Math.round(clampNumber(raw.perGroupCooldownMs, 0, 600000, IA_DEFAULTS.perGroupCooldownMs)),
    triggerMode: triggerModeOf(raw),
    commands: commands.length ? commands : [...IA_DEFAULTS.commands],
    keywords,
    systemPrompt: text(raw.systemPrompt, 8000, IA_DEFAULTS.systemPrompt),
    fallbackText: text(raw.fallbackText, 1000, IA_DEFAULTS.fallbackText),
    onlyConfiguredGroups: raw.onlyConfiguredGroups !== false,
    ignoreMedia: raw.ignoreMedia !== false,
    ignoreOwnMessages: raw.ignoreOwnMessages !== false,
    replyQuoted: raw.replyQuoted !== undefined ? raw.replyQuoted === true : IA_DEFAULTS.replyQuoted,
    mentionSender: raw.mentionSender === true,
    showTyping: raw.showTyping !== undefined ? raw.showTyping === true : IA_DEFAULTS.showTyping,
    includeSenderName: raw.includeSenderName !== undefined ? raw.includeSenderName === true : IA_DEFAULTS.includeSenderName,
    maxReplyChars: Math.round(clampNumber(raw.maxReplyChars, 0, 20000, IA_DEFAULTS.maxReplyChars)),
    apiKeys,
  };
}

// Aplica los cambios que envía el panel. La clave solo cambia si se escribió
// una nueva (se guarda cifrada) o si se pidió borrarla.
export function mergeIaUpdate(current = {}, body = {}) {
  // apiKeys/apiKeysSet nunca vienen del panel: las claves solo cambian con apiKey/clearApiKey.
  // eslint-disable-next-line no-unused-vars
  const { apiKey, clearApiKey, apiKeys, apiKeysSet, ...rest } = body;
  const merged = normalizeIaConfig({ ...normalizeIaConfig(current), ...rest });
  if (merged.provider === 'custom' && merged.baseUrl) merged.baseUrl = validateCustomBaseUrl(merged.baseUrl);
  if (clearApiKey === true) delete merged.apiKeys[merged.provider];
  const newKey = String(apiKey || '').trim();
  if (newKey && !newKey.includes('*')) merged.apiKeys[merged.provider] = encryptSecret(newKey);
  return merged;
}

// Vista pública: nunca expone las claves, solo si están configuradas.
export function publicIaConfig(ia = {}) {
  const { apiKeys = {}, ...rest } = normalizeIaConfig(ia);
  return { ...rest, apiKeysSet: Object.fromEntries(Object.keys(apiKeys).map((provider) => [provider, true])) };
}

export function publicProviderCatalog(settings) {
  return Object.entries(AI_PROVIDERS)
    .filter(([id]) => id !== 'custom' || settings.aiAllowCustomEndpoints)
    .map(([id, provider]) => ({
      id,
      name: provider.name,
      description: provider.description,
      models: provider.models,
      supportsProfile: !!provider.supportsProfile,
      sharedKeyAvailable: id === 'dipisik' && settings.aiSharedDipisik && !!dipisikSharedKey(),
    }));
}

// Resuelve URL, clave y parámetros extra para llamar al proveedor elegido.
export function resolveIaEndpoint(ia, settings, accountId) {
  const provider = AI_PROVIDERS[ia.provider];
  if (!provider) throw new Error('Proveedor de IA desconocido');
  if (ia.provider === 'custom' && !settings.aiAllowCustomEndpoints) {
    throw new Error('El administrador no permite endpoints de IA personalizados');
  }
  const baseUrl = ia.provider === 'custom' ? ia.baseUrl : provider.baseUrl();
  if (!baseUrl) throw new Error('Falta la URL base del proveedor personalizado');

  let apiKey = decryptSecret(ia.apiKeys?.[ia.provider]);
  let usingSharedKey = false;
  if (!apiKey && ia.provider === 'dipisik' && settings.aiSharedDipisik) {
    apiKey = dipisikSharedKey();
    usingSharedKey = !!apiKey;
  }
  if (!apiKey && ia.provider !== 'custom') throw new Error(`Falta la API key de ${provider.name}`);

  return {
    baseUrl,
    apiKey,
    usingSharedKey,
    providerName: provider.name,
    extraBody: provider.supportsProfile ? { profile: dipisikProfileFor(accountId) } : {},
  };
}

const clients = new Map();
const MAX_CACHED_CLIENTS = 50;

// Reutiliza un cliente por combinación de credenciales y endpoint.
function clientFor({ apiKey, baseUrl, model, timeoutMs, providerName }) {
  const cacheKey = [apiKey, baseUrl, model, timeoutMs].join('|');
  let client = clients.get(cacheKey);
  if (!client) {
    if (clients.size >= MAX_CACHED_CLIENTS) clients.delete(clients.keys().next().value);
    client = new AiChatClient({ apiKey, baseUrl, model, timeoutMs, providerName });
    clients.set(cacheKey, client);
  }
  return client;
}

export async function askIa(ia, settings, messages, accountId) {
  const endpoint = resolveIaEndpoint(ia, settings, accountId);
  const client = clientFor({ ...endpoint, model: ia.model, timeoutMs: ia.timeoutMs });
  return client.chat({
    messages,
    temperature: ia.temperature,
    maxTokens: ia.maxTokens,
    extraBody: endpoint.extraBody,
  });
}

const provisionedProfiles = new Set();

// Crea el profile en Dipisik antes del primer uso para que quede listo en todas
// sus cuentas (si no, el primer mensaje tarda más). Es idempotente.
export async function ensureDipisikProfile(ia, settings, accountId) {
  if (ia.provider !== 'dipisik') return;
  const { baseUrl, apiKey } = resolveIaEndpoint(ia, settings, accountId);
  const profile = dipisikProfileFor(accountId);
  const cacheKey = `${baseUrl}|${profile}`;
  if (provisionedProfiles.has(cacheKey)) return;
  const response = await fetch(`${baseUrl}/profiles/${encodeURIComponent(profile)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Dipisik ${response.status} al crear el profile ${profile}`);
  provisionedProfiles.add(cacheKey);
}
