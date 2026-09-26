import todoist from './todoist/index.js';

// Extensiones: herramientas externas que la IA puede usar. Cada una vive en su
// propia carpeta (src/extensions/<id>/) y expone la misma interfaz:
//   id, name, description, fields, examples,
//   normalizeConfig(raw), publicConfig(config), mergeUpdate(current, body),
//   isConfigured(config), tools(config), isWrite(tool), execute(tool, args, { config }),
//   test(config), describe(tool, args, result)
// Para agregar otra: crear su carpeta e incluirla en esta lista.
const EXTENSIONS = Object.freeze([todoist]);
const BY_ID = new Map(EXTENSIONS.map((extension) => [extension.id, extension]));

// Nombre de cada extensión (lo usa el catálogo de permisos del administrador).
export const EXTENSION_CATALOG = Object.freeze(Object.fromEntries(EXTENSIONS.map((extension) => [extension.id, extension.name])));

export function getExtension(id) {
  return BY_ID.get(id) || null;
}

export function normalizeExtensionsConfig(raw = {}) {
  return Object.fromEntries(EXTENSIONS.map((extension) => [extension.id, extension.normalizeConfig(raw?.[extension.id])]));
}

// Lo que ve el usuario en Ajustes: solo las extensiones que el administrador
// le permite y nunca sus secretos.
export function publicExtensions(config, permissions) {
  const normalized = normalizeExtensionsConfig(config);
  return EXTENSIONS
    .filter((extension) => permissions?.extensions?.[extension.id])
    .map((extension) => ({
      id: extension.id,
      name: extension.name,
      description: extension.description,
      fields: extension.fields,
      examples: extension.examples || [],
      configured: extension.isConfigured(normalized[extension.id]),
      config: extension.publicConfig(normalized[extension.id]),
    }));
}

export function publicExtensionsConfig(config) {
  const normalized = normalizeExtensionsConfig(config);
  return Object.fromEntries(EXTENSIONS.map((extension) => [extension.id, extension.publicConfig(normalized[extension.id])]));
}

// Extensiones encendidas y configuradas de una cuenta.
export function activeExtensions(config) {
  const normalized = normalizeExtensionsConfig(config);
  return EXTENSIONS.filter((extension) => normalized[extension.id].enabled && extension.isConfigured(normalized[extension.id]));
}

// Definiciones de herramientas (formato OpenAI) de las extensiones activas.
export function extensionTools(config) {
  const normalized = normalizeExtensionsConfig(config);
  return activeExtensions(config).flatMap((extension) => extension.tools(normalized[extension.id]).map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  })));
}

// Ejecuta una herramienta de extensión. Devuelve también si cambió datos
// (para avisar al usuario) y una descripción legible de la acción.
export async function runExtensionTool(config, name, args) {
  const normalized = normalizeExtensionsConfig(config);
  const extension = activeExtensions(config).find((candidate) => candidate.tools(normalized[candidate.id]).some((tool) => tool.name === name));
  if (!extension) return null;
  const result = await extension.execute(name, args, { config: normalized[extension.id] });
  const write = extension.isWrite(name);
  return { extension, result, write, summary: write ? extension.describe(name, args, result) : '' };
}
