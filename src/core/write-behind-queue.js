export class WriteBehindQueue {
  constructor({ collections, accountId, logger }) {
    this.collections = collections;
    this.accountId = accountId;
    this.logger = logger;
    this.pendingCounters = 0;
    this.pendingGroups = new Map();
    this.timer = null;
    this.delayMs = 250;
  }

  incOrder(groupId) {
    this.pendingCounters += 1;
    const current = this.pendingGroups.get(groupId) || 0;
    this.pendingGroups.set(groupId, current + 1);
    this.schedule();
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
    const counterInc = this.pendingCounters;
    const groupIncs = new Map(this.pendingGroups.entries());
    this.pendingCounters = 0;
    this.pendingGroups.clear();

    if (counterInc === 0 && groupIncs.size === 0) return;

    // Build labeled operations so we can trace failures back to their source
    const labeled = [];
    if (counterInc > 0) {
      labeled.push({
        label: 'counter',
        counterInc,
        promise: this.collections.counters.updateOne(
          { accountId: this.accountId, name: 'OrdenesRecibidas' },
          { $inc: { seq: counterInc }, $set: { updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        ),
      });
    }

    for (const [groupId, inc] of groupIncs.entries()) {
      labeled.push({
        label: `group:${groupId}`,
        groupId,
        groupInc: inc,
        promise: this.collections.groups.updateOne(
          { accountId: this.accountId, groupId },
          { $inc: { contador: inc }, $set: { updatedAt: new Date() } },
        ),
      });
    }

    const results = await Promise.allSettled(labeled.map((l) => l.promise));

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        const entry = labeled[i];
        const reason = results[i].reason?.message || String(results[i].reason);
        this.logger?.error('queue', `Flush falló para ${entry.label}`, { error: reason });

        // Re-enqueue failed increments so data is not silently lost
        if (entry.counterInc) {
          this.pendingCounters += entry.counterInc;
        }
        if (entry.groupId && entry.groupInc) {
          const current = this.pendingGroups.get(entry.groupId) || 0;
          this.pendingGroups.set(entry.groupId, current + entry.groupInc);
        }
      }
    }

    // If any operations were re-enqueued, schedule another flush attempt
    if (this.pendingCounters > 0 || this.pendingGroups.size > 0) {
      this.schedule();
    }
  }
}
