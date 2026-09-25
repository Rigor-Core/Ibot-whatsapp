import { filtrarPalabras } from '../filters/keyword-filter.js';
import { messageAllowedByType, normalizeReply } from '../utils/message-extractor.js';

const EMPTY_OPTS = Object.freeze({});

export function handleNormal(extracted, ctx) {
  // Ignorar mensajes propios si ignoreOwnMessages está activado
  if (ctx.config.normal?.ignoreOwnMessages !== false && extracted.fromMe) return false;

  const cfg = ctx.groupsById.get(extracted.groupId);
  if (!cfg || !cfg.responder) return false;

  const isIndependent = !!cfg.independiente;
  if (!isIndependent && !ctx.config.respuestas) return false;

  const hasLimit = cfg.limite !== null && Number.isFinite(Number(cfg.limite));
  if (isIndependent && hasLimit) {
    if (ctx.state.independentLockGroupId && ctx.state.independentLockGroupId !== extracted.groupId) return false;
    if (!ctx.state.independentLockGroupId) ctx.state.independentLockGroupId = extracted.groupId;
    if (Number(cfg.contador || 0) >= Number(cfg.limite)) {
      return false;
    }
  }

  if (!messageAllowedByType(extracted, cfg.tipoMensaje)) return false;
  const filterEnabled = ctx.config.normal?.filterEnabled !== false;
  const shouldSend = extracted.mediaType === 'image'
    ? ['imagen', 'ambas'].includes(cfg.tipoMensaje)
    : filtrarPalabras(extracted.text, { enabled: filterEnabled });

  if (!shouldSend) return false;

  const reply = normalizeReply(cfg.respuesta);
  if (!reply?.text && !reply?.image && !reply?.video) return false;
  const opts = cfg.duracion > 0 ? { isEphemeral: true, ephemeralExpiration: cfg.duracion } : EMPTY_OPTS;

  // Incrementar contadores en memoria de forma síncrona para evitar condiciones de carrera en ráfagas
  ctx.state.ordenesRecibidas += 1;
  ctx.state.mensajesRespondidos += 1;
  cfg.contador = Number(cfg.contador || 0) + 1;
  ctx.queue.incOrder(extracted.groupId);

  const localLimitReached = hasLimit && cfg.contador >= cfg.limite;

  const decisionTime = performance.now() - (ctx.msgStartTime || performance.now());
  const sendStart = performance.now();

  ctx.socket.sendMessage(extracted.groupId, reply, opts)
    .then(() => {
      const sendTime = performance.now() - sendStart;
      const totalTime = performance.now() - (ctx.msgStartTime || sendStart);

      console.log(
        `[LATENCY] [${ctx.accountId}] Mensaje respondido en grupo ${extracted.groupId}:` +
        ` | Extracción: ${(ctx.extractionTime || 0).toFixed(2)}ms` +
        ` | Decisión/Filtro: ${(decisionTime - (ctx.extractionTime || 0)).toFixed(2)}ms` +
        ` | Envío Socket: ${sendTime.toFixed(2)}ms` +
        ` | TOTAL: ${totalTime.toFixed(2)}ms`
      );

      if (ctx.config.modo === 'watch') {
        ctx.chatStore.recordOutgoing({ groupId: extracted.groupId, groupName: cfg.nombre, text: reply.text || '[respuesta multimedia]' });
      }

      // Procesar persistencia en base de datos estrictamente después
      if (localLimitReached) disableGroup(ctx, extracted.groupId, cfg);

      const globalLimit = Number(ctx.config.normal?.globalLimit ?? 1);
      if (!isIndependent && globalLimit > 0 && ctx.state.mensajesRespondidos >= globalLimit) {
        ctx.state.mensajesRespondidos = 0;
        ctx.config.respuestas = false;
        ctx.collections.configs.updateOne(
          { accountId: ctx.accountId },
          { $set: { respuestas: false, updatedAt: new Date() } },
        ).catch(() => null);
        ctx.logger.info('normal', 'Respuestas globales desactivadas por límite', { globalLimit });
      }
    })
    .catch((err) => {
      // Revertir contadores locales si falló el envío
      cfg.contador = Math.max(0, cfg.contador - 1);
      ctx.state.ordenesRecibidas = Math.max(0, ctx.state.ordenesRecibidas - 1);
      ctx.state.mensajesRespondidos = Math.max(0, ctx.state.mensajesRespondidos - 1);

      ctx.logger.warn('normal', 'No se pudo enviar respuesta', { groupId: extracted.groupId, error: err.message });
    });

  return true;
}

function disableGroup(ctx, groupId, cfg) {
  cfg.responder = false;
  if (ctx.state.independentLockGroupId === groupId) ctx.state.independentLockGroupId = null;
  ctx.collections.groups.updateOne(
    { accountId: ctx.accountId, groupId },
    { $set: { responder: false, updatedAt: new Date() } },
  ).catch(() => null);
  ctx.logger.info('normal', 'Grupo desactivado por límite', { groupId, limite: cfg.limite });
}
