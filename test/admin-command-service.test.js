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

test('ejecuta status independientemente del modo principal', async () => {
  const sent = [];
  const config = normalizeAdminCommandsConfig({ enabled: true });
  const ctx = {
    config: { modo: 'watch', respuestas: false, adminCommands: config },
    groupsById: new Map([['120363000@g.us', {
      nombre: 'Clientes',
      commandSettings: { enabled: true, prefix: '!' },
    }]]),
    runtimeStatus: 'connected',
    socket: {
      async sendMessage(groupId, content) {
        sent.push({ groupId, content });
      },
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
  const handled = await handleAdminCommand({
    isGroup: true,
    fromMe: false,
    groupId: '120363000@g.us',
    senderId: '584121234567@s.whatsapp.net',
    text: '!status',
    raw: {},
  }, ctx);
  assert.equal(handled, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content.text, /Estado del bot: conectado/);
  assert.match(sent[0].content.text, /Modo principal: watch/);
});
