import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { MediaStore, StickerLibrary } from '../src/services/media-service.js';
import { StorageService, normalizeStorageConfig } from '../src/services/storage-service.js';
import { memoryCollections } from './helpers/memory-db.js';

const COLLECTIONS = ['media', 'stickers', 'chatMessages', 'chatGroups', 'scheduledMessages', 'configs'];
const png = (width, height, color = '#e11d48') => sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();

test('guarda imágenes sin duplicar, separadas por cuenta, y convierte stickers subidos', async () => {
  const collections = memoryCollections(COLLECTIONS);
  const media = new MediaStore({ collections });
  const big = await png(2400, 1200);

  const first = await media.save('acc', { buffer: big, kind: 'image' });
  assert.equal(first.mime, 'image/jpeg');
  assert.ok(first.width <= 1600);
  assert.equal((await media.save('acc', { buffer: big, kind: 'image' })).id, first.id);
  assert.notEqual((await media.save('otra', { buffer: big, kind: 'image' })).id, first.id);
  assert.equal(await media.get('otra', first.id).then((doc) => doc?.id === first.id), false);

  const sticker = await media.save('acc', { buffer: big, kind: 'sticker' });
  assert.deepEqual([sticker.mime, sticker.width, sticker.height], ['image/webp', 512, 512]);
  const content = await media.messageContent('acc', sticker.id);
  assert.ok(Buffer.isBuffer(content.sticker));
  const image = await media.messageContent('acc', first.id, 'pie de foto');
  assert.deepEqual([image.caption, Buffer.isBuffer(image.image)], ['pie de foto', true]);

  await assert.rejects(media.save('acc', { buffer: Buffer.from('no soy una imagen'), kind: 'image' }), /no es una imagen/);
  await assert.rejects(media.save('acc', { buffer: big, kind: 'video' }), /no permitido/);
});

test('biblioteca de stickers: guardar, buscar por nombre, renombrar y borrar', async () => {
  const collections = memoryCollections(COLLECTIONS);
  const media = new MediaStore({ collections });
  const library = new StickerLibrary({ collections, media });

  const received = await media.save('acc', { buffer: await png(300, 300, '#22c55e'), kind: 'image', origin: 'chat' });
  const saved = await library.add('acc', { mediaId: received.id, name: 'Risa  fuerte ' });
  assert.equal(saved.name, 'Risa fuerte');
  assert.notEqual(saved.mediaId, received.id, 'una imagen se convierte en sticker');
  assert.equal((await library.add('acc', { mediaId: saved.mediaId })).id, saved.id, 'no se duplica');

  assert.equal((await library.resolve('acc', 'risa'))?.id, saved.id);
  assert.equal((await library.resolve('acc', 'RÍSA FUERTE'))?.id, saved.id);
  assert.equal(await library.resolve('otra', 'risa'), null);

  assert.equal(await library.rename('acc', saved.id, 'jajaja'), true);
  assert.equal((await library.list('acc'))[0].name, 'jajaja');

  assert.equal(await library.remove('acc', saved.id), true);
  assert.equal(await collections.media.countDocuments({ _id: saved.mediaId }), 0, 'el archivo sin uso se borra');
  assert.equal(await collections.media.countDocuments({ accountId: 'acc' }), 1, 'la imagen original se conserva');
});

test('almacenamiento: vaciar por tipo de chat, antigüedad o solo archivos', async () => {
  const DAY = 24 * 60 * 60 * 1000;
  const collections = memoryCollections(COLLECTIONS);
  const media = new MediaStore({ collections });
  const photo = await media.save('acc', { buffer: await png(100, 100), kind: 'image', origin: 'chat' });
  collections.chatMessages.docs.push(
    { accountId: 'acc', id: 'old-group', groupId: '1@g.us', ts: Date.now() - 10 * DAY, mediaId: photo.id },
    { accountId: 'acc', id: 'new-group', groupId: '1@g.us', ts: Date.now() },
    { accountId: 'acc', id: 'old-contact', groupId: '5@s.whatsapp.net', ts: Date.now() - 10 * DAY },
    { accountId: 'otra', id: 'otra-old', groupId: '1@g.us', ts: Date.now() - 10 * DAY },
  );
  const storage = new StorageService({ collections, registry: { runtimes: new Map() }, media });

  const result = await storage.clear('acc', { scope: 'groups', olderThanDays: 7 });
  assert.deepEqual(result, { messages: 1, media: 1 });
  assert.deepEqual(collections.chatMessages.docs.map((doc) => doc.id).sort(), ['new-group', 'old-contact', 'otra-old']);

  const usage = await storage.usage('acc');
  assert.deepEqual([usage.messages, usage.groupMessages, usage.contactMessages, usage.images.count], [2, 1, 1, 0]);

  const sticker = await media.save('acc', { buffer: await png(64, 64), kind: 'sticker' });
  collections.chatMessages.docs.push({ accountId: 'acc', id: 's', groupId: '5@s.whatsapp.net', ts: Date.now(), mediaId: sticker.id });
  assert.deepEqual(await storage.clear('acc', { scope: 'chats', chatIds: ['5@s.whatsapp.net'], mediaOnly: true }), { messages: 0, media: 1 });
  assert.equal(collections.chatMessages.docs.find((doc) => doc.id === 's').mediaId, undefined);
  assert.equal(await collections.chatMessages.countDocuments({ accountId: 'acc' }), 3, 'solo se borran los archivos');
});

test('normaliza las opciones de almacenamiento', () => {
  assert.deepEqual(normalizeStorageConfig({}), {
    saveText: true, saveImages: true, saveStickers: true, excludedChats: [], retentionDays: 0, retentionScope: 'all', retentionChats: [],
  });
  const custom = normalizeStorageConfig({ saveImages: false, retentionDays: 30, retentionScope: 'selected', retentionChats: ['1@g.us', 'x', '1@g.us'], excludedChats: ['2@lid'] });
  assert.equal(custom.saveImages, false);
  assert.equal(custom.retentionDays, 30);
  assert.deepEqual(custom.retentionChats, ['1@g.us']);
  assert.deepEqual(custom.excludedChats, ['2@lid']);
  assert.equal(normalizeStorageConfig({ retentionDays: 5 }).retentionDays, 0);
});
