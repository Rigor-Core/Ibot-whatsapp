import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureIndexes } from '../src/db/mongo.js';

test('elimina índices únicos heredados que mezclaban datos entre cuentas', async () => {
  const dropped = [];
  const database = {
    collection: (name) => ({
      collectionName: name,
      createIndex: async () => 'ok',
      dropIndex: async (index) => { dropped.push(`${name}.${index}`); },
      indexes: async () => (name === 'groups'
        ? [
          { name: '_id_', key: { _id: 1 }, unique: true },
          { name: 'groupId_1', key: { groupId: 1 }, unique: true },
          { name: 'accountId_1_groupId_1', key: { accountId: 1, groupId: 1 }, unique: true },
        ]
        : []),
    }),
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await ensureIndexes(database);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(dropped, ['groups.groupId_1']);
});
