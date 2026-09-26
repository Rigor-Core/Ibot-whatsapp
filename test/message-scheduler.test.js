import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateTimeToUtc, MessageScheduler } from '../src/services/message-scheduler.js';

test('convierte la hora de Hermosillo a UTC correctamente', () => {
  const date = localDateTimeToUtc('2026-07-27', '10:15', 'America/Hermosillo');
  assert.equal(date.toISOString(), '2026-07-27T17:15:00.000Z');
});

test('crea un mensaje programado persistente con el destino validado', async () => {
  let inserted = null;
  const scheduler = new MessageScheduler({
    collections: {
      scheduledMessages: {
        async insertOne(doc) {
          inserted = doc;
          return { insertedId: 'scheduled-1' };
        },
      },
    },
    registry: {},
  });
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Hermosillo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(tomorrow).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  const result = await scheduler.create({
    accountId: 'bot-1',
    message: 'Recordatorio',
    target: { type: 'group', jid: '120363000@g.us', name: 'Clientes' },
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localTime: `${parts.hour}:${parts.minute}`,
    timeZone: 'America/Hermosillo',
  });
  assert.equal(result.id, 'scheduled-1');
  assert.equal(inserted.status, 'pending');
  assert.equal(inserted.target.jid, '120363000@g.us');
});

test('calcula la siguiente fecha de un mensaje recurrente', async () => {
  const { nextOccurrence } = await import('../src/services/message-scheduler.js');
  const base = { localDate: '2026-09-25', localTime: '09:00', timeZone: 'America/Hermosillo' };
  const friday = Date.UTC(2026, 8, 25, 17);
  assert.equal(nextOccurrence({ ...base, repeat: 'none' }, friday), null);
  assert.equal(nextOccurrence({ ...base, repeat: 'daily' }, friday).localDate, '2026-09-26');
  assert.equal(nextOccurrence({ ...base, repeat: 'weekdays' }, friday).localDate, '2026-09-28');
  assert.equal(nextOccurrence({ ...base, repeat: 'weekly' }, friday).localDate, '2026-10-02');
  // Si el servidor estuvo apagado, salta hasta la siguiente fecha futura.
  assert.equal(nextOccurrence({ ...base, repeat: 'daily' }, Date.UTC(2026, 9, 1, 12)).localDate, '2026-10-01');
});

test('programa y envía un sticker seguido de texto, y libera el archivo al terminar', async () => {
  const sent = [];
  const released = [];
  const media = {
    meta: async (accountId, id) => (id === 'stk1' ? { id: 'stk1', kind: 'sticker' } : null),
    releaseUnused: async (accountId, ids) => { released.push(...ids); },
  };
  const runtime = {
    socket: {},
    status: 'connected',
    media: { messageContent: async (accountId, id, caption) => ({ sticker: Buffer.from(id), caption }) },
    send: async (jid, content, options) => { sent.push({ jid, content, options }); },
    logger: { info() {} },
    notify() {},
  };
  let stored = null;
  const scheduler = new MessageScheduler({
    collections: {
      scheduledMessages: {
        insertOne: async (doc) => { stored = doc; return { insertedId: 'job-1' }; },
        updateOne: async () => ({ modifiedCount: 1 }),
      },
    },
    registry: { get: async () => runtime, eventBus: { emit() {} } },
    media,
  });
  const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(inOneHour).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const target = { type: 'user', jid: '5215550000000@s.whatsapp.net', name: 'Ana' };
  const when = { localDate: `${parts.year}-${parts.month}-${parts.day}`, localTime: `${parts.hour}:${parts.minute}`, timeZone: 'UTC' };

  await assert.rejects(scheduler.create({ accountId: 'bot-1', target, ...when }), /Escribe un mensaje o adjunta/);
  await assert.rejects(scheduler.create({ accountId: 'bot-1', target, media: { type: 'image', mediaId: 'stk1' }, ...when }), /ya no existe/);
  await scheduler.create({ accountId: 'bot-1', target, message: '¡Feliz día!', media: { type: 'sticker', mediaId: 'stk1' }, ...when });
  assert.deepEqual(stored.media, { type: 'sticker', mediaId: 'stk1' });

  await scheduler.deliver({ ...stored, _id: 'job-1', attempts: 1 });
  assert.deepEqual(sent.map((item) => Object.keys(item.content)[0]), ['sticker', 'text']);
  assert.equal(sent[1].content.text, '¡Feliz día!');
  assert.deepEqual(sent.map((item) => item.options.origin), ['scheduled', 'scheduled']);
  assert.deepEqual(released, ['stk1']);
});
