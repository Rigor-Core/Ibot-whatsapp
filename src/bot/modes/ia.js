import { DeepSeekClient } from '../../services/deepseek-client.js';

const DEFAULT_DEEPSEEK_BASE_URL = 'https://dipisik.rigorcore.com/v1';

function parseCommand(text, iaConfig) {
  const trimmed = String(text || '').trim();
  const commands = Array.isArray(iaConfig.commands) && iaConfig.commands.length ? iaConfig.commands : ['/chat'];
  const found = commands.find((cmd) => trimmed.toLowerCase().startsWith(`${String(cmd).toLowerCase()} `) || trimmed.toLowerCase() === String(cmd).toLowerCase());
  if (found) return { ok: true, prompt: trimmed.slice(found.length).trim(), command: found };
  if (iaConfig.commandMode === 'required') return { ok: false, prompt: '', command: null };
  return { ok: true, prompt: trimmed, command: null };
}

function remember(ctx, groupId, role, content, limit) {
  if (!ctx.aiMemory.has(groupId)) ctx.aiMemory.set(groupId, []);
  const arr = ctx.aiMemory.get(groupId);
  arr.push({ role, content: String(content || '').slice(0, 2000) });
  while (arr.length > limit) arr.shift();
  return arr;
}

export async function handleIa(extracted, ctx) {
  const ia = ctx.config.ia || {};
  if (ia.enabled === false) return false;
  if (ia.ignoreOwnMessages !== false && extracted.fromMe) return false;
  if (ia.ignoreMedia !== false && extracted.mediaType && !extracted.text) return false;

  const cfg = ctx.groupsById.get(extracted.groupId);
  if (ia.onlyConfiguredGroups !== false) {
    if (!cfg || !cfg.responder) return false;
    if (!cfg.independiente && !ctx.config.respuestas) return false;
  }

  const parsed = parseCommand(extracted.text, ia);
  if (!parsed.ok || !parsed.prompt) return false;

  const cooldown = Number(ia.perGroupCooldownMs || 0);
  const last = ctx.state.aiCooldowns.get(extracted.groupId) || 0;
  const now = Date.now();
  if (cooldown > 0 && now - last < cooldown) return false;
  ctx.state.aiCooldowns.set(extracted.groupId, now);

  const apiKey = ia.apiKey && !String(ia.apiKey).includes('*') ? ia.apiKey : (process.env.DEEPSEEK_API_KEY || '');
  const baseUrl = String(ia.baseUrl || '').includes('api.z.ai')
    ? DEFAULT_DEEPSEEK_BASE_URL
    : (ia.baseUrl || DEFAULT_DEEPSEEK_BASE_URL);
  const model = String(ia.model || '').startsWith('glm-')
    ? 'deepseek-chat'
    : (ia.model || 'deepseek-chat');
  const client = new DeepSeekClient({
    apiKey,
    baseUrl,
    model,
    timeoutMs: ia.timeoutMs,
    logger: ctx.logger,
  });

  const historyLimit = Math.min(Math.max(Number(ia.historyLimit || 8), 0), 20);
  const history = ctx.aiMemory.get(extracted.groupId) || [];
  const messages = [
    { role: 'system', content: ia.systemPrompt || 'Eres un asistente útil dentro de WhatsApp.' },
    ...history.slice(-historyLimit),
    { role: 'user', content: parsed.prompt },
  ];

  try {
    remember(ctx, extracted.groupId, 'user', parsed.prompt, historyLimit * 2 || 12);
    const answer = await client.chat({
      messages,
      temperature: Number(ia.temperature ?? 0.6),
      maxTokens: Number(ia.maxTokens ?? 500),
    });
    if (!answer) return false;
    await ctx.socket.sendMessage(extracted.groupId, { text: answer });
    if (ctx.config.modo === 'watch') {
      ctx.chatStore.recordOutgoing({ groupId: extracted.groupId, groupName: cfg?.nombre || extracted.groupId, text: answer });
    }
    remember(ctx, extracted.groupId, 'assistant', answer, historyLimit * 2 || 12);
    ctx.logger.info('ia', 'Respuesta IA enviada', { groupId: extracted.groupId, command: parsed.command });
    return true;
  } catch (err) {
    ctx.logger.warn('ia', 'Error en modo IA', { groupId: extracted.groupId, error: err.message });
    const fallback = ia.fallbackText || 'No pude generar una respuesta en este momento.';
    if (fallback) {
      ctx.socket.sendMessage(extracted.groupId, { text: fallback }).catch(() => null);
    }
    return false;
  }
}
