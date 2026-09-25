import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeIaUpdate,
  normalizeIaConfig,
  publicIaConfig,
  publicProviderCatalog,
  resolveIaEndpoint,
} from '../src/services/ai-providers.js';
import { decryptSecret, encryptSecret } from '../src/core/secrets.js';

process.env.PANEL_SECRET = 'secreto-de-prueba';

const settings = { aiSharedDipisik: true, aiAllowCustomEndpoints: false };

test('convierte configuraciones antiguas al proveedor correcto sin perder la clave', () => {
  const ia = normalizeIaConfig({ provider: 'deepseek-compatible', baseUrl: 'https://api.z.ai/api/paas/v4', model: 'glm-4.5', apiKey: 'clave-zai' });
  assert.equal(ia.provider, 'zai');
  assert.equal(ia.model, 'glm-4.5');
  assert.equal(ia.apiKeys.zai, 'clave-zai');
  assert.equal(normalizeIaConfig({}).provider, 'dipisik');
  assert.equal(normalizeIaConfig({ baseUrl: 'https://dipisik.rigorcore.com/v1' }).provider, 'dipisik');
});

test('las claves se guardan cifradas, por proveedor, y nunca se exponen', () => {
  let ia = mergeIaUpdate({}, { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-secreta' });
  assert.notEqual(ia.apiKeys.openai, 'sk-secreta');
  assert.equal(decryptSecret(ia.apiKeys.openai), 'sk-secreta');

  ia = mergeIaUpdate(ia, { provider: 'groq', apiKey: 'gsk-otra', apiKeys: { openai: 'inyectada' } });
  assert.equal(decryptSecret(ia.apiKeys.openai), 'sk-secreta');
  assert.equal(decryptSecret(ia.apiKeys.groq), 'gsk-otra');

  const visible = publicIaConfig(ia);
  assert.equal(visible.apiKeys, undefined);
  assert.deepEqual(visible.apiKeysSet, { openai: true, groq: true });

  ia = mergeIaUpdate(ia, { provider: 'groq', clearApiKey: true });
  assert.equal(ia.apiKeys.groq, undefined);
});

test('Dipisik usa la clave del sistema y envía el profile', () => {
  process.env.DIPISIK_API_KEY = 'clave-servidor';
  const endpoint = resolveIaEndpoint(normalizeIaConfig({ provider: 'dipisik' }), settings, 'bot-65f1c2a4b7e8d9a0b1c2d3e4');
  assert.equal(endpoint.apiKey, 'clave-servidor');
  assert.equal(endpoint.usingSharedKey, true);
  assert.deepEqual(endpoint.extraBody, { profile: 'ibot-bot-65f1c2a4b7e8d9a0b1c2d3e4' });
  assert.throws(
    () => resolveIaEndpoint(normalizeIaConfig({ provider: 'dipisik' }), { ...settings, aiSharedDipisik: false }),
    /Falta la API key/,
  );
  delete process.env.DIPISIK_API_KEY;
});

test('los endpoints personalizados requieren permiso del administrador y una URL válida', () => {
  const custom = normalizeIaConfig({ provider: 'custom', baseUrl: 'http://localhost:11434/v1', model: 'llama3' });
  assert.throws(() => resolveIaEndpoint(custom, settings), /no permite endpoints/);
  const endpoint = resolveIaEndpoint(custom, { ...settings, aiAllowCustomEndpoints: true });
  assert.equal(endpoint.baseUrl, 'http://localhost:11434/v1');
  assert.equal(endpoint.apiKey, '');
  assert.throws(() => mergeIaUpdate({}, { provider: 'custom', baseUrl: 'ftp://servidor' }), /http o https/);
  assert.equal(publicProviderCatalog(settings).some((p) => p.id === 'custom'), false);
});

test('normaliza límites y valores fuera de rango', () => {
  const ia = normalizeIaConfig({ temperature: 9, maxTokens: 5, historyLimit: -3, commands: ['/ia', 'con espacio', ''], triggerMode: 'otro' });
  assert.equal(ia.temperature, 2);
  assert.equal(ia.maxTokens, 16);
  assert.equal(ia.historyLimit, 0);
  assert.deepEqual(ia.commands, ['/ia']);
  assert.equal(ia.triggerMode, 'command');
});

test('el disparador antiguo se convierte al nuevo', () => {
  assert.equal(normalizeIaConfig({ commandMode: 'required' }).triggerMode, 'command');
  assert.equal(normalizeIaConfig({ commandMode: 'all' }).triggerMode, 'all');
  assert.equal(normalizeIaConfig({ commandMode: 'optional' }).triggerMode, 'all');
  assert.equal(normalizeIaConfig({ triggerMode: 'off', commandMode: 'all' }).triggerMode, 'off');
});

test('cifrado de secretos: ida y vuelta, y compatibilidad con valores sin cifrar', () => {
  const stored = encryptSecret('valor');
  assert.match(stored, /^enc:v1:/);
  assert.equal(decryptSecret(stored), 'valor');
  assert.equal(decryptSecret('antiguo-sin-cifrar'), 'antiguo-sin-cifrar');
  assert.equal(decryptSecret(`${stored}x`), '');
});
