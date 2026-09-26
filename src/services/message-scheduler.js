import { ObjectId } from 'mongodb';
import { DEFAULT_TIMEZONE } from '../core/utils.js';

const MAX_MESSAGE_LENGTH = 4000;

export function isValidTimeZone(timeZone) {
  // Intl acepta timeZone undefined (usa la zona del servidor); aquí no es válido.
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function timeZoneOffset(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return localAsUtc - date.getTime();
}

export function localDateTimeToUtc(localDate, localTime, timeZone = DEFAULT_TIMEZONE) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(localDate || ''));
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(localTime || ''));
  if (!dateMatch || !timeMatch || !isValidTimeZone(timeZone)) {
    throw new Error('Fecha, hora o zona horaria inválida');
  }
  const [, year, month, day] = dateMatch.map(Number);
  const [, hour, minute] = timeMatch.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new Error('Fecha u hora inválida');
  }

  const base = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = base;
  for (let pass = 0; pass < 3; pass += 1) {
    utc = base - timeZoneOffset(new Date(utc), timeZone);
  }
  const result = new Date(utc);
  const resolved = zonedParts(result, timeZone);
  if (
    resolved.year !== year
    || resolved.month !== month
    || resolved.day !== day
    || resolved.hour !== hour
    || resolved.minute !== minute
  ) {
    throw new Error('La fecha y hora no existen en la zona horaria seleccionada');
  }
  return result;
}

// Repeticiones: none (una vez), daily (cada día), weekdays (lunes a viernes), weekly (cada semana).
export const REPEAT_OPTIONS = Object.freeze(['none', 'daily', 'weekdays', 'weekly']);

function addDays(localDate, days) {
  const [year, month, day] = localDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function weekday(localDate) {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// Siguiente fecha local de una serie, siempre en el futuro (aunque el servidor
// haya estado apagado varios días).
export function nextOccurrence({ localDate, localTime, timeZone, repeat }, now = Date.now()) {
  if (!REPEAT_OPTIONS.includes(repeat) || repeat === 'none') return null;
  let date = localDate;
  for (let guard = 0; guard < 800; guard += 1) {
    date = addDays(date, repeat === 'weekly' ? 7 : 1);
    if (repeat === 'weekdays' && [0, 6].includes(weekday(date))) continue;
    const scheduledFor = localDateTimeToUtc(date, localTime, timeZone);
    if (scheduledFor.getTime() > now) return { localDate: date, scheduledFor };
  }
  return null;
}

function normalizeTarget(target = {}) {
  const type = target.type === 'group' ? 'group' : 'user';
  const jid = String(target.jid || '').trim();
  const validSuffix = type === 'group'
    ? jid.endsWith('@g.us')
    : (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us') || jid.endsWith('@lid'));
  if (!validSuffix) throw new Error('El destinatario de WhatsApp no es válido');
  return {
    type,
    jid,
    name: String(target.name || jid).trim().slice(0, 160),
  };
}

export class MessageScheduler {
  constructor({ collections, registry, intervalMs = 15_000 }) {
    this.collections = collections;
    this.registry = registry;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((error) => {
      console.error('[scheduler] Error procesando mensajes:', error);
    }), this.intervalMs);
    this.timer.unref?.();
    this.tick().catch((error) => console.error('[scheduler] Error inicial:', error));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  isRunning() {
    return !!this.timer;
  }

  async create({ accountId, message, target, localDate, localTime, timeZone, repeat = 'none' }) {
    const text = String(message || '').trim();
    if (!text) throw new Error('El mensaje es obligatorio');
    if (text.length > MAX_MESSAGE_LENGTH) throw new Error(`El mensaje no puede superar ${MAX_MESSAGE_LENGTH} caracteres`);
    const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
    const scheduledFor = localDateTimeToUtc(localDate, localTime, zone);
    if (scheduledFor.getTime() <= Date.now() + 15_000) {
      throw new Error('Selecciona una fecha y hora futura');
    }
    if (!REPEAT_OPTIONS.includes(repeat)) throw new Error('Repetición inválida');
    const doc = {
      accountId,
      target: normalizeTarget(target),
      message: text,
      timeZone: zone,
      repeat,
      localDate,
      localTime,
      scheduledFor,
      nextAttemptAt: scheduledFor,
      status: 'pending',
      attempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await this.collections.scheduledMessages.insertOne(doc);
    return { ...doc, id: String(result.insertedId), _id: undefined };
  }

  async list(accountId, { limit = 30, status } = {}) {
    const filter = { accountId };
    if (status === 'pending') filter.status = { $in: ['pending', 'processing'] };
    else if (status === 'history') filter.status = { $in: ['sent', 'failed', 'cancelled'] };
    const rows = await this.collections.scheduledMessages
      .find(filter)
      .sort({ scheduledFor: status === 'pending' ? 1 : -1 })
      .limit(Math.min(Math.max(Number(limit) || 30, 1), 100))
      .toArray();
    return rows.map(({ _id, ...row }) => ({ ...row, id: String(_id) }));
  }

  async cancel(accountId, id) {
    if (!ObjectId.isValid(id)) throw new Error('Mensaje programado inválido');
    const result = await this.collections.scheduledMessages.updateOne(
      { _id: new ObjectId(id), accountId, status: 'pending' },
      { $set: { status: 'cancelled', updatedAt: new Date() } },
    );
    return result.modifiedCount > 0;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.collections.scheduledMessages.updateMany(
        {
          status: 'processing',
          processingAt: { $lte: new Date(Date.now() - 5 * 60_000) },
        },
        {
          $set: {
            status: 'pending',
            nextAttemptAt: new Date(),
            updatedAt: new Date(),
            lastError: 'El proceso anterior se interrumpió antes de confirmar el envío',
          },
          $unset: { processingAt: '' },
        },
      );
      for (let index = 0; index < 20; index += 1) {
        const claimResult = await this.collections.scheduledMessages.findOneAndUpdate(
          {
            status: 'pending',
            nextAttemptAt: { $lte: new Date() },
          },
          {
            $set: {
              status: 'processing',
              processingAt: new Date(),
              updatedAt: new Date(),
            },
            $inc: { attempts: 1 },
          },
          { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
        );
        const claimed = claimResult?.value || claimResult;
        if (!claimed) break;
        await this.deliver(claimed);
      }
    } finally {
      this.running = false;
    }
  }

  // Crea la siguiente ocurrencia de un mensaje recurrente.
  async scheduleNext(job) {
    const next = nextOccurrence(job);
    if (!next) return;
    await this.collections.scheduledMessages.insertOne({
      accountId: job.accountId,
      target: job.target,
      message: job.message,
      timeZone: job.timeZone,
      repeat: job.repeat,
      seriesId: job.seriesId || job._id,
      localDate: next.localDate,
      localTime: job.localTime,
      scheduledFor: next.scheduledFor,
      nextAttemptAt: next.scheduledFor,
      status: 'pending',
      attempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async deliver(job) {
    try {
      const runtime = await this.registry.get(job.accountId);
      if (!runtime.socket || runtime.status !== 'connected') {
        throw new Error('El bot no está conectado');
      }
      await runtime.socket.sendMessage(job.target.jid, { text: job.message });
      await this.collections.scheduledMessages.updateOne(
        { _id: job._id, status: 'processing' },
        { $set: { status: 'sent', sentAt: new Date(), updatedAt: new Date() }, $unset: { processingAt: '' } },
      );
      runtime.logger.info('scheduler', 'Mensaje programado enviado', {
        target: job.target.jid,
        scheduledFor: job.scheduledFor,
      });
      await this.scheduleNext(job);
    } catch (error) {
      const attempts = Number(job.attempts || 1);
      const canRetry = attempts < 5;
      // Una serie continúa aunque un envío falle definitivamente.
      if (!canRetry) await this.scheduleNext(job).catch(() => null);
      if (!canRetry) {
        this.registry.eventBus.emit('notify', {
          accountId: job.accountId,
          type: 'scheduledFailed',
          title: 'Mensaje programado no enviado',
          body: `No se pudo enviar a ${job.target?.name || job.target?.jid}: ${error.message}`,
          tag: `scheduled-${job._id}`,
          url: '/contactos.html',
        });
      }
      await this.collections.scheduledMessages.updateOne(
        { _id: job._id, status: 'processing' },
        {
          $set: {
            status: canRetry ? 'pending' : 'failed',
            ...(canRetry ? { nextAttemptAt: new Date(Date.now() + 60_000) } : { failedAt: new Date() }),
            lastError: error.message,
            updatedAt: new Date(),
          },
          $unset: { processingAt: '' },
        },
      );
    }
  }
}
