import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';

export async function useMongoDBAuthState(collection, accountId) {
  const cache = new Map();

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

  const writeData = async (data, key) => {
    const jsonStr = JSON.stringify(data, BufferJSON.replacer);
    cache.set(key, jsonStr);
    // Await persistence so Baileys only gets confirmation after Mongo has written.
    // This prevents session corruption on crashes (especially for 'creds' identity key).
    await collection.updateOne(
      { accountId, key },
      { $set: { data: jsonStr, updatedAt: new Date() } },
      { upsert: true }
    ).catch((err) => {
      console.error(`[mongo-auth-state] Error en updateOne para ${key}:`, err.message);
    });
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
    await writeData(creds, 'creds');
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
          const ops = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                const jsonStr = JSON.stringify(value, BufferJSON.replacer);
                cache.set(key, jsonStr);
                ops.push({
                  updateOne: {
                    filter: { accountId, key },
                    update: { $set: { data: jsonStr, updatedAt: new Date() } },
                    upsert: true
                  }
                });
              } else {
                cache.delete(key);
                ops.push({
                  deleteOne: {
                    filter: { accountId, key }
                  }
                });
              }
            }
          }
          if (ops.length > 0) {
            // Ejecución asíncrona no bloqueante
            collection.bulkWrite(ops, { ordered: false }).catch((err) => {
              console.error(`[mongo-auth-state] Error en bulkWrite asíncrono para ${accountId}:`, err.message);
            });
          }
        },
      },
    },
    saveCreds: async () => {
      await writeData(creds, 'creds');
    },
  };
}
