import { ObjectId } from 'mongodb';

const DEFAULT_TIMEZONE = 'America/Hermosillo';
const MAX_MESSAGE_LENGTH = 4000;

export function isValidTimeZone(timeZone) {
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

  async create({ accountId, message, target, localDate, localTime, timeZone }) {
    const text = String(message || '').trim();
    if (!text) throw new Error('El mensaje es obligatorio');
    if (text.length > MAX_MESSAGE_LENGTH) throw new Error(`El mensaje no puede superar ${MAX_MESSAGE_LENGTH} caracteres`);
    const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
    const scheduledFor = localDateTimeToUtc(localDate, localTime, zone);
    if (scheduledFor.getTime() <= Date.now() + 15_000) {
      throw new Error('Selecciona una fecha y hora futura');
    }
    const doc = {
      accountId,
      target: normalizeTarget(target),
      message: text,
      timeZone: zone,
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

  async list(accountId, { limit = 30 } = {}) {
    const rows = await this.collections.scheduledMessages
      .find({ accountId })
      .sort({ scheduledFor: -1 })
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
    } catch (error) {
      const attempts = Number(job.attempts || 1);
      const canRetry = attempts < 5;
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
