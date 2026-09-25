import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';

const RETRY_DELAY_MS = 1000;

const delay = (ms) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  timer.unref?.();
});

// Cola de persistencia serializada para las llaves de la sesión.
// - Nunca bloquea a Baileys: cifrar y enviar un mensaje actualiza llaves y la
//   respuesta del bot no debe esperar a MongoDB.
// - Las escrituras se aplican una tras otra y, si una llave cambia varias veces
//   antes de persistirse, solo se escribe su última versión. Así una escritura
//   vieja nunca pisa a una más nueva.
// - Si MongoDB falla, reintenta sin perder lo pendiente.
class AuthPersistenceQueue {
  constructor(collection, accountId) {
    this.collection = collection;
    this.accountId = accountId;
    this.pending = new Map(); // key -> JSON serializado | null (borrar)
    this.draining = null;
    this.closed = false;
  }

  enqueue(key, data) {
    if (this.closed) return;
    this.pending.set(key, data);
    this.drain();
  }

  drain() {
    if (!this.draining) {
      this.draining = this.run().finally(() => {
        this.draining = null;
        if (this.pending.size && !this.closed) this.drain();
      });
    }
    return this.draining;
  }

  async run() {
    while (this.pending.size && !this.closed) {
      const batch = new Map(this.pending);
      this.pending.clear();
      const ops = [...batch].map(([key, data]) => (data === null
        ? { deleteOne: { filter: { accountId: this.accountId, key } } }
        : {
          updateOne: {
            filter: { accountId: this.accountId, key },
            update: { $set: { data, updatedAt: new Date() } },
            upsert: true,
          },
        }));
      try {
        await this.collection.bulkWrite(ops, { ordered: true });
      } catch (err) {
        console.error(`[mongo-auth-state] Error persistiendo llaves de ${this.accountId}:`, err.message);
        // Reencolar solo lo que no fue reemplazado por una versión más nueva.
        for (const [key, data] of batch) {
          if (!this.pending.has(key)) this.pending.set(key, data);
        }
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  async flush() {
    while (this.draining) await this.draining;
  }

  // Descarta lo pendiente y espera a que termine la escritura en curso.
  // Se usa al cerrar sesión para que ninguna llave vuelva a aparecer después
  // de borrar la sesión.
  async close() {
    this.closed = true;
    this.pending.clear();
    await this.flush();
  }
}

export async function hasRegisteredCreds(collection, accountId) {
  const doc = await collection.findOne({ accountId, key: 'creds' }, { projection: { data: 1 } });
  if (!doc?.data) return false;
  try {
    return !!JSON.parse(doc.data)?.me?.id;
  } catch {
    return false;
  }
}

export async function useMongoDBAuthState(collection, accountId) {
  const cache = new Map();
  const queue = new AuthPersistenceQueue(collection, accountId);

  // Precargar todas las llaves de la cuenta de WhatsApp desde MongoDB
  try {
    const allDocs = await collection.find({ accountId }).toArray();
    for (const doc of allDocs) {
      if (doc.key && doc.data) {
        cache.set(doc.key, doc.data);
      }
    }
  } catch (err) {
    console.error(`[mongo-auth-state] Error al precargar llaves para ${accountId}:`, err.message);
  }

  // Las credenciales sí se esperan: son la identidad de la sesión y Baileys
  // las guarda fuera del camino de envío de mensajes.
  const writeCreds = async (data) => {
    const jsonStr = JSON.stringify(data, BufferJSON.replacer);
    cache.set('creds', jsonStr);
    queue.enqueue('creds', jsonStr);
    await queue.flush();
  };

  // Cargar credenciales iniciales de la caché
  const credsRaw = cache.get('creds');
  let creds = null;
  if (credsRaw) {
    try {
      creds = JSON.parse(credsRaw, BufferJSON.reviver);
    } catch {
      // Las credenciales dañadas se reemplazan por un estado nuevo.
    }
  }
  if (!creds) {
    creds = initAuthCreds();
    await writeCreds(creds);
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            const key = `${type}-${id}`;
            const raw = cache.get(key);
            let value = null;
            if (raw) {
              try {
                value = JSON.parse(raw, BufferJSON.reviver);
              } catch {
                // Una llave inválida se devuelve como null para que Baileys la regenere.
              }
            }
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                const jsonStr = JSON.stringify(value, BufferJSON.replacer);
                cache.set(key, jsonStr);
                queue.enqueue(key, jsonStr);
              } else {
                cache.delete(key);
                queue.enqueue(key, null);
              }
            }
          }
        },
      },
    },
    saveCreds: async () => {
      await writeCreds(creds);
    },
    flush: () => queue.flush(),
    close: () => queue.close(),
  };
}
