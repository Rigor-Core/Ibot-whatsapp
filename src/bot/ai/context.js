// Arma lo que la IA recibe: instrucciones del sistema (quién es, dónde está,
// plantilla, estilo del dueño, stickers) y los mensajes recientes del chat.
const MEDIA_LABELS = {
  image: 'imagen',
  video: 'video',
  audio: 'audio',
  sticker: 'sticker',
  document: 'documento',
  contact: 'contacto',
  location: 'ubicación',
};
const STYLE_CACHE_MS = 15 * 60 * 1000;
const MAX_STYLE_SAMPLES = 30;

export function formatTime(ts, timeZone, withYear = false) {
  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone,
      ...(withYear ? { year: 'numeric' } : {}),
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function describeMessage(row) {
  const media = row.mediaType ? `[${MEDIA_LABELS[row.mediaType] || 'archivo'}]` : '';
  return [media, row.text].filter(Boolean).join(' ') || '[mensaje]';
}

// Ejemplos reales de cómo escribe el dueño (sin lo que envió el bot), para imitar su estilo.
async function ownerSamples(runtime) {
  const cached = runtime.styleSamplesCache;
  if (cached && Date.now() - cached.at < STYLE_CACHE_MS) return cached.samples;
  const rows = await runtime.collections.chatMessages
    .find(
      { accountId: runtime.accountId, fromMe: true, origin: null, text: { $nin: ['', null] } },
      { projection: { text: 1 } },
    )
    .sort({ ts: -1 })
    .limit(200)
    .toArray()
    .catch(() => []);
  const samples = [...new Set(rows.map((row) => String(row.text).trim()).filter((value) => value.length >= 2 && value.length <= 280))]
    .slice(0, MAX_STYLE_SAMPLES);
  runtime.styleSamplesCache = { at: Date.now(), samples };
  return samples;
}

function nowLine(timeZone) {
  let formatted;
  try {
    formatted = new Intl.DateTimeFormat('es-MX', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(new Date());
  } catch {
    formatted = new Date().toString();
  }
  const isoDay = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return `Fecha y hora actual: ${formatted} (${timeZone}; hoy es ${isoDay}).`;
}

export async function buildSystemPrompt({ runtime, chat, template, isOwnerChat, stickers, hasTools, extensionNames = [] }) {
  const ia = runtime.config.ia;
  const timeZone = runtime.config.timezone || 'America/Hermosillo';
  const name = runtime.socket?.user?.name;
  const ofOwner = name ? `de ${name}` : 'del dueño de este WhatsApp';
  const parts = [];

  if (isOwnerChat) {
    parts.push(`Eres el asistente personal ${ofOwner} y estás en su chat privado de WhatsApp, que nadie más ve. Ayuda con lo que te pida.`);
    if (hasTools) {
      parts.push('Puedes consultar todos sus chats y grupos con las herramientas: para resúmenes o preguntas sobre lo que dijo alguien, primero busca con list_chats/read_chat/search_messages y luego responde con datos reales. Solo envía mensajes a otros chats (send_message) cuando te lo pida de forma explícita.');
    }
    if (extensionNames.length) {
      parts.push(`Tienes acceso a: ${extensionNames.join(', ')}. Úsalos cuando te lo pida; confirma brevemente lo que hiciste y nunca digas que hiciste algo si la herramienta dio error.`);
    }
  } else {
    const where = chat.isGroup ? `el grupo de WhatsApp «${chat.name}»` : `un chat privado de WhatsApp con ${chat.name}`;
    parts.push(`Estás respondiendo en nombre ${ofOwner} en ${where}.`);
    if (hasTools) {
      parts.push('Si la respuesta depende de algo que se habló antes y no está en los mensajes recientes, búscalo con las herramientas antes de responder. No inventes datos.');
    }
  }
  parts.push(nowLine(timeZone));

  const behavior = template?.instructions || ia.systemPrompt;
  if (behavior) parts.push(`Instrucciones de comportamiento:\n${behavior}`);

  const samples = [];
  if (template?.styleSamples) samples.push(...template.styleSamples.split('\n').map((line) => line.trim()).filter(Boolean));
  if (template?.learnFromMe) samples.push(...await ownerSamples(runtime));
  if (samples.length) {
    parts.push(`Así escribe ${name || 'el dueño'}. Imita su estilo (largo, tono, emojis, muletillas) sin copiar frases literalmente:\n${samples.slice(0, 60).map((line) => `- ${line}`).join('\n')}`);
  }

  if (stickers.length && template) {
    const frequency = template.stickerMode === 'often' ? 'con frecuencia, cuando encaje' : 'de vez en cuando, solo si encaja muy bien';
    parts.push([
      `Puedes enviar stickers con send_sticker (${frequency}). Disponibles: ${stickers.map((sticker) => `«${sticker.name}»`).join(', ')}.`,
      template.stickerNotes ? `Cómo se usan: ${template.stickerNotes}` : '',
      'Si envías un sticker puedes responder además con texto o dejar el texto vacío.',
    ].filter(Boolean).join(' '));
  }

  parts.push('Formato: texto plano para WhatsApp (puedes usar *negrita*, _cursiva_ y listas cortas). Sé breve salvo que pidan detalle. No incluyas marcas de hora ni prefijos con nombres en tu respuesta.');
  return parts.join('\n\n');
}

// Convierte el historial guardado del chat en turnos user/assistant. En el
// chat del dueño sus mensajes son "user" y los del bot "assistant"; en los
// demás chats todo lo enviado desde la cuenta es "assistant".
export async function buildHistory({ runtime, extracted, isOwnerChat }) {
  const ia = runtime.config.ia;
  if (!ia.contextMessages) return [];
  const timeZone = runtime.config.timezone || 'America/Hermosillo';
  let rows = await runtime.chatStore.readMessages(extracted.groupId, {
    limit: ia.contextMessages + 3,
    after: ia.memoryResetAt || undefined,
  }).catch(() => []);
  rows = rows.filter((row) => row.id !== extracted.id).slice(-ia.contextMessages);

  // Sin historial guardado (por ejemplo, si no se guarda el texto) se usa la memoria en RAM.
  if (!rows.length) return [...(runtime.aiMemory.get(extracted.groupId) || [])].slice(-ia.contextMessages);

  const turns = [];
  for (const row of rows) {
    const assistant = isOwnerChat ? !!row.origin : row.fromMe;
    const content = assistant
      ? describeMessage(row)
      : `[${formatTime(row.ts, timeZone)}] ${extracted.isGroup && !row.fromMe ? `${row.senderName || 'Alguien'}: ` : ''}${describeMessage(row)}`;
    const last = turns[turns.length - 1];
    const role = assistant ? 'assistant' : 'user';
    if (last?.role === role) last.content += `\n${content}`;
    else turns.push({ role, content });
  }
  return turns;
}

// Guarda el intercambio en memoria (respaldo si el historial no se guarda en la base).
export function remember(runtime, chatId, userContent, answer) {
  const limit = runtime.config.ia.contextMessages;
  if (limit <= 0) return;
  if (!runtime.aiMemory.has(chatId)) runtime.aiMemory.set(chatId, []);
  const history = runtime.aiMemory.get(chatId);
  history.push({ role: 'user', content: String(userContent).slice(0, 2000) });
  if (answer) history.push({ role: 'assistant', content: String(answer).slice(0, 2000) });
  while (history.length > limit) history.shift();
}
