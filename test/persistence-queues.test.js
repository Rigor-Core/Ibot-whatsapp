import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRegisteredCreds, useMongoDBAuthState } from '../src/bot/utils/mongo-auth-state.js';
import { WriteBehindQueue } from '../src/core/write-behind-queue.js';
import { dayKey } from '../src/core/utils.js';

// Colección falsa con escrituras lentas para detectar desorden entre lotes.
function fakeSessionCollection() {
  const docs = new Map();
  let calls = 0;
  return {
    docs,
    find: () => ({ toArray: async () => [...docs.values()] }),
    findOne: async ({ key }) => docs.get(key) || null,
    bulkWrite: async (ops) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, calls === 1 ? 30 : 1));
      for (const op of ops) {
        if (op.updateOne) docs.set(op.updateOne.filter.key, { key: op.updateOne.filter.key, data: op.updateOne.update.$set.data });
        if (op.deleteOne) docs.delete(op.deleteOne.filter.key);
      }
    },
  };
}

test('las llaves de la sesión se persisten en orden y gana la última versión', async () => {
  const collection = fakeSessionCollection();
  const auth = await useMongoDBAuthState(collection, 'bot-test');
  await auth.state.keys.set({ session: { a: { v: 1 } } });
  await auth.state.keys.set({ session: { a: { v: 2 } } });
  await auth.state.keys.set({ session: { a: { v: 3 }, b: { v: 1 } } });
  await auth.state.keys.set({ session: { b: null } });
  await auth.flush();
  assert.deepEqual(JSON.parse(collection.docs.get('session-a').data), { v: 3 });
  assert.equal(collection.docs.has('session-b'), false);
  const read = await auth.state.keys.get('session', ['a']);
  assert.deepEqual(read.a, { v: 3 });
});

test('al cerrar la sesión se descartan las escrituras pendientes', async () => {
  const collection = fakeSessionCollection();
  const auth = await useMongoDBAuthState(collection, 'bot-test');
  await auth.close();
  await auth.state.keys.set({ session: { tarde: { v: 1 } } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(collection.docs.has('session-tarde'), false);
});

test('solo hay sesión guardada cuando WhatsApp ya fue vinculado', async () => {
  const collection = fakeSessionCollection();
  const auth = await useMongoDBAuthState(collection, 'bot-test');
  assert.equal(await hasRegisteredCreds(collection, 'bot-test'), false);
  auth.state.creds.me = { id: '5216620000000:1@s.whatsapp.net' };
  await auth.saveCreds();
  assert.equal(await hasRegisteredCreds(collection, 'bot-test'), true);
});

test('la cola de contadores registra la estadística diaria y reintenta lo que falla', async () => {
  const writes = [];
  let failDaily = true;
  const updateOne = (name) => async (filter, update) => {
    if (name === 'statsDaily' && failDaily) {
      failDaily = false;
      throw new Error('fallo temporal');
    }
    writes.push({ name, filter, update });
  };
  const collections = {
    counters: { updateOne: updateOne('counters') },
    groups: { updateOne: updateOne('groups') },
    statsDaily: { updateOne: updateOne('statsDaily') },
  };
  const queue = new WriteBehindQueue({ collections, accountId: 'bot-test', timeZone: 'America/Hermosillo' });
  queue.incOrder('123@g.us');
  queue.incOrder('123@g.us');
  await queue.flush();
  clearTimeout(queue.timer);
  assert.equal(writes.find((w) => w.name === 'counters').update.$inc.seq, 2);
  assert.equal(writes.find((w) => w.name === 'groups').update.$inc.contador, 2);
  assert.equal(writes.some((w) => w.name === 'statsDaily'), false);

  await queue.flush();
  clearTimeout(queue.timer);
  const daily = writes.find((w) => w.name === 'statsDaily');
  assert.equal(daily.update.$inc.orders, 2);
  assert.equal(daily.filter.day, dayKey(new Date(), 'America/Hermosillo'));
  assert.equal(writes.filter((w) => w.name === 'counters').length, 1);
});

test('dayKey usa la zona horaria indicada', () => {
  const date = new Date('2026-03-10T05:30:00Z');
  assert.equal(dayKey(date, 'UTC'), '2026-03-10');
  assert.equal(dayKey(date, 'America/Hermosillo'), '2026-03-09');
});
