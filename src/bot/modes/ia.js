import { getSystemSettingsCached } from '../../services/settings-service.js';
import { runAgent } from '../ai/agent.js';
import { buildHistory, buildSystemPrompt, describeMessage, remember } from '../ai/context.js';
import { buildTools } from '../ai/tools.js';

const MAX_STICKERS_IN_PROMPT = 60;

function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Texto que recibe la IA según el disparador ('' = no responde).
function parseTrigger(extracted, ia, mode, runtime) {
  const trimmed = String(extracted.text || '').trim() || (extracted.mediaType ? describeMessage(extracted) : '');
  if (mode === 'all') return trimmed;
  if (mode === 'command') {
    const lower = trimmed.toLowerCase();
    const found = ia.commands.find((cmd) => lower === cmd.toLowerCase() || lower.startsWith(`${cmd.toLowerCase()} `));
    return found ? trimmed.slice(found.length).trim() : '';
  }
  if (mode === 'keyword') {
    const normalized = stripAccents(trimmed);
    return ia.keywords.some((keyword) => normalized.includes(stripAccents(keyword))) ? trimmed : '';
  }
  if (mode === 'mention') return runtime.mentionsMe(extracted) ? trimmed : '';
  return '';
}

// ¿Puede responder la IA en este chat? Las reglas por chat mandan sobre el alcance general.
function chatAllowed(extracted, ia, rule, groupsById) {
  if (rule?.access === 'block') return false;
  if (rule?.access === 'allow') return true;
  if (extracted.isGroup) {
    if (ia.groupScope === 'all') return true;
    if (ia.groupScope === 'configured') return !!groupsById.get(extracted.groupId)?.responder;
    return false;
  }
  return ia.privateScope === 'all';
}

function mentionFor(jid) {
  return `@${String(jid || '').split('@')[0].split(':')[0]}`;
}

// Modo IA: responde en grupos, chats privados y, como asistente personal, en
// tu propio chat. Se ejecuta sin bloquear el procesamiento de otros mensajes.
export async function handleIa(extracted, ctx) {
  const { runtime } = ctx;
  const ia = ctx.config.ia;
  // Con "Respuestas" apagado ningún modo responde. El disparador "off" solo
  // apaga los grupos: los chats privados y tu asistente tienen su propia opción.
  if (!ctx.config.respuestas) return false;

  const chatId = extracted.groupId;
  const isOwnerChat = runtime.isSelfChat(chatId);
  const rule = runtime.aiRuleFor(chatId);
  if (isOwnerChat) {
    if (!ia.ownerAssistant || !extracted.fromMe) return false;
  } else {
    if (extracted.fromMe && ctx.config.ignoreOwnMessages !== false) return false;
    if (!chatAllowed(extracted, ia, rule, ctx.groupsById)) return false;
  }
  if (ia.ignoreMedia && extracted.mediaType && !extracted.text) return false;

  let triggerMode = ia.triggerMode;
  if (isOwnerChat) triggerMode = ia.ownerTrigger === 'all' ? 'all' : 'command';
  else if (!extracted.isGroup && ia.privateTrigger === 'all') triggerMode = 'all';
  const prompt = parseTrigger(extracted, ia, triggerMode, runtime);
  if (!prompt) return false;

  if (!isOwnerChat) {
    const now = Date.now();
    const last = ctx.state.aiCooldowns.get(chatId) || 0;
    if (ia.perGroupCooldownMs > 0 && now - last < ia.perGroupCooldownMs) return false;
    ctx.state.aiCooldowns.set(chatId, now);
  }

  const template = runtime.aiTemplates.get(rule?.templateId || ia.defaultTemplateId) || null;
  const stickers = template && template.stickerMode !== 'never'
    ? (await runtime.stickers.list(runtime.accountId)).slice(0, MAX_STICKERS_IN_PROMPT)
    : [];
  const tools = buildTools({ runtime, extracted, isOwnerChat, template, stickers });
  const chat = { isGroup: extracted.isGroup, name: runtime.chatName(chatId, extracted) };
  const userContent = extracted.isGroup && ia.includeSenderName && extracted.senderName
    ? `${extracted.senderName}: ${prompt}`
    : prompt;
  const sendOptions = { origin: 'ia', ...(ia.replyQuoted ? { quoted: extracted.raw } : {}) };

  if (ia.showTyping) ctx.socket.sendPresenceUpdate('composing', chatId).catch(() => null);
  try {
    const [system, history, settings] = await Promise.all([
      buildSystemPrompt({ runtime, chat, template, isOwnerChat, stickers, hasTools: ia.historyTools, extensionNames: tools.extensionNames }),
      buildHistory({ runtime, extracted, isOwnerChat }),
      getSystemSettingsCached(ctx.collections),
    ]);
    const { text, steps } = await runAgent({
      ia,
      settings,
      accountId: ctx.accountId,
      messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: userContent }],
      tools: tools.definitions,
      executeTool: tools.execute,
      temperature: template?.temperature ?? undefined,
    });
    let answer = text;
    if (!answer && !tools.stickerSent()) throw new Error('La IA no devolvió ninguna respuesta');
    if (answer) {
      if (ia.maxReplyChars > 0 && answer.length > ia.maxReplyChars) answer = `${answer.slice(0, ia.maxReplyChars - 1)}…`;
      const content = extracted.isGroup && ia.mentionSender && extracted.senderId && !extracted.fromMe
        ? { text: `${mentionFor(extracted.senderId)} ${answer}`, mentions: [extracted.senderId] }
        : { text: answer };
      await ctx.send(chatId, content, sendOptions);
    }
    remember(runtime, chatId, userContent, answer);
    ctx.logger.info('ia', 'Respuesta IA enviada', {
      groupId: chatId, provider: ia.provider, model: ia.model, herramientas: steps.map((step) => step.tool),
    });
    if (!isOwnerChat) {
      runtime.notifyThrottled('iaReply', `ia:${chatId}`, {
        title: `La IA respondió en ${chat.name}`, body: answer ? answer.slice(0, 160) : 'Envió un sticker', url: `/chats.html#${encodeURIComponent(chatId)}`, tag: `ia-${chatId}`,
      });
    }
    return true;
  } catch (err) {
    ctx.logger.warn('ia', 'Error en modo IA', { groupId: chatId, provider: ia.provider, error: err.message });
    runtime.notifyThrottled('iaError', 'iaError', { title: 'La IA no pudo responder', body: err.message.slice(0, 200), url: '/configuracion.html#ia' });
    // En tu chat personal se muestra el motivo; en los demás, el mensaje de respaldo.
    const fallback = isOwnerChat ? `⚠️ No pude responder: ${err.message}` : ia.fallbackText;
    if (fallback) ctx.send(chatId, { text: fallback }, sendOptions).catch(() => null);
    return false;
  } finally {
    if (ia.showTyping) ctx.socket?.sendPresenceUpdate('paused', chatId).catch(() => null);
  }
}
