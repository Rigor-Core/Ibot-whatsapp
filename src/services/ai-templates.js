import { ObjectId } from 'mongodb';

// Plantillas de comportamiento de la IA: cómo habla, qué sabe y si usa
// stickers. Se elige una por defecto y se puede cambiar por chat o grupo.
export const STICKER_MODES = Object.freeze(['never', 'sometimes', 'often']);
export const MAX_TEMPLATES = 30;

function text(value, max) {
  return value === undefined || value === null ? '' : String(value).slice(0, max);
}

export function normalizeTemplate(raw = {}) {
  const temperature = raw.temperature === null || raw.temperature === undefined || raw.temperature === ''
    ? null
    : Math.min(Math.max(Number(raw.temperature) || 0, 0), 2);
  return {
    name: text(raw.name, 60).trim() || 'Plantilla sin nombre',
    description: text(raw.description, 200).trim(),
    // Qué es y cómo debe comportarse (rol, datos del negocio, reglas).
    instructions: text(raw.instructions, 8000).trim(),
    // Ejemplos de cómo escribe el dueño para imitar su estilo.
    styleSamples: text(raw.styleSamples, 6000).trim(),
    // Aprender también de los mensajes reales que el dueño escribió.
    learnFromMe: raw.learnFromMe === true,
    stickerMode: STICKER_MODES.includes(raw.stickerMode) ? raw.stickerMode : 'never',
    stickerNotes: text(raw.stickerNotes, 1000).trim(),
    temperature,
  };
}

// Puntos de partida que el usuario puede crear y ajustar desde Ajustes.
export const TEMPLATE_PRESETS = Object.freeze([
  {
    key: 'asistente',
    name: 'Asistente',
    description: 'Útil, claro y breve. Ideal para tu chat personal.',
    instructions: 'Eres un asistente útil, amable y preciso. Responde de forma clara y breve; si te piden detalle, extiéndete. Si no sabes algo, dilo y propone cómo averiguarlo.',
    learnFromMe: false,
    stickerMode: 'never',
  },
  {
    key: 'imitarme',
    name: 'Hazte pasar por mí',
    description: 'Contesta como si fueras tú, con tu forma de escribir.',
    instructions: [
      'Responde como si fueras yo, el dueño de este WhatsApp. Nunca digas ni insinúes que eres una inteligencia artificial o un bot.',
      'Imita mi estilo: el largo de mis mensajes, mis muletillas, emojis, forma de saludar y de despedirme, tal como en los ejemplos.',
      'Si te preguntan algo personal que no sabes (planes, dinero, citas, datos), responde de forma natural sin inventar, por ejemplo: "déjame ver y te digo".',
      'No aceptes compromisos importantes en mi nombre.',
    ].join('\n'),
    styleSamples: 'Ejemplo: "jajaja va, ahorita te aviso"\nEjemplo: "sale, nos vemos al rato 👋"',
    learnFromMe: true,
    stickerMode: 'sometimes',
    stickerNotes: 'Uso stickers para reírme de algo gracioso o para cerrar la conversación.',
  },
  {
    key: 'vendedor',
    name: 'Vendedor',
    description: 'Atiende clientes, resuelve dudas y cierra ventas.',
    instructions: [
      'Eres el vendedor de [NOMBRE DEL NEGOCIO].',
      'Productos y precios: [LISTA DE PRODUCTOS Y PRECIOS].',
      'Horario: [HORARIO]. Entregas: [ZONAS Y COSTOS]. Formas de pago: [MÉTODOS].',
      'Objetivo: resolver dudas con precisión y cerrar la venta, con amabilidad y sin presionar.',
      'Para tomar un pedido pregunta producto, cantidad, dirección y forma de pago, y confirma un resumen al final.',
      'Nunca inventes productos, precios ni promociones que no estén aquí; si no sabes algo, di que lo consultas.',
    ].join('\n'),
    learnFromMe: false,
    stickerMode: 'never',
  },
  {
    key: 'soporte',
    name: 'Atención al cliente',
    description: 'Paciente y ordenado para resolver problemas.',
    instructions: 'Eres el equipo de atención al cliente de [NEGOCIO]. Escucha el problema, haz una pregunta a la vez para entenderlo, da pasos concretos para resolverlo y confirma si quedó resuelto. Si no puedes resolverlo, pide los datos de contacto y explica que un encargado lo atenderá.',
    learnFromMe: false,
    stickerMode: 'never',
  },
]);

function toObjectId(id) {
  const value = String(id || '');
  return ObjectId.isValid(value) && value.length === 24 ? new ObjectId(value) : null;
}

const publicTemplate = (doc) => ({ id: String(doc._id), ...normalizeTemplate(doc), updatedAt: doc.updatedAt });

export class AiTemplateStore {
  constructor({ collections }) {
    this.collections = collections;
  }

  async list(accountId) {
    const docs = await this.collections.aiTemplates.find({ accountId }).sort({ createdAt: 1 }).toArray();
    return docs.map(publicTemplate);
  }

  async create(accountId, body) {
    if (await this.collections.aiTemplates.countDocuments({ accountId }) >= MAX_TEMPLATES) {
      throw new Error(`Puedes tener hasta ${MAX_TEMPLATES} plantillas`);
    }
    const doc = { accountId, ...normalizeTemplate(body), createdAt: new Date(), updatedAt: new Date() };
    const result = await this.collections.aiTemplates.insertOne(doc);
    return publicTemplate({ ...doc, _id: result.insertedId });
  }

  async update(accountId, id, body) {
    const _id = toObjectId(id);
    if (!_id) return null;
    const result = await this.collections.aiTemplates.findOneAndUpdate(
      { _id, accountId },
      { $set: { ...normalizeTemplate(body), updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    const doc = result?.value !== undefined ? result.value : result;
    return doc ? publicTemplate(doc) : null;
  }

  async remove(accountId, id) {
    const _id = toObjectId(id);
    if (!_id) return false;
    return (await this.collections.aiTemplates.deleteOne({ _id, accountId })).deletedCount > 0;
  }
}
