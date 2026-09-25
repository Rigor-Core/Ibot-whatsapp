// Migraciones de datos idempotentes que se ejecutan al arrancar el servidor.
const DEFAULT_DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://dipisik.rigorcore.com/v1';
const DEFAULT_DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

export async function runDataMigrations(collections) {
  // Configuraciones heredadas del proveedor z.ai: se migran una sola vez en la
  // base de datos en lugar de corregirlas en cada mensaje del modo IA.
  const [baseUrls, models] = await Promise.all([
    collections.configs.updateMany(
      { 'ia.baseUrl': { $regex: 'api\\.z\\.ai', $options: 'i' } },
      { $set: { 'ia.baseUrl': DEFAULT_DEEPSEEK_BASE_URL, updatedAt: new Date() } },
    ),
    collections.configs.updateMany(
      { 'ia.model': { $regex: '^glm-', $options: 'i' } },
      { $set: { 'ia.model': DEFAULT_DEEPSEEK_MODEL, updatedAt: new Date() } },
    ),
  ]);
  if (baseUrls.modifiedCount || models.modifiedCount) {
    console.log(`[migrations] IA heredada migrada a DeepSeek: ${baseUrls.modifiedCount} URL(s), ${models.modifiedCount} modelo(s)`);
  }
}
