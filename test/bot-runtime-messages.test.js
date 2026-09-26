import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { BotRuntime } from '../src/bot/bot-runtime.js';
import { normalizeIaConfig } from '../src/services/ai-providers.js';
import { normalizeStorageConfig } from '../src/services/storage-service.js';
import { normalizeNotificationPrefs } from '../src/services/push-service.js';
import { memoryCollections } from './helpers/memory-db.js';

process.env.STORAGE_DIR = path.join(os.tmpdir(), 'ibot-test-storage');
const SELF = '5215550000000@s.whatsapp.net';

function makeRuntime({ modo = 'ia', storage = {}, notifications = {}, rules = [] } = {}) {
  const collections = memoryCollections(['chatMessages', 'chatGroups', 'contacts', 'media', 'stickers', 'scheduledMessages', 'groups']);
  const emitted = [];
  const runtime = new BotRuntime({ accountId: 'bot-test', collections, eventBus: { emit: (name, payload) => emitted.push({ name, payload }) } });
  runtime.logger = { info() {}, warn() {}, error() {}, debug() {} };
  runtime.config = {
    modo,
    respuestas: true,
    ignoreOwnMessages: true,
    ia: normalizeIaConfig({ rules }),
    storage: normalizeStorageConfig(storage),
    notifications: normalizeNotificationPrefs(notifications),
  };
  runtime.aiRules = new Map(runtime.config.ia.rules.map((rule) => [rule.chatId, rule]));
  const sent = [];
  runtime.socket = {
    user: { id: '5215550000000:7@s.whatsapp.net', lid: '99887766:7@lid', name: 'Dueño' },
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: options.messageId } }; },
  };
  runtime.status = 'connected';
  const dispatched = [];
  runtime.dispatchMode = (mode, extracted) => dispatched.push({ mode, chat: extracted.groupId });
  return { runtime, collections, emitted, sent, dispatched };
}

const upsert = (remoteJid, { fromMe = false, text = 'hola', id = `m${Math.random()}`, participant, message } = {}) => ({
  type: 'notify',
  messages: [{
    key: { remoteJid, fromMe, id, ...(participant ? { participant } : {}) },
    pushName: fromMe ? 'Dueño' : 'Ana',
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: message || { conversation: text },
  }],
});

test('la IA recibe chats privados; los demás modos solo grupos', async () => {
  let t = makeRuntime({ modo: 'ia' });
  await t.runtime.handleMessages(upsert('5216620000001@s.whatsapp.net'));
  await t.runtime.handleMessages(upsert('1203@g.us', { participant: 'a@s.whatsapp.net' }));
  assert.deepEqual(t.dispatched.map((item) => item.chat), ['5216620000001@s.whatsapp.net', '1203@g.us']);

  t = makeRuntime({ modo: 'normal' });
  await t.runtime.handleMessages(upsert('5216620000001@s.whatsapp.net'));
  assert.equal(t.dispatched.length, 0);
});

test('lo que envía el propio bot no se procesa y queda marcado en el chat', async () => {
  const { runtime, collections, dispatched } = makeRuntime();
  const sentMessage = await runtime.send(SELF, { text: 'respuesta' }, { origin: 'ia' });
  await runtime.handleMessages(upsert(SELF, { fromMe: true, text: 'respuesta', id: sentMessage.key.id }));
  assert.equal(dispatched.length, 0, 'no se responde a sí mismo');
  await new Promise((resolve) => setImmediate(resolve));
  const stored = collections.chatMessages.docs.find((doc) => doc.id === sentMessage.key.id);
  assert.equal(stored.origin, 'ia');
  assert.equal(stored.senderId, SELF);

  // Un mensaje mío escrito desde el teléfono sí llega (para el asistente personal).
  await runtime.handleMessages(upsert(SELF, { fromMe: true, text: '¿qué tengo hoy?' }));
  assert.equal(dispatched.length, 1);
  assert.equal(runtime.isSelfChat(SELF), true);
  assert.equal(runtime.isSelfChat('99887766@lid'), true);
  assert.equal(runtime.isSelfChat('5216620000001@s.whatsapp.net'), false);
});

test('respeta qué se guarda: textos, chats excluidos', async () => {
  let t = makeRuntime({ storage: { saveText: false } });
  await t.runtime.handleMessages(upsert('5216620000001@s.whatsapp.net', { text: 'secreto' }));
  assert.equal(t.collections.chatMessages.docs.length, 0);
  assert.equal(t.runtime.chatStore.groups.get('5216620000001@s.whatsapp.net').lastMessagePreview, 'Mensaje de texto', 'la lista de chats se actualiza sin mostrar el texto');

  t = makeRuntime({ storage: { excludedChats: ['5216620000001@s.whatsapp.net'] } });
  await t.runtime.handleMessages(upsert('5216620000001@s.whatsapp.net'));
  assert.equal(t.collections.chatMessages.docs.length, 0);
  assert.equal(t.runtime.chatStore.groups.size, 0);

  t = makeRuntime();
  await t.runtime.handleMessages(upsert('5216620000001@s.whatsapp.net', { text: 'se guarda' }));
  assert.equal(t.collections.chatMessages.docs[0].text, 'se guarda');
});

test('alertas: menciones, mensajes privados y palabras clave', async () => {
  const { runtime, emitted } = makeRuntime({ notifications: { privateMessage: true, keywords: ['urgente'] } });
  const alerts = () => emitted.filter((event) => event.name === 'notify').map((event) => event.payload.type);

  await runtime.handleMessages(upsert('1203@g.us', {
    participant: 'a@s.whatsapp.net',
    message: { extendedTextMessage: { text: '@dueño mira esto', contextInfo: { mentionedJid: ['99887766@lid'] } } },
  }));
  await runtime.handleMessages(upsert('5216620000001@s.whatsapp.net', { text: 'Es URGENTE' }));
  assert.deepEqual(alerts(), ['mention', 'privateMessage', 'keyword']);

  // El mismo chat no vuelve a avisar enseguida.
  await runtime.handleMessages(upsert('5216620000001@s.whatsapp.net', { text: 'otro' }));
  assert.equal(alerts().length, 3);
});

test('las reglas de IA de un contacto valen para su número y su LID', () => {
  const { runtime } = makeRuntime({ rules: [{ chatId: '5216620000001@s.whatsapp.net', access: 'allow' }] });
  runtime.contactsMap.set('123456@lid', { id: '5216620000001@s.whatsapp.net', phoneNumber: '5216620000001@s.whatsapp.net', lid: '123456@lid' });
  assert.equal(runtime.aiRuleFor('123456@lid')?.access, 'allow');
  assert.equal(runtime.aiRuleFor('5216620000001@s.whatsapp.net')?.access, 'allow');
  assert.equal(runtime.aiRuleFor('otro@lid'), null);
});
