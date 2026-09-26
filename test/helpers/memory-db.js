// Colecciones en memoria con el subconjunto de la API de MongoDB que usan los
// servicios probados (filtros, actualizaciones, orden y proyección simples).
import { ObjectId } from 'mongodb';

const get = (doc, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc);

function set(doc, path, value) {
  const keys = path.split('.');
  let target = doc;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = value;
}

function unset(doc, path) {
  const keys = path.split('.');
  const parent = keys.slice(0, -1).reduce((value, key) => value?.[key], doc);
  if (parent) delete parent[keys.at(-1)];
}

const same = (a, b) => (a instanceof ObjectId || b instanceof ObjectId ? String(a) === String(b) : a === b);

function matchValue(value, condition) {
  if (condition instanceof RegExp) return typeof value === 'string' && condition.test(value);
  if (condition && typeof condition === 'object' && !(condition instanceof ObjectId) && !(condition instanceof Date)) {
    return Object.entries(condition).every(([op, arg]) => {
      if (op === '$in') return arg.some((item) => same(item, value));
      if (op === '$nin') return !arg.some((item) => same(item, value));
      if (op === '$ne') return !same(value, arg);
      if (op === '$lt') return value < arg;
      if (op === '$lte') return value <= arg;
      if (op === '$gt') return value > arg;
      if (op === '$gte') return value >= arg;
      if (op === '$exists') return (value !== undefined) === arg;
      if (op === '$type') return arg === 'string' ? typeof value === 'string' : true;
      if (op === '$regex') return new RegExp(arg, condition.$options || '').test(String(value ?? ''));
      if (op === '$options') return true;
      if (op === '$not') return !matchValue(value, arg);
      throw new Error(`memory-db: operador ${op} no soportado`);
    });
  }
  if (condition === null) return value === null || value === undefined;
  return same(value, condition);
}

export function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') return condition.every((part) => matches(doc, part));
    if (key === '$or') return condition.some((part) => matches(doc, part));
    return matchValue(get(doc, key), condition);
  });
}

function applyUpdate(doc, update, inserting) {
  for (const [path, value] of Object.entries(update.$set || {})) set(doc, path, value);
  if (inserting) for (const [path, value] of Object.entries(update.$setOnInsert || {})) set(doc, path, value);
  for (const path of Object.keys(update.$unset || {})) unset(doc, path);
  for (const [path, value] of Object.entries(update.$inc || {})) set(doc, path, (Number(get(doc, path)) || 0) + value);
}

function project(doc, projection) {
  if (!projection) return { ...doc };
  const copy = { ...doc };
  const include = Object.entries(projection).filter(([, on]) => on);
  if (!include.length) {
    for (const key of Object.keys(projection)) unset(copy, key);
    return copy;
  }
  return Object.fromEntries([['_id', doc._id], ...include.map(([key]) => [key, get(doc, key)])]);
}

class Cursor {
  constructor(rows, projection) {
    this.rows = rows;
    this.projection = projection;
  }

  sort(spec) {
    const entries = Object.entries(spec);
    this.rows.sort((a, b) => {
      for (const [key, dir] of entries) {
        const x = get(a, key);
        const y = get(b, key);
        if (x !== y) return (x > y ? 1 : -1) * dir;
      }
      return 0;
    });
    return this;
  }

  limit(n) {
    if (n) this.rows = this.rows.slice(0, n);
    return this;
  }

  async toArray() {
    return this.rows.map((row) => project(row, this.projection));
  }
}

export class MemoryCollection {
  constructor(docs = []) {
    this.docs = docs.map((doc) => ({ _id: new ObjectId(), ...doc }));
  }

  find(filter = {}, options = {}) {
    return new Cursor(this.docs.filter((doc) => matches(doc, filter)), options.projection);
  }

  async findOne(filter = {}, options = {}) {
    const cursor = this.find(filter, options);
    if (options.sort) cursor.sort(options.sort);
    return (await cursor.limit(1).toArray())[0] || null;
  }

  async insertOne(doc) {
    const stored = { _id: new ObjectId(), ...doc };
    this.docs.push(stored);
    return { insertedId: stored._id };
  }

  async updateOne(filter, update, options = {}) {
    const doc = this.docs.find((row) => matches(row, filter));
    if (doc) {
      applyUpdate(doc, update, false);
      return { matchedCount: 1, modifiedCount: 1 };
    }
    if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 };
    const created = { _id: new ObjectId(), ...Object.fromEntries(Object.entries(filter).filter(([key, value]) => !key.startsWith('$') && typeof value !== 'object')) };
    applyUpdate(created, update, true);
    this.docs.push(created);
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
  }

  async updateMany(filter, update) {
    const rows = this.docs.filter((doc) => matches(doc, filter));
    rows.forEach((doc) => applyUpdate(doc, update, false));
    return { matchedCount: rows.length, modifiedCount: rows.length };
  }

  async findOneAndUpdate(filter, update, options = {}) {
    const doc = this.docs.find((row) => matches(row, filter));
    if (!doc) return null;
    const before = { ...doc };
    applyUpdate(doc, update, false);
    return options.returnDocument === 'after' ? { ...doc } : before;
  }

  async deleteOne(filter) {
    const index = this.docs.findIndex((doc) => matches(doc, filter));
    if (index === -1) return { deletedCount: 0 };
    this.docs.splice(index, 1);
    return { deletedCount: 1 };
  }

  async deleteMany(filter) {
    const before = this.docs.length;
    this.docs = this.docs.filter((doc) => !matches(doc, filter));
    return { deletedCount: before - this.docs.length };
  }

  async countDocuments(filter = {}) {
    return this.docs.filter((doc) => matches(doc, filter)).length;
  }
}

export function memoryCollections(names, seed = {}) {
  return Object.fromEntries(names.map((name) => [name, new MemoryCollection(seed[name] || [])]));
}
