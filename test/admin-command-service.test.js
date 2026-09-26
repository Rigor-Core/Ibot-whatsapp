import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleAdminCommand,
  normalizeAdminCommandsConfig,
  normalizeGroupCommandSettings,
  renderGroupEventMessage,
} from '../src/services/admin-command-service.js';

test('normaliza comandos, roles y configuración del grupo', () => {
  const commands = normalizeAdminCommandsConfig({
    enabled: true,
    definitions: {
      ban: { enabled: false, roles: ['admin', 'owner', 'invalid'] },
    },
  });
  assert.equal(commands.enabled, true);
  assert.equal(commands.definitions.ban.enabled, false);
  assert.deepEqual(commands.definitions.ban.roles, ['admin', 'owner']);
  assert.deepEqual(commands.definitions.help.roles, ['user', 'admin', 'owner']);

  const group = normalizeGroupCommandSettings({
    enabled: true,
    prefix: '!!',
    welcomeMessage: 'Hola {user}',
  });
  assert.equal(group.prefix, '!!');
  assert.equal(group.enabled, true);
  assert.equal(group.welcomeMessage, 'Hola {user}');
});

test('renderiza mensajes de entrada y salida con menciones', () => {
  assert.equal(
    renderGroupEventMessage('Hola {user}, bienvenido a {group}', {
      userJid: '584121234567@s.whatsapp.net',
      groupName: 'Clientes',
    }),
    'Hola @584121234567, bienvenido a Clientes',
  );
});

function commandContext({ respuestas = true, ignoreOwnMessages = true } = {}) {
  const sent = [];
  const ctx = {
    config: { modo: 'watch', respuestas, ignoreOwnMessages, adminCommands: normalizeAdminCommandsConfig({ enabled: true }) },
    groupsById: new Map([['120363000@g.us', {
      nombre: 'Clientes',
      commandSettings: { enabled: true, prefix: '!' },
    }]]),
    runtimeStatus: 'connected',
    async send(groupId, content) {
      sent.push({ groupId, content });
    },
    async getGroupMetadata() {
      return {
        owner: '584121234567@s.whatsapp.net',
        participants: [{ id: '584121234567@s.whatsapp.net', admin: 'superadmin' }],
      };
    },
    logger: { warn() {} },
    markBanned() {},
    unmarkBanned() {},
  };
  return { ctx, sent };
}

const statusCommand = (fromMe = false) => ({
  isGroup: true,
  fromMe,
  groupId: '120363000@g.us',
  senderId: '584121234567@s.whatsapp.net',
  text: '!status',
  raw: {},
});

test('ejecuta status independientemente del modo principal', async () => {
  const { ctx, sent } = commandContext();
  const handled = await handleAdminCommand(statusCommand(), ctx);
  assert.equal(handled, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content.text, /Estado del bot: conectado/);
  assert.match(sent[0].content.text, /Modo principal: watch/);
});

test('con respuestas apagadas los comandos no responden', async () => {
  const { ctx, sent } = commandContext({ respuestas: false });
  assert.equal(await handleAdminCommand(statusCommand(), ctx), false);
  assert.equal(sent.length, 0);
});

test('mis propios comandos solo cuentan si no se ignoran mis mensajes', async () => {
  let { ctx, sent } = commandContext();
  assert.equal(await handleAdminCommand(statusCommand(true), ctx), false);
  assert.equal(sent.length, 0);
  ({ ctx, sent } = commandContext({ ignoreOwnMessages: false }));
  assert.equal(await handleAdminCommand(statusCommand(true), ctx), true);
  assert.equal(sent.length, 1);
});
