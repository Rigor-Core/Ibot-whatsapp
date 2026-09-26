import test from 'node:test';
import assert from 'node:assert/strict';
import { handleIa } from '../src/bot/modes/ia.js';
import { normalizeIaConfig } from '../src/services/ai-providers.js';
import { normalizeTemplate } from '../src/services/ai-templates.js';

process.env.DIPISIK_API_KEY = 'clave';

const SELF = '5215550000000@s.whatsapp.net';

// Respuestas del modelo en orden; cada una es texto o una llamada a herramienta.
function context({ ia = {}, respuestas = true, replies = ['respuesta'], history = [], searchResults = [], rules = [], templates = [] } = {}) {
  const sent = [];
  const requests = [];
  const searches = [];
  let call = 0;
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    const reply = replies[Math.min(call, replies.length - 1)];
    call += 1;
    const message = typeof reply === 'string'
      ? { content: reply }
      : { content: null, tool_calls: [{ id: `c${call}`, type: 'function', function: { name: reply.tool, arguments: JSON.stringify(reply.args || {}) } }] };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
  };
  const config = {
    ia: normalizeIaConfig({ groupScope: 'all', showTyping: false, perGroupCooldownMs: 0, rules, ...ia }),
    respuestas,
    ignoreOwnMessages: true,
    timezone: 'America/Hermosillo',
    extensions: {},
  };
  const runtime = {
    accountId: 'bot-x',
    config,
    aiRuleFor: (chatId) => config.ia.rules.find((rule) => rule.chatId === chatId) || null,
    aiTemplates: new Map(templates.map((template) => [template.id, { id: template.id, ...normalizeTemplate(template) }])),
    aiMemory: new Map(),
    socket: { user: { id: '5215550000000:3@s.whatsapp.net', name: 'Dueño' } },
    isSelfChat: (jid) => jid === SELF,
    mentionsMe: (extracted) => extracted.mentionedJids?.includes(SELF),
    chatName: (jid) => (jid === SELF ? 'Tú' : 'Ventas'),
    stickers: { list: async () => [] },
    chatStore: {
      readMessages: async () => history,
      searchMessages: async (query) => { searches.push(query); return searchResults; },
      listGroups: async () => [{ groupId: '9@g.us', subject: 'Ventas' }],
    },
    collections: { chatMessages: { find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }) } },
    notifyThrottled() {},
    logger: { info() {}, warn() {} },
  };
  const ctx = {
    accountId: 'bot-x',
    config,
    runtime,
    groupsById: new Map(),
    state: { aiCooldowns: new Map() },
    collections: { settings: { findOne: async () => null } },
    logger: { info() {}, warn() {} },
    socket: { sendPresenceUpdate: async () => {} },
    send: async (jid, content) => { sent.push({ jid, text: content.text }); },
  };
  return { ctx, sent, requests, searches };
}

const message = (text, extra = {}) => ({
  id: `m${Math.random()}`, groupId: '1@g.us', text, senderId: 'a@lid', senderName: 'Ana', fromMe: false, isGroup: true, mentionedJids: [], raw: {}, ...extra,
});

test('la IA responde según el disparador elegido', async () => {
  let t = context({ ia: { triggerMode: 'off', privateScope: 'all' } });
  assert.equal(await handleIa(message('hola'), t.ctx), false);
  // "Nunca en grupos" no apaga los chats privados.
  assert.equal(await handleIa(message('hola', { groupId: '2@s.whatsapp.net', isGroup: false }), t.ctx), true);

  t = context({ ia: { triggerMode: 'all' } });
  assert.equal(await handleIa(message('hola'), t.ctx), true);
  assert.deepEqual(t.sent.map((item) => item.text), ['respuesta']);

  t = context({ ia: { triggerMode: 'command', commands: ['/chat'] } });
  assert.equal(await handleIa(message('hola'), t.ctx), false);
  assert.equal(await handleIa(message('/chat ¿qué hora es?'), t.ctx), true);
  assert.equal(t.requests.at(-1).messages.at(-1).content, 'Ana: ¿qué hora es?');
  assert.equal(t.requests.at(-1).profile, 'ibot-bot-x');

  t = context({ ia: { triggerMode: 'keyword', keywords: ['precio'] } });
  assert.equal(await handleIa(message('hola'), t.ctx), false);
  assert.equal(await handleIa(message('¿Cuál es el PRECÍO del envío?'), t.ctx), true);

  t = context({ ia: { triggerMode: 'mention' } });
  assert.equal(await handleIa(message('hola a todos'), t.ctx), false);
  assert.equal(await handleIa(message('@bot hola', { mentionedJids: [SELF] }), t.ctx), true);
});

test('con respuestas apagadas la IA no responde en ningún chat', async () => {
  const t = context({ ia: { triggerMode: 'all', privateScope: 'all' }, respuestas: false });
  assert.equal(await handleIa(message('hola'), t.ctx), false);
  assert.equal(await handleIa(message('hola', { groupId: '2@s.whatsapp.net', isGroup: false }), t.ctx), false);
  assert.equal(await handleIa(message('hola', { groupId: SELF, isGroup: false, fromMe: true }), t.ctx), false);
  assert.equal(t.requests.length, 0);
});

test('chats privados según el alcance y las reglas por chat', async () => {
  const privateMessage = message('hola', { groupId: '2@s.whatsapp.net', isGroup: false });
  let t = context({ ia: { privateScope: 'selected' } });
  assert.equal(await handleIa(privateMessage, t.ctx), false);

  t = context({ ia: { privateScope: 'selected' }, rules: [{ chatId: '2@s.whatsapp.net', access: 'allow' }] });
  assert.equal(await handleIa(privateMessage, t.ctx), true);

  t = context({ ia: { privateScope: 'all', triggerMode: 'all' }, rules: [{ chatId: '1@g.us', access: 'block' }] });
  assert.equal(await handleIa(message('hola'), t.ctx), false);
  assert.equal(await handleIa(privateMessage, t.ctx), true);
});

test('asistente personal en mi chat: responde a mis mensajes sin comando', async () => {
  const mine = message('¿qué tengo hoy?', { groupId: SELF, isGroup: false, fromMe: true });
  let t = context({ ia: { triggerMode: 'command' } });
  assert.equal(await handleIa(mine, t.ctx), true);
  assert.match(t.requests[0].messages[0].content, /asistente personal/);

  t = context({ ia: { ownerAssistant: false } });
  assert.equal(await handleIa(mine, t.ctx), false);

  // En otros chats mis mensajes se ignoran (opción global activada).
  t = context({ ia: { triggerMode: 'all' } });
  assert.equal(await handleIa(message('hola', { fromMe: true }), t.ctx), false);
});

test('usa la plantilla del chat y el historial como contexto', async () => {
  const templateId = 'a'.repeat(24);
  const t = context({
    ia: { triggerMode: 'all', contextMessages: 10 },
    rules: [{ chatId: '1@g.us', access: 'inherit', templateId }],
    templates: [{ id: templateId, name: 'Vendedor', instructions: 'Vendes pasteles', styleSamples: 'jaja va' }],
    history: [
      { id: 'h1', ts: Date.now() - 60000, fromMe: false, senderName: 'Luis', text: 'hola' },
      { id: 'h2', ts: Date.now() - 30000, fromMe: true, origin: 'bot', text: '¿en qué te ayudo?' },
    ],
  });
  assert.equal(await handleIa(message('¿cuánto cuesta?'), t.ctx), true);
  const [system, first, second, last] = t.requests[0].messages;
  assert.match(system.content, /Vendes pasteles/);
  assert.match(system.content, /jaja va/);
  assert.equal(first.role, 'user');
  assert.match(first.content, /Luis: hola/);
  assert.deepEqual([second.role, second.content], ['assistant', '¿en qué te ayudo?']);
  assert.equal(last.content, 'Ana: ¿cuánto cuesta?');
});

test('la IA busca en el historial con herramientas antes de responder', async () => {
  const t = context({
    ia: { triggerMode: 'all' },
    replies: [{ tool: 'search_messages', args: { query: 'entrega', chat: 'Ventas' } }, 'La entrega es el viernes'],
    searchResults: [{ ts: Date.now(), fromMe: false, senderName: 'Ana', groupName: 'Ventas', text: 'la entrega es el viernes' }],
  });
  const mine = message('¿qué dijeron de la entrega?', { groupId: SELF, isGroup: false, fromMe: true });
  assert.equal(await handleIa(mine, t.ctx), true);
  assert.deepEqual(t.searches[0].chatIds, ['9@g.us']);
  assert.ok(t.requests[0].tools.some((tool) => tool.function.name === 'send_message'));
  assert.equal(t.requests[1].messages.at(-1).role, 'tool');
  assert.deepEqual(t.sent.map((item) => item.text), ['La entrega es el viernes']);
});

test('en chats de otras personas las herramientas solo ven esa conversación', async () => {
  const t = context({
    ia: { triggerMode: 'all' },
    replies: [{ tool: 'search_messages', args: { query: 'x', chat: 'Otro' } }, 'ok'],
  });
  assert.equal(await handleIa(message('busca x'), t.ctx), true);
  const names = t.requests[0].tools.map((tool) => tool.function.name);
  assert.ok(!names.includes('send_message') && !names.includes('list_chats'));
  assert.deepEqual(t.searches[0].chatIds, ['1@g.us']);
});

test('si el proveedor no admite herramientas responde sin ellas', async () => {
  const t = context({ ia: { triggerMode: 'all', provider: 'openai', apiKey: 'k', model: 'modelo-sin-tools' } });
  let call = 0;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    call += 1;
    if (body.tools) return new Response(JSON.stringify({ error: { message: 'tools are not supported' } }), { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'sin herramientas' } }] }), { status: 200 });
  };
  assert.equal(await handleIa(message('hola'), t.ctx), true);
  assert.equal(call, 2);
  assert.deepEqual(t.sent.map((item) => item.text), ['sin herramientas']);
});
