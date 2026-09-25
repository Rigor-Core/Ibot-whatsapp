import test from 'node:test';
import assert from 'node:assert/strict';
import { handleIa } from '../src/bot/modes/ia.js';
import { normalizeIaConfig } from '../src/services/ai-providers.js';

process.env.DIPISIK_API_KEY = 'clave';

function context(ia) {
  const sent = [];
  let asked = null;
  globalThis.fetch = async (url, options) => {
    asked = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'respuesta' } }] }), { status: 200 });
  };
  const ctx = {
    accountId: 'bot-x',
    config: { ia: normalizeIaConfig({ onlyConfiguredGroups: false, showTyping: false, perGroupCooldownMs: 0, ...ia }), respuestas: true },
    groupsById: new Map(),
    state: { aiCooldowns: new Map() },
    aiMemory: new Map(),
    collections: { settings: { findOne: async () => null } },
    logger: { info() {}, warn() {} },
    socket: { sendMessage: async (jid, content) => { sent.push(content.text); }, sendPresenceUpdate: async () => {} },
  };
  return { ctx, sent, asked: () => asked };
}
const message = (text) => ({ groupId: '1@g.us', text, senderId: 'a@lid', senderName: 'Ana', fromMe: false, raw: {} });

test('la IA responde según el disparador elegido', async () => {
  let t = context({ triggerMode: 'off' });
  assert.equal(await handleIa(message('hola'), t.ctx), false);

  t = context({ triggerMode: 'all' });
  assert.equal(await handleIa(message('hola'), t.ctx), true);
  assert.deepEqual(t.sent, ['respuesta']);

  t = context({ triggerMode: 'command', commands: ['/chat'] });
  assert.equal(await handleIa(message('hola'), t.ctx), false);
  assert.equal(await handleIa(message('/chat ¿qué hora es?'), t.ctx), true);
  assert.equal(t.asked().messages.at(-1).content, 'Ana: ¿qué hora es?');
  assert.equal(t.asked().profile, 'ibot-bot-x');

  t = context({ triggerMode: 'keyword', keywords: ['precio'] });
  assert.equal(await handleIa(message('hola'), t.ctx), false);
  assert.equal(await handleIa(message('¿Cuál es el PRECÍO del envío?'), t.ctx), true);
});
