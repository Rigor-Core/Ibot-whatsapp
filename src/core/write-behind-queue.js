import { dayKey } from './utils.js';

export class WriteBehindQueue {
  constructor({ collections, accountId, logger, timeZone }) {
    this.collections = collections;
    this.accountId = accountId;
    this.logger = logger;
    // Función que devuelve la zona horaria de la cuenta para agrupar estadísticas por día.
    this.timeZone = typeof timeZone === 'function' ? timeZone : () => timeZone;
    this.pendingCounters = 0;
    this.counterRetry = 0;
    this.pendingGroups = new Map();
    this.pendingDaily = new Map();
    this.timer = null;
    this.delayMs = 250;
  }

  // Camino crítico de respuesta: solo aritmética en memoria.
  incOrder(groupId) {
    this.pendingCounters += 1;
    const current = this.pendingGroups.get(groupId) || 0;
    this.pendingGroups.set(groupId, current + 1);
    this.schedule();
  }

  // Un reinicio explícito del contador de un grupo descarta sus incrementos
  // aún no persistidos (el contador global y la estadística diaria se conservan).
  dropGroupIncrements(groupId) {
    this.pendingGroups.delete(groupId);
  }

  hasPending() {
    return this.pendingCounters > 0
      || this.counterRetry > 0
      || this.pendingGroups.size > 0
      || this.pendingDaily.size > 0;
  }

  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush().catch((err) => {
      this.logger?.error('queue', 'Error persistiendo cola', { error: err.message });
    }), this.delayMs);
    this.timer.unref?.();
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    // Los incrementos nuevos se atribuyen al día actual; los reintentos del
    // contador global no se vuelven a sumar a la estadística diaria.
    const fresh = this.pendingCounters;
    const counterInc = fresh + this.counterRetry;
    this.pendingCounters = 0;
    this.counterRetry = 0;
    if (fresh > 0) {
      const day = dayKey(new Date(), this.timeZone());
      this.pendingDaily.set(day, (this.pendingDaily.get(day) || 0) + fresh);
    }
    const groupIncs = new Map(this.pendingGroups);
    const dailyIncs = new Map(this.pendingDaily);
    this.pendingGroups.clear();
    this.pendingDaily.clear();

    if (counterInc === 0 && groupIncs.size === 0 && dailyIncs.size === 0) return;

    // Operaciones etiquetadas para poder reencolar exactamente lo que falló
    const labeled = [];
    if (counterInc > 0) {
      labeled.push({
        label: 'counter',
        requeue: () => { this.counterRetry += counterInc; },
        promise: this.collections.counters.updateOne(
          { accountId: this.accountId, name: 'OrdenesRecibidas' },
          { $inc: { seq: counterInc }, $set: { updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        ),
      });
    }

    for (const [groupId, inc] of groupIncs) {
      labeled.push({
        label: `group:${groupId}`,
        requeue: () => this.pendingGroups.set(groupId, (this.pendingGroups.get(groupId) || 0) + inc),
        promise: this.collections.groups.updateOne(
          { accountId: this.accountId, groupId },
          { $inc: { contador: inc }, $set: { updatedAt: new Date() } },
        ),
      });
    }

    for (const [day, inc] of dailyIncs) {
      labeled.push({
        label: `daily:${day}`,
        requeue: () => this.pendingDaily.set(day, (this.pendingDaily.get(day) || 0) + inc),
        promise: this.collections.statsDaily.updateOne(
          { accountId: this.accountId, day },
          { $inc: { orders: inc }, $set: { updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        ),
      });
    }

    const results = await Promise.allSettled(labeled.map((l) => l.promise));

    results.forEach((result, index) => {
      if (result.status !== 'rejected') return;
      const entry = labeled[index];
      const reason = result.reason?.message || String(result.reason);
      this.logger?.error('queue', `Flush falló para ${entry.label}`, { error: reason });
      // Reencolar para no perder datos en silencio
      entry.requeue();
    });

    if (this.hasPending()) this.schedule();
  }
}
