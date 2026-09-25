// Caché en memoria con caducidad, compatible con la interfaz CacheStore de Baileys
// (get/set/del/flushAll y, opcionalmente, mget/mset).
export class TtlCache {
  constructor({ ttlMs, maxEntries = 50000 }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    if (this.entries.has(key)) this.entries.delete(key);
    else if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  mget(keys) {
    const result = {};
    for (const key of keys) {
      const value = this.get(key);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }

  mset(items) {
    for (const { key, value } of items) this.set(key, value);
  }

  del(key) {
    this.entries.delete(key);
  }

  flushAll() {
    this.entries.clear();
  }
}
