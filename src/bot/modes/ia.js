import { askIa } from '../../services/ai-providers.js';
import { getSystemSettingsCached } from '../../services/settings-service.js';

function parseCommand(text, ia) {
  const trimmed = String(text || '').trim();
  const lower = trimmed.toLowerCase();
  const found = ia.commands.find((cmd) => lower === cmd.toLowerCase() || lower.startsWith(`${cmd.toLowerCase()} `));
  if (found) return { ok: true, prompt: trimmed.slice(found.length).trim(), command: found };
  if (ia.commandMode === 'required') return { ok: false, prompt: '', command: null };
  return { ok: true, prompt: trimmed, command: null };
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
  if (ia.ignoreOwnMessages && extracted.fromMe) return false;
  if (ia.ignoreMedia && extracted.mediaType && !extracted.text) return false;

  const cfg = ctx.groupsById.get(extracted.groupId);
  if (ia.onlyConfiguredGroups) {
    if (!cfg || !cfg.responder) return false;
    if (!cfg.independiente && !ctx.config.respuestas) return false;
  }

  const parsed = parseCommand(extracted.text, ia);
  if (!parsed.ok || !parsed.prompt) return false;

  const now = Date.now();
  const last = ctx.state.aiCooldowns.get(extracted.groupId) || 0;
  if (ia.perGroupCooldownMs > 0 && now - last < ia.perGroupCooldownMs) return false;
  ctx.state.aiCooldowns.set(extracted.groupId, now);

  const memoryLimit = ia.historyLimit * 2;
  const history = ctx.aiMemory.get(extracted.groupId) || [];
  const userContent = ia.includeSenderName && extracted.senderName
    ? `${extracted.senderName}: ${parsed.prompt}`
    : parsed.prompt;
  const messages = [
    ...(ia.systemPrompt ? [{ role: 'system', content: ia.systemPrompt }] : []),
    ...history.slice(-memoryLimit),
    { role: 'user', content: userContent },
  ];
  const sendOptions = ia.replyQuoted ? { quoted: extracted.raw } : {};

  if (ia.showTyping) ctx.socket.sendPresenceUpdate('composing', extracted.groupId).catch(() => null);
  try {
    const settings = await getSystemSettingsCached(ctx.collections);
    let answer = await askIa(ia, settings, messages);
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
