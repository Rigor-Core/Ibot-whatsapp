import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDirectorySnapshot,
  directoryCsv,
  normalizeJid,
  paginateDirectory,
} from '../src/services/directory-service.js';

function cursor(rows) {
  return {
    limit() {
      return this;
    },
    async toArray() {
      return rows;
    },
  };
}

function fixture() {
  const databaseContacts = [
    {
      id: '584121234567@s.whatsapp.net',
      phoneNumber: '584121234567@s.whatsapp.net',
      lid: '1234567890@lid',
      name: '=Marta',
    },
    {
      id: '555000111@lid',
      lid: '555000111@lid',
      name: '@Contacto privado',
    },
  ];
  const senders = [
    {
      _id: '1234567890@lid',
      name: '=Marta',
      lastSeen: '2026-07-27T10:00:00.000Z',
      lastGroupId: '120363000@g.us',
      lastGroupName: 'Clientes',
    },
    {
      _id: '584141112233@s.whatsapp.net',
      name: '+Proveedor',
      lastSeen: '2026-07-27T11:00:00.000Z',
      lastGroupId: '584141112233@s.whatsapp.net',
      lastGroupName: 'Chat privado',
    },
  ];
  const configuredGroups = [{
    accountId: 'account-1',
    groupId: '120363000@g.us',
    nombre: 'Clientes',
    metadata: {
      subject: 'Clientes',
      participants: [
        {
          id: '1234567890@lid',
          phoneNumber: '584121234567@s.whatsapp.net',
          name: '=Marta',
          admin: 'admin',
        },
        {
          id: '999888777@lid',
          name: 'Luis',
          admin: null,
        },
      ],
    },
  }];

  const collections = {
    contacts: {
      find: () => cursor(databaseContacts),
    },
    chatMessages: {
      aggregate: () => cursor(senders),
    },
    groups: {
      find: () => cursor(configuredGroups),
      updateOne: async () => ({ acknowledged: true }),
    },
  };
  const runtime = {
    contactsMap: new Map(),
    groupMetadataCache: new Map(),
    socket: null,
    logger: {
      warn() {},
      debug() {},
    },
  };
  return { collections, runtime };
}

test('normaliza JID de dispositivo sin confundir un LID con un teléfono', () => {
  assert.equal(normalizeJid('584121234567:12@s.whatsapp.net'), '584121234567@s.whatsapp.net');
  assert.equal(normalizeJid('1234567890:4@lid'), '1234567890@lid');
});

test('construye el directorio, deduplica aliases y conserva LID sin teléfono', async () => {
  const { collections, runtime } = fixture();
  const snapshot = await buildDirectorySnapshot({
    accountId: 'account-1',
    collections,
    runtime,
  });

  assert.equal(snapshot.groupMembers.length, 2);
  assert.equal(snapshot.externalContacts.length, 2);
  assert.equal(snapshot.stats.uniqueGroupMembers, 2);

  const marta = snapshot.groupMembers.find((row) => row.name === '=Marta');
  assert.equal(marta.phone, '584121234567');
  assert.equal(marta.identityType, 'phone');
  assert.equal(snapshot.externalContacts.some((row) => row.name === '=Marta'), false);

  const luis = snapshot.groupMembers.find((row) => row.name === 'Luis');
  assert.equal(luis.phone, null);
  assert.equal(luis.identityType, 'lid');
});

test('filtra y pagina los resultados en el servidor', async () => {
  const { collections, runtime } = fixture();
  const snapshot = await buildDirectorySnapshot({
    accountId: 'account-1',
    collections,
    runtime,
  });
  const result = paginateDirectory(snapshot, {
    scope: 'external',
    q: 'proveedor',
    page: '1',
    limit: '25',
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, '+Proveedor');
  assert.equal(result.pagination.totalItems, 1);
});

test('neutraliza fórmulas de Excel en la exportación CSV', async () => {
  const { collections, runtime } = fixture();
  const snapshot = await buildDirectorySnapshot({
    accountId: 'account-1',
    collections,
    runtime,
  });
  const csv = directoryCsv(snapshot);

  assert.match(csv, /"'=Marta"/);
  assert.match(csv, /"'\+Proveedor"/);
  assert.match(csv, /"'@Contacto privado"/);
});
