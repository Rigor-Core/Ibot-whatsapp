function unwrapMessage(message) {
  let current = message || {};
  if (current.ephemeralMessage?.message) current = current.ephemeralMessage.message;
  if (current.viewOnceMessage?.message) current = current.viewOnceMessage.message;
  if (current.viewOnceMessageV2?.message) current = current.viewOnceMessageV2.message;
  if (current.documentWithCaptionMessage?.message) current = current.documentWithCaptionMessage.message;
  return current;
}

export function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

export function extractMessage(msg) {
  const key = msg?.key || {};
  const groupId = key.remoteJid || '';
  const message = unwrapMessage(msg?.message || {});
  const senderId = key.participant || msg?.participant || key.remoteJid || '';
  const contextInfo = (
    message.extendedTextMessage?.contextInfo
    || message.imageMessage?.contextInfo
    || message.videoMessage?.contextInfo
    || message.documentMessage?.contextInfo
    || {}
  );
  const text =
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    '';

  let mediaType = null;
  if (message.imageMessage) mediaType = 'image';
  else if (message.videoMessage) mediaType = 'video';
  else if (message.audioMessage) mediaType = 'audio';
  else if (message.stickerMessage) mediaType = 'sticker';
  else if (message.documentMessage) mediaType = 'document';
  else if (message.contactMessage || message.contactsArrayMessage) mediaType = 'contact';
  else if (message.locationMessage || message.liveLocationMessage) mediaType = 'location';

  return {
    raw: msg,
    id: key.id,
    groupId,
    senderId,
    senderName: msg?.pushName || '',
    mentionedJids: Array.isArray(contextInfo.mentionedJid) ? contextInfo.mentionedJid : [],
    quotedParticipant: contextInfo.participant || '',
    fromMe: !!key.fromMe,
    text: String(text || '').trim(),
    mediaType,
    messageTimestamp: msg?.messageTimestamp || Math.floor(Date.now() / 1000),
    isGroup: isGroupJid(groupId),
  };
}

export function messageAllowedByType(extracted, tipoMensaje = 'texto') {
  if (tipoMensaje === 'ambas') return !!extracted.text || extracted.mediaType === 'image';
  if (tipoMensaje === 'imagen') return extracted.mediaType === 'image';
  return !!extracted.text;
}

export function normalizeReply(reply) {
  if (!reply) return { text: '' };
  if (typeof reply === 'string') return { text: reply };
  if (reply.text !== undefined) return { text: String(reply.text || '') };
  return reply;
}
