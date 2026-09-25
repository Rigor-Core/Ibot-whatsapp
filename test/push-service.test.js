import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { PushService, normalizeNotificationPrefs } from '../src/services/push-service.js';
import { EventBus } from '../src/core/event-bus.js';

process.env.PANEL_SECRET = 'secreto-de-prueba';

function fakeCollections(preferences) {
  const subs = [];
  const settings = new Map();
  return {
    subs,
    settings: {
      findOne: async ({ _id }) => settings.get(_id) || null,
      updateOne: async ({ _id }, { $set }) => { settings.set(_id, { _id, ...$set }); },
    },
    configs: { findOne: async () => ({ notifications: preferences }) },
    pushSubscriptions: {
      updateOne: async ({ endpoint }, { $set }) => {
        const existing = subs.find((s) => s.endpoint === endpoint);
        if (existing) Object.assign(existing, $set);
        else subs.push({ _id: endpoint, endpoint, ...$set });
      },
      find: ({ accountId }) => {
        const rows = subs.filter((s) => s.accountId === accountId);
        const cursor = { sort: () => cursor, skip: (n) => { rows.splice(0, n); return cursor; }, toArray: async () => rows };
        return cursor;
      },
      deleteOne: async ({ _id }) => { const i = subs.findIndex((s) => s._id === _id); if (i >= 0) subs.splice(i, 1); },
      deleteMany: async () => {},
    },
  };
}

test('envía solo las alertas activadas y elimina dispositivos vencidos', async () => {
  const collections = fakeCollections({ order: false });
  const push = new PushService({ collections, eventBus: new EventBus() });
  await push.init();
  assert.ok(push.publicKey);

  await assert.rejects(push.subscribe('bot-x', { endpoint: 'http://inseguro', keys: {} }), /inválida/);
  await push.subscribe('bot-x', { endpoint: 'https://push.example/ok', keys: { p256dh: 'a', auth: 'b' } });
  await push.subscribe('bot-x', { endpoint: 'https://push.example/vencido', keys: { p256dh: 'a', auth: 'b' } });

  const sent = [];
  const original = webpush.sendNotification;
  webpush.sendNotification = async (subscription, payload) => {
    if (subscription.endpoint.endsWith('vencido')) throw Object.assign(new Error('gone'), { statusCode: 410 });
    sent.push(JSON.parse(payload));
  };
  try {
    assert.equal(await push.notify({ accountId: 'bot-x', type: 'order', title: 'x', body: 'y' }), 0);
    assert.equal(await push.notify({ accountId: 'bot-x', type: 'qr', title: 'QR', body: 'escanea' }), 1);
    assert.equal(sent[0].title, 'QR');
    assert.deepEqual(collections.subs.map((s) => s.endpoint), ['https://push.example/ok']);
  } finally {
    webpush.sendNotification = original;
  }
});

test('las preferencias por defecto activan todas las alertas', () => {
  assert.deepEqual(normalizeNotificationPrefs({ qr: false }), {
    disconnected: true, qr: false, order: true, groupLimit: true, scheduledFailed: true,
  });
});
