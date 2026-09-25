import { asBool, asNullableNumber, asNumber } from '../../core/utils.js';
import { normalizeGroupCommandSettings } from '../../services/admin-command-service.js';
import { normalizeReply } from './message-extractor.js';

export function normalizeGroupDoc(g = {}) {
  return {
    accountId: g.accountId,
    groupId: String(g.groupId || '').trim(),
    nombre: String(g.nombre || g.metadata?.subject || 'Sin nombre').trim(),
    grupo: String(g.grupo || g.categoria || 'otros').trim() || 'otros',
    tipoMensaje: ['texto', 'imagen', 'ambas'].includes(g.tipoMensaje) ? g.tipoMensaje : 'texto',
    responder: asBool(g.responder, false),
    respuesta: normalizeReply(g.respuesta || { text: '' }),
    duracion: Math.max(0, asNumber(g.duracion, 0)),
    independiente: asBool(g.independiente, false),
    limite: asNullableNumber(g.limite),
    contador: asNumber(g.contador, 0),
    commandSettings: normalizeGroupCommandSettings(g.commandSettings),
    metadata: g.metadata || {},
    createdAt: g.createdAt || new Date(),
    updatedAt: g.updatedAt || new Date(),
  };
}

export function cleanGroupPayload(body = {}, accountId) {
  const doc = normalizeGroupDoc({ ...body, accountId });
  let gid = doc.groupId.replace(/\s+/g, '');
  if (!gid) {
    throw new Error('El groupId es obligatorio');
  }
  if (!gid.includes('@')) {
    if (gid.includes('-') || gid.length > 12) {
      gid = gid + '@g.us';
    } else {
      gid = gid + '@s.whatsapp.net';
    }
  }
  doc.groupId = gid;

  if (!doc.groupId.endsWith('@g.us') && !doc.groupId.endsWith('@s.whatsapp.net')) {
    throw new Error('groupId inválido. Debe terminar en @g.us o @s.whatsapp.net');
  }
  if (!doc.nombre) doc.nombre = doc.groupId;
  return doc;
}
