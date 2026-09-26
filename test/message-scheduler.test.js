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
