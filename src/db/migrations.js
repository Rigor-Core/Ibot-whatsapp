// Migraciones de datos idempotentes que se ejecutan al arrancar el servidor.
// Cada versión se aplica una sola vez por cuenta (schemaVersion en bot_configs).
export const CONFIG_SCHEMA_VERSION = 3;

const before = (version) => ({ $or: [{ schemaVersion: { $exists: false } }, { schemaVersion: { $lt: version } }] });

export async function runDataMigrations(collections) {
  // v2: el antiguo modo "normal" (respuestas rápidas a pedidos) pasa a llamarse
  // "repartidor" y "normal" queda solo para comandos de grupo. Se aplica una
  // sola vez por cuenta para no revertir a quien elija después el modo normal.
  const v2 = before(2);
  const modes = await collections.configs.updateMany(
    { ...v2, modo: { $in: ['normal', 'flash'] } },
    { $set: { modo: 'repartidor' } },
  );
  await collections.configs.updateMany(
    { ...v2, normal: { $exists: true } },
    { $rename: { normal: 'repartidor' } },
  );
  const markedV2 = await collections.configs.updateMany(v2, { $set: { schemaVersion: 2 } });
  if (markedV2.modifiedCount) {
    console.log(`[migrations] Modos v2: ${markedV2.modifiedCount} cuenta(s) revisada(s), ${modes.modifiedCount} pasaron a modo repartidor`);
  }

  // v3: "Ignorar mis propios mensajes" deja de ser una opción de cada modo y
  // pasa a ser una sola opción global que respetan todos los modos.
  const pendingV3 = await collections.configs
    .find(before(3), { projection: { accountId: 1, repartidor: 1, ia: 1, ignoreOwnMessages: 1 } })
    .toArray();
  for (const config of pendingV3) {
    const legacy = [config.ignoreOwnMessages, config.repartidor?.ignoreOwnMessages, config.ia?.ignoreOwnMessages]
      .find((value) => typeof value === 'boolean');
    await collections.configs.updateOne(
      { _id: config._id },
      {
        $set: { ignoreOwnMessages: legacy !== false, schemaVersion: 3 },
        $unset: { 'repartidor.ignoreOwnMessages': '', 'ia.ignoreOwnMessages': '' },
      },
    );
  }
  if (pendingV3.length) {
    console.log(`[migrations] v3: "ignorar mis mensajes" ahora es global en ${pendingV3.length} cuenta(s)`);
  }
}
