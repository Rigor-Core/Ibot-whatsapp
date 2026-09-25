import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { BotRuntime } from '../src/bot/bot-runtime.js';

process.env.STORAGE_DIR = path.join(os.tmpdir(), 'ibot-test-storage');

function runtimeWithGroups(docs) {
  const store = { docs };
  const collections = {
    groups: { find: () => ({ toArray: async () => store.docs.map((doc) => structuredClone(doc)) }) },
  };
  const runtime = new BotRuntime({ accountId: 'bot-test', collections, eventBus: { emit() {} } });
  runtime.logger = { info() {}, warn() {}, error() {}, debug() {} };
  return { runtime, store };
}

const baseGroup = {
  _id: 'doc-1',
  accountId: 'bot-test',
  groupId: '123@g.us',
  nombre: 'Pedidos centro',
  responder: true,
  independiente: true,
  limite: 3,
  contador: 0,
};

test('una recarga no retrocede el contador en memoria ni cambia la identidad del grupo', async () => {
  const { runtime, store } = runtimeWithGroups([{ ...baseGroup }]);
  await runtime.reloadGroups();
  const group = runtime.groupsById.get('123@g.us');
  group.contador = 2; // respuestas aún no persistidas por la cola

  store.docs[0].contador = 1;
  store.docs[0].nombre = 'Pedidos norte';
  await runtime.reloadGroups();

  assert.equal(runtime.groupsById.get('123@g.us'), group);
  assert.equal(group.contador, 2);
  assert.equal(group.nombre, 'Pedidos norte');
});

test('un grupo desactivado en memoria al llegar a su límite no se reactiva con datos atrasados', async () => {
  const { runtime, store } = runtimeWithGroups([{ ...baseGroup }]);
  await runtime.reloadGroups();
  const group = runtime.groupsById.get('123@g.us');
  group.contador = 3;
  group.responder = false;

  store.docs[0].contador = 2;
  runtime.applyGroupDocument(store.docs[0]);
  assert.equal(group.responder, false);
  assert.equal(group.contador, 3);
});

test('el reinicio explícito del contador sí se aplica', async () => {
  const { runtime } = runtimeWithGroups([{ ...baseGroup, contador: 2 }]);
  await runtime.reloadGroups();
  runtime.queue.incOrder('123@g.us');
  runtime.setGroupCounter('123@g.us', 0);
  assert.equal(runtime.groupsById.get('123@g.us').contador, 0);
  assert.equal(runtime.queue.pendingGroups.has('123@g.us'), false);
  assert.equal(runtime.queue.pendingCounters, 1);
  clearTimeout(runtime.queue.timer);
});

test('reactivar un grupo que llegó a su límite y reiniciar su contador lo deja respondiendo', async () => {
  const { runtime, store } = runtimeWithGroups([{ ...baseGroup, contador: 3, responder: false }]);
  await runtime.reloadGroups();
  const group = runtime.groupsById.get('123@g.us');

  // Como hace la ruta PUT: primero el contador explícito, luego la recarga.
  store.docs[0] = { ...store.docs[0], contador: 0, responder: true };
  runtime.setGroupCounter('123@g.us', 0);
  await runtime.reloadGroups();
  assert.equal(group.responder, true);
  assert.equal(group.contador, 0);
});

test('el candado de grupos independientes se libera si el grupo deja de ser válido', async () => {
  const { runtime, store } = runtimeWithGroups([{ ...baseGroup }]);
  await runtime.reloadGroups();
  runtime.state.independentLockGroupId = '123@g.us';

  runtime.applyGroupDocument({ ...store.docs[0] });
  assert.equal(runtime.state.independentLockGroupId, '123@g.us');

  runtime.applyGroupDocument({ ...store.docs[0], responder: false });
  assert.equal(runtime.state.independentLockGroupId, null);

  runtime.state.independentLockGroupId = '123@g.us';
  store.docs = [];
  await runtime.reloadGroups();
  assert.equal(runtime.state.independentLockGroupId, null);
  assert.equal(runtime.ownsGroupDocument('doc-1'), false);
});

test('el repartidor precalienta dispositivos y sesiones de los grupos activos', async () => {
  const { runtime } = runtimeWithGroups([{ ...baseGroup }, { ...baseGroup, _id: 'doc-2', groupId: '456@g.us', responder: false }]);
  await runtime.reloadGroups();
  runtime.groupMetadataCache.set('123@g.us', { participants: [{ id: 'a@lid' }, { id: 'b@lid' }] });
  runtime.groupMetadataCache.set('456@g.us', { participants: [{ id: 'c@lid' }] });
  const calls = [];
  runtime.socket = {
    getUSyncDevices: async (jids) => { calls.push(['devices', jids]); return jids.map((jid) => ({ jid: jid.replace('@', ':1@') })); },
    assertSessions: async (jids) => { calls.push(['sessions', jids]); },
  };
  runtime.status = 'connected';
  runtime.config = { modo: 'repartidor' };
  await runtime.warmUpActiveGroups();
  assert.deepEqual(calls, [
    ['devices', ['a@lid', 'b@lid']],
    ['sessions', ['a:1@lid', 'b:1@lid']],
  ]);

  calls.length = 0;
  runtime.config = { modo: 'watch' };
  await runtime.warmUpActiveGroups();
  assert.deepEqual(calls, []);
});

test('solo se procesan mensajes recientes de la sesión actual', () => {
  const { runtime } = runtimeWithGroups([]);
  const nowSeconds = Math.floor(Date.now() / 1000);
  runtime.connectTime = nowSeconds - 60;
  assert.equal(runtime.isLiveMessage({ messageTimestamp: nowSeconds - 2 }), true);
  assert.equal(runtime.isLiveMessage({ messageTimestamp: nowSeconds - 30 }), false);
  assert.equal(runtime.isLiveMessage({ messageTimestamp: nowSeconds - 120 }), false);
});
