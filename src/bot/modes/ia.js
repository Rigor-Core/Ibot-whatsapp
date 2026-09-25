import { askIa } from '../../services/ai-providers.js';
import { getSystemSettingsCached } from '../../services/settings-service.js';

function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Decide si la IA responde y qué texto le envía según el disparador elegido.
function parseTrigger(text, ia) {
  const trimmed = String(text || '').trim();
  if (ia.triggerMode === 'all') return trimmed;
  if (ia.triggerMode === 'command') {
    const lower = trimmed.toLowerCase();
    const found = ia.commands.find((cmd) => lower === cmd.toLowerCase() || lower.startsWith(`${cmd.toLowerCase()} `));
    return found ? trimmed.slice(found.length).trim() : '';
  }
  if (ia.triggerMode === 'keyword') {
    const normalized = stripAccents(trimmed);
    return ia.keywords.some((keyword) => normalized.includes(stripAccents(keyword))) ? trimmed : '';
  }
  return '';
}

function remember(ctx, groupId, role, content, limit) {
  if (limit <= 0) return;
  if (!ctx.aiMemory.has(groupId)) ctx.aiMemory.set(groupId, []);
  const history = ctx.aiMemory.get(groupId);
  history.push({ role, content: String(content || '').slice(0, 2000) });
  while (history.length > limit) history.shift();
}

function mentionFor(jid) {
  return `@${String(jid || '').split('@')[0].split(':')[0]}`;
}

// Modo IA: responde en los grupos con el proveedor y la personalidad que el
// usuario configuró. Se ejecuta sin bloquear el procesamiento de otros mensajes.
export async function handleIa(extracted, ctx) {
  const ia = ctx.config.ia;
  if (ia.triggerMode === 'off') return false;
  if (ia.ignoreOwnMessages && extracted.fromMe) return false;
  if (ia.ignoreMedia && extracted.mediaType && !extracted.text) return false;

  const cfg = ctx.groupsById.get(extracted.groupId);
  if (ia.onlyConfiguredGroups) {
    if (!cfg || !cfg.responder) return false;
    if (!cfg.independiente && !ctx.config.respuestas) return false;
  }

  const prompt = parseTrigger(extracted.text, ia);
  if (!prompt) return false;

  const now = Date.now();
  const last = ctx.state.aiCooldowns.get(extracted.groupId) || 0;
  if (ia.perGroupCooldownMs > 0 && now - last < ia.perGroupCooldownMs) return false;
  ctx.state.aiCooldowns.set(extracted.groupId, now);

  const memoryLimit = ia.historyLimit * 2;
  const history = ctx.aiMemory.get(extracted.groupId) || [];
  const userContent = ia.includeSenderName && extracted.senderName
    ? `${extracted.senderName}: ${prompt}`
    : prompt;
  const messages = [
    ...(ia.systemPrompt ? [{ role: 'system', content: ia.systemPrompt }] : []),
    ...history.slice(-memoryLimit),
    { role: 'user', content: userContent },
  ];
  const sendOptions = ia.replyQuoted ? { quoted: extracted.raw } : {};

  if (ia.showTyping) ctx.socket.sendPresenceUpdate('composing', extracted.groupId).catch(() => null);
  try {
    const settings = await getSystemSettingsCached(ctx.collections);
    let answer = await askIa(ia, settings, messages, ctx.accountId);
    if (!answer) return false;
    if (ia.maxReplyChars > 0 && answer.length > ia.maxReplyChars) answer = `${answer.slice(0, ia.maxReplyChars - 1)}…`;
    const content = ia.mentionSender && extracted.senderId
      ? { text: `${mentionFor(extracted.senderId)} ${answer}`, mentions: [extracted.senderId] }
      : { text: answer };
    await ctx.socket.sendMessage(extracted.groupId, content, sendOptions);
    remember(ctx, extracted.groupId, 'user', userContent, memoryLimit);
    remember(ctx, extracted.groupId, 'assistant', answer, memoryLimit);
    ctx.logger.info('ia', 'Respuesta IA enviada', { groupId: extracted.groupId, provider: ia.provider, model: ia.model });
    return true;
  } catch (err) {
    ctx.logger.warn('ia', 'Error en modo IA', { groupId: extracted.groupId, provider: ia.provider, error: err.message });
    if (ia.fallbackText) {
      ctx.socket.sendMessage(extracted.groupId, { text: ia.fallbackText }, sendOptions).catch(() => null);
    }
    return false;
  } finally {
    if (ia.showTyping) ctx.socket?.sendPresenceUpdate('paused', extracted.groupId).catch(() => null);
  }
}
