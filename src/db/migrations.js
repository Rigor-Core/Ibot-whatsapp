// Migraciones de datos idempotentes que se ejecutan al arrancar el servidor.
export const CONFIG_SCHEMA_VERSION = 2;

export async function runDataMigrations(collections) {
  // v2: el antiguo modo "normal" (respuestas rápidas a pedidos) pasa a llamarse
  // "repartidor" y "normal" queda solo para comandos de grupo. Se aplica una
  // sola vez por cuenta para no revertir a quien elija después el modo normal.
  const pending = { $or: [{ schemaVersion: { $exists: false } }, { schemaVersion: { $lt: CONFIG_SCHEMA_VERSION } }] };
  const modes = await collections.configs.updateMany(
    { ...pending, modo: { $in: ['normal', 'flash'] } },
    { $set: { modo: 'repartidor' } },
  );
  await collections.configs.updateMany(
    { ...pending, normal: { $exists: true } },
    { $rename: { normal: 'repartidor' } },
  );
  const marked = await collections.configs.updateMany(pending, { $set: { schemaVersion: CONFIG_SCHEMA_VERSION } });
  if (marked.modifiedCount) {
    console.log(`[migrations] Modos v2: ${marked.modifiedCount} cuenta(s) revisada(s), ${modes.modifiedCount} pasaron a modo repartidor`);
  }
}
