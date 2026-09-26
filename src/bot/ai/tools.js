import { localDateTimeToUtc } from '../../services/message-scheduler.js';
import { activeExtensions, extensionTools, runExtensionTool } from '../../extensions/index.js';
import { describeMessage, formatTime } from './context.js';

const DEFAULT_TIMEZONE = 'America/Hermosillo';
const JID_PATTERN = /@(g\.us|s\.whatsapp\.net|lid)$/;
const plain = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const clamp = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

// "AAAA-MM-DD" (o fecha ISO) al inicio o al final de ese día en la zona de la cuenta.
function dayBoundary(value, timeZone, endOfDay) {
  const text = String(value || '').trim();
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    try {
      const start = localDateTimeToUtc(text, endOfDay ? '23:59' : '00:00', timeZone).getTime();
      return endOfDay ? start + 59_999 : start;
    } catch {
      return undefined;
    }
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Encuentra un chat por id, número o nombre (grupo configurado, grupo o contacto).
async function resolveChat(runtime, query) {
  const value = String(query || '').trim();
  if (!value) throw new Error('Indica el chat (nombre, número o id)');
  if (JID_PATTERN.test(value)) return { id: value, name: runtime.chatName(value) };
  const rows = await runtime.chatStore.listGroups({ limit: 1000 });
  const chats = rows.map((row) => ({ id: row.groupId, name: runtime.chatName(row.groupId) || row.subject || row.groupId }));
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 6) {
    const byNumber = chats.find((chat) => chat.id.split('@')[0].endsWith(digits.slice(-10)));
    if (byNumber) return byNumber;
  }
  const wanted = plain(value);
  const words = wanted.split(/\s+/).filter(Boolean);
  const found = chats.find((chat) => plain(chat.name) === wanted)
    || chats.find((chat) => plain(chat.name).startsWith(wanted))
    || chats.find((chat) => words.every((word) => plain(chat.name).includes(word)));
  if (!found) throw new Error(`No encontré un chat llamado "${value}". Usa list_chats para ver los nombres exactos.`);
  return found;
}

function publicMessage(row, timeZone, withChat) {
  return {
    time: formatTime(row.ts, timeZone, true),
    from: row.fromMe ? (row.origin ? 'Bot' : 'Dueño') : (row.senderName || 'Contacto'),
    ...(withChat ? { chat: row.groupName } : {}),
    text: describeMessage(row).slice(0, 1200),
  };
}

// Herramientas de la IA para un mensaje concreto. En el chat personal del
// dueño tiene acceso a todos los chats, a enviar mensajes y a sus extensiones;
// en cualquier otro chat solo puede consultar esa misma conversación.
export function buildTools({ runtime, extracted, isOwnerChat, template, stickers }) {
  const ia = runtime.config.ia;
  const timeZone = runtime.config.timezone || DEFAULT_TIMEZONE;
  const definitions = [];
  const handlers = new Map();
  const state = { stickerSent: false };
  const add = (name, description, parameters, handler) => {
    definitions.push({ type: 'function', function: { name, description, parameters: { type: 'object', ...parameters } } });
    handlers.set(name, handler);
  };
  const chatParam = { chat: { type: 'string', description: 'Nombre, número o id del chat o grupo' } };
  const rangeParams = {
    since: { type: 'string', description: 'Desde el día AAAA-MM-DD (opcional)' },
    until: { type: 'string', description: 'Hasta el día AAAA-MM-DD (opcional)' },
  };
  const targetChat = async (args) => (isOwnerChat
    ? resolveChat(runtime, args.chat)
    : { id: extracted.groupId, name: runtime.chatName(extracted.groupId) });

  if (ia.historyTools) {
    if (isOwnerChat) {
      add('list_chats', 'Lista los chats y grupos guardados, del más reciente al más antiguo. Sirve para encontrar el nombre exacto de un contacto o grupo.', {
        properties: {
          query: { type: 'string', description: 'Parte del nombre o número (opcional)' },
          type: { type: 'string', enum: ['group', 'contact'], description: 'Solo grupos o solo contactos (opcional)' },
          limit: { type: 'integer', description: 'Máximo (por defecto 30)' },
        },
      }, async (args) => {
        const rows = await runtime.chatStore.listGroups({ q: args.query, type: args.type, limit: clamp(args.limit, 1, 100, 30) });
        return {
          chats: rows.map((row) => ({
            name: runtime.chatName(row.groupId) || row.subject,
            id: row.groupId,
            type: row.groupId.endsWith('@g.us') ? 'grupo' : 'contacto',
            ...(row.lastMessageAt ? { last_message: formatTime(row.lastMessageAt, timeZone, true) } : {}),
          })),
        };
      });
    }

    add('read_chat', isOwnerChat
      ? 'Lee los mensajes de un chat o grupo (los más recientes dentro del rango). Úsalo para resumir o saber qué dijo alguien.'
      : 'Lee mensajes anteriores de esta misma conversación (por ejemplo, de días atrás).', {
      properties: {
        ...(isOwnerChat ? chatParam : {}),
        ...rangeParams,
        limit: { type: 'integer', description: 'Cuántos mensajes (por defecto 40, máximo 150)' },
      },
      ...(isOwnerChat ? { required: ['chat'] } : {}),
    }, async (args) => {
      const chat = await targetChat(args);
      const since = dayBoundary(args.since, timeZone, false);
      const until = dayBoundary(args.until, timeZone, true);
      const rows = await runtime.chatStore.readMessages(chat.id, {
        limit: clamp(args.limit, 1, 150, 40),
        after: since ? since - 1 : undefined,
        before: until ? until + 1 : undefined,
      });
      return { chat: chat.name, total: rows.length, messages: rows.map((row) => publicMessage(row, timeZone, false)) };
    });

    add('search_messages', isOwnerChat
      ? 'Busca palabras en el historial de todos los chats (o de uno) y devuelve los mensajes que coinciden, del más reciente al más antiguo.'
      : 'Busca palabras en el historial de esta conversación.', {
      properties: {
        query: { type: 'string', description: 'Palabras a buscar (todas deben aparecer)' },
        ...(isOwnerChat ? chatParam : {}),
        sender: { type: 'string', description: 'Nombre de quien lo escribió (opcional)' },
        ...rangeParams,
        limit: { type: 'integer', description: 'Máximo de resultados (por defecto 25)' },
      },
    }, async (args) => {
      const chat = isOwnerChat ? (args.chat ? await resolveChat(runtime, args.chat) : null) : await targetChat(args);
      const rows = await runtime.chatStore.searchMessages({
        q: args.query,
        chatIds: chat ? [chat.id] : undefined,
        sender: args.sender,
        since: dayBoundary(args.since, timeZone, false),
        until: dayBoundary(args.until, timeZone, true),
        limit: clamp(args.limit, 1, 80, 25),
      });
      return { total: rows.length, messages: rows.map((row) => publicMessage(row, timeZone, !chat)) };
    });
  }

  if (isOwnerChat) {
    add('send_message', 'Envía un mensaje de texto a otro chat o grupo. Solo si el dueño lo pide de forma explícita.', {
      properties: { ...chatParam, text: { type: 'string', description: 'Texto a enviar' } },
      required: ['chat', 'text'],
    }, async (args) => {
      const chat = await resolveChat(runtime, args.chat);
      const text = String(args.text || '').trim().slice(0, 4000);
      if (!text) throw new Error('El mensaje está vacío');
      await runtime.send(chat.id, { text }, { origin: 'ia' });
      return { sent: true, to: chat.name };
    });
  }

  if (stickers.length && template && template.stickerMode !== 'never') {
    add('send_sticker', 'Envía uno de los stickers guardados en esta conversación (uno por respuesta).', {
      properties: { name: { type: 'string', enum: stickers.map((sticker) => sticker.name), description: 'Nombre del sticker' } },
      required: ['name'],
    }, async (args) => {
      if (state.stickerSent) return { error: 'Ya enviaste un sticker en esta respuesta' };
      const sticker = await runtime.stickers.resolve(runtime.accountId, args.name);
      if (!sticker) return { error: 'No existe ese sticker', available: stickers.map((item) => item.name) };
      const content = await runtime.media.messageContent(runtime.accountId, sticker.mediaId);
      await runtime.send(extracted.groupId, content, { origin: 'ia', mediaId: sticker.mediaId });
      runtime.stickers.markUsed(runtime.accountId, sticker.id);
      state.stickerSent = true;
      return { sent: true };
    });
  }

  // Las extensiones (Todoist, etc.) solo están en el chat personal del dueño.
  const extensions = isOwnerChat ? activeExtensions(runtime.config.extensions) : [];
  if (extensions.length) definitions.push(...extensionTools(runtime.config.extensions));

  async function execute(name, args) {
    const handler = handlers.get(name);
    if (handler) return handler(args || {});
    if (!extensions.length) return { error: `Herramienta no disponible: ${name}` };
    const run = await runExtensionTool(runtime.config.extensions, name, args || {});
    if (!run) return { error: `Herramienta no disponible: ${name}` };
    if (run.write) {
      runtime.logger.info('extensions', 'La IA usó una extensión', { extension: run.extension.id, tool: name });
      runtime.notify('extensionAction', { title: run.extension.name, body: run.summary, tag: `ext-${run.extension.id}` });
    }
    return run.result;
  }

  return {
    definitions,
    execute,
    extensionNames: extensions.map((extension) => extension.name),
    stickerSent: () => state.stickerSent,
  };
}
