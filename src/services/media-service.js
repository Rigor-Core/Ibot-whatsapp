import crypto from 'crypto';
import sharp from 'sharp';
import { ObjectId } from 'mongodb';

// Imágenes y stickers de cada cuenta, guardados en MongoDB (sobreviven a
// reinicios y despliegues). Un mismo archivo se guarda una sola vez por cuenta.
export const MEDIA_KINDS = Object.freeze(['image', 'sticker']);
const MAX_INPUT_BYTES = { image: 12 * 1024 * 1024, sticker: 2 * 1024 * 1024 };
const IMAGE_MAX_SIDE = 1600;
const STICKER_SIDE = 512;
const MAX_STICKERS = 300;
const MAX_NAME = 60;

function toBuffer(data) {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data;
  if (typeof data.value === 'function') return Buffer.from(data.value());
  if (data.buffer instanceof ArrayBuffer || ArrayBuffer.isView(data)) return Buffer.from(data.buffer ?? data);
  return null;
}

export function toObjectId(id) {
  const value = String(id || '');
  return ObjectId.isValid(value) && value.length === 24 ? new ObjectId(value) : null;
}

function publicMedia(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    kind: doc.kind,
    mime: doc.mime,
    size: doc.size,
    width: doc.width || null,
    height: doc.height || null,
    animated: !!doc.animated,
  };
}

// Normaliza una imagen o sticker antes de guardarlo:
// - imágenes: se quitan metadatos (EXIF) y se reducen si son enormes;
// - stickers subidos: se convierten a WebP 512×512, el formato que exige WhatsApp.
async function prepare({ buffer, kind, origin }) {
  const input = sharp(buffer, { animated: true, failOn: 'none' });
  const meta = await input.metadata();
  const animated = Number(meta.pages || 1) > 1;
  if (kind === 'sticker') {
    if (origin === 'chat' && meta.format === 'webp') {
      return { buffer, mime: 'image/webp', width: meta.width, height: meta.pageHeight || meta.height, animated };
    }
    const out = await input
      .resize(STICKER_SIDE, STICKER_SIDE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
    return { buffer: out, mime: 'image/webp', width: STICKER_SIDE, height: STICKER_SIDE, animated };
  }
  const big = Math.max(meta.width || 0, meta.height || 0) > IMAGE_MAX_SIDE || buffer.length > 1.5 * 1024 * 1024;
  if (origin === 'chat' && !big && ['jpeg', 'png', 'webp'].includes(meta.format)) {
    return { buffer, mime: `image/${meta.format}`, width: meta.width, height: meta.height, animated: false };
  }
  const out = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(IMAGE_MAX_SIDE, IMAGE_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { buffer: out.data, mime: 'image/jpeg', width: out.info.width, height: out.info.height, animated: false };
}

export class MediaStore {
  constructor({ collections }) {
    this.collections = collections;
  }

  async save(accountId, { buffer, kind, origin = 'upload' }) {
    if (!MEDIA_KINDS.includes(kind)) throw new Error('Tipo de archivo no permitido');
    const raw = toBuffer(buffer);
    if (!raw?.length) throw new Error('El archivo está vacío');
    if (raw.length > MAX_INPUT_BYTES[kind]) {
      throw new Error(`El archivo supera ${Math.round(MAX_INPUT_BYTES[kind] / 1024 / 1024)} MB`);
    }
    let prepared;
    try {
      prepared = await prepare({ buffer: raw, kind, origin });
    } catch {
      throw new Error('El archivo no es una imagen válida');
    }
    const sha256 = crypto.createHash('sha256').update(prepared.buffer).digest('hex');
    const existing = await this.collections.media.findOne({ accountId, sha256, kind }, { projection: { data: 0 } });
    if (existing) return publicMedia(existing);
    const doc = {
      accountId,
      kind,
      origin,
      mime: prepared.mime,
      size: prepared.buffer.length,
      width: prepared.width || null,
      height: prepared.height || null,
      animated: !!prepared.animated,
      sha256,
      data: prepared.buffer,
      createdAt: new Date(),
    };
    try {
      const result = await this.collections.media.insertOne(doc);
      return publicMedia({ ...doc, _id: result.insertedId });
    } catch (error) {
      // Dos copias del mismo archivo llegaron a la vez: se usa la que ganó.
      if (error?.code !== 11000) throw error;
      return publicMedia(await this.collections.media.findOne({ accountId, sha256, kind }, { projection: { data: 0 } }));
    }
  }

  async meta(accountId, id) {
    const _id = toObjectId(id);
    if (!_id) return null;
    return publicMedia(await this.collections.media.findOne({ _id, accountId }, { projection: { data: 0 } }));
  }

  async get(accountId, id) {
    const _id = toObjectId(id);
    if (!_id) return null;
    const doc = await this.collections.media.findOne({ _id, accountId });
    if (!doc) return null;
    return { ...publicMedia(doc), sha256: doc.sha256, buffer: toBuffer(doc.data) };
  }

  // Contenido listo para socket.sendMessage().
  async messageContent(accountId, id, caption = '') {
    const media = await this.get(accountId, id);
    if (!media) throw new Error('El archivo ya no existe');
    if (media.kind === 'sticker') return { sticker: media.buffer, isAnimated: media.animated };
    return { image: media.buffer, mimetype: media.mime, ...(caption ? { caption } : {}) };
  }

  // Borra los archivos que ya nadie usa: ni un mensaje guardado, ni la
  // biblioteca de stickers, ni un mensaje programado pendiente.
  async releaseUnused(accountId, ids = []) {
    const unique = [...new Set(ids.map(String).filter(Boolean))];
    let deleted = 0;
    for (const id of unique) {
      const _id = toObjectId(id);
      if (!_id) continue;
      const [inChats, inLibrary, inSchedule] = await Promise.all([
        this.collections.chatMessages.countDocuments({ accountId, mediaId: id }),
        this.collections.stickers.countDocuments({ accountId, mediaId: id }),
        this.collections.scheduledMessages.countDocuments({ accountId, 'media.mediaId': id, status: { $in: ['pending', 'processing'] } }),
      ]);
      if (inChats || inLibrary || inSchedule) continue;
      deleted += (await this.collections.media.deleteOne({ _id, accountId })).deletedCount;
    }
    return deleted;
  }

  async usage(accountId) {
    const docs = await this.collections.media.find({ accountId }, { projection: { kind: 1, size: 1 } }).toArray();
    const usage = { image: { count: 0, bytes: 0 }, sticker: { count: 0, bytes: 0 } };
    for (const doc of docs) {
      if (!usage[doc.kind]) continue;
      usage[doc.kind].count += 1;
      usage[doc.kind].bytes += Number(doc.size || 0);
    }
    return usage;
  }
}

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

function publicSticker(doc) {
  return {
    id: String(doc._id),
    mediaId: doc.mediaId,
    name: doc.name || '',
    animated: !!doc.animated,
    uses: Number(doc.uses || 0),
    createdAt: doc.createdAt,
  };
}

// Biblioteca de stickers guardados por el usuario: se envían desde el chat,
// en mensajes programados o los usa la IA (por eso tienen nombre).
export class StickerLibrary {
  constructor({ collections, media }) {
    this.collections = collections;
    this.media = media;
  }

  async list(accountId) {
    const rows = await this.collections.stickers.find({ accountId }).sort({ uses: -1, createdAt: -1 }).limit(MAX_STICKERS).toArray();
    return rows.map(publicSticker);
  }

  // Guarda un sticker a partir de un archivo ya almacenado (por ejemplo, uno
  // recibido en un chat). Si era una imagen, se convierte en sticker.
  async add(accountId, { mediaId, name }) {
    let media = await this.media.get(accountId, mediaId);
    if (!media) throw new Error('El archivo ya no existe');
    if (media.kind !== 'sticker') {
      media = await this.media.save(accountId, { buffer: media.buffer, kind: 'sticker', origin: 'upload' });
    }
    const total = await this.collections.stickers.countDocuments({ accountId });
    const existing = await this.collections.stickers.findOne({ accountId, mediaId: media.id });
    if (existing) return publicSticker(existing);
    if (total >= MAX_STICKERS) throw new Error(`Tu biblioteca llegó al máximo de ${MAX_STICKERS} stickers`);
    const doc = {
      accountId,
      mediaId: media.id,
      name: cleanName(name) || `Sticker ${total + 1}`,
      animated: !!media.animated,
      uses: 0,
      createdAt: new Date(),
    };
    const result = await this.collections.stickers.insertOne(doc);
    return publicSticker({ ...doc, _id: result.insertedId });
  }

  async upload(accountId, { buffer, name }) {
    const media = await this.media.save(accountId, { buffer, kind: 'sticker', origin: 'upload' });
    return this.add(accountId, { mediaId: media.id, name });
  }

  async rename(accountId, id, name) {
    const _id = toObjectId(id);
    const clean = cleanName(name);
    if (!_id || !clean) throw new Error('Escribe un nombre para el sticker');
    const result = await this.collections.stickers.updateOne({ _id, accountId }, { $set: { name: clean } });
    return result.matchedCount > 0;
  }

  async remove(accountId, id) {
    const _id = toObjectId(id);
    if (!_id) return false;
    const doc = await this.collections.stickers.findOne({ _id, accountId });
    if (!doc) return false;
    await this.collections.stickers.deleteOne({ _id, accountId });
    await this.media.releaseUnused(accountId, [doc.mediaId]);
    return true;
  }

  // Busca por id o por nombre (sin distinguir mayúsculas ni acentos): lo usa la IA.
  async resolve(accountId, idOrName) {
    const _id = toObjectId(idOrName);
    if (_id) {
      const byId = await this.collections.stickers.findOne({ _id, accountId });
      if (byId) return publicSticker(byId);
    }
    const plain = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const wanted = plain(idOrName);
    if (!wanted) return null;
    const all = await this.list(accountId);
    return all.find((sticker) => plain(sticker.name) === wanted)
      || all.find((sticker) => plain(sticker.name).includes(wanted))
      || null;
  }

  async markUsed(accountId, id) {
    const _id = toObjectId(id);
    if (!_id) return;
    await this.collections.stickers.updateOne({ _id, accountId }, { $inc: { uses: 1 }, $set: { lastUsedAt: new Date() } }).catch(() => null);
  }
}
