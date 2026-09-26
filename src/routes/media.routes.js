import express, { Router } from 'express';
import { CLEAR_SCOPES, normalizeStorageConfig } from '../services/storage-service.js';
import { getConfig } from '../services/account-service.js';

// Imágenes y stickers llegan como archivo binario (no JSON).
const binaryImage = express.raw({ type: ['image/*'], limit: '12mb' });

// Rutas de archivos, biblioteca de stickers y almacenamiento de chats. Se
// montan detrás del middleware de /api/bot (sesión, cuenta y permisos).
export function createMediaRouter({ collections, registry, storage, resolveAccountId }) {
  const router = Router();
  const runtimeFor = (req) => registry.get(resolveAccountId(req));
  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  };

  // ─── Archivos ──────────────────────────────────────────────────────────
  router.get('/api/bot/media/:id', handle(async (req, res) => {
    const runtime = await runtimeFor(req);
    const media = await runtime.media.get(runtime.accountId, req.params.id);
    if (!media) return res.status(404).json({ error: 'Archivo no encontrado' });
    const etag = `"${media.sha256}"`;
    // Los archivos no cambian nunca: el navegador puede guardarlos en caché.
    res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.type(media.mime).send(media.buffer);
  }));

  router.post('/api/bot/media', binaryImage, handle(async (req, res) => {
    const { features } = req.panelUser.permissions;
    if (!features.sendMessages && !features.scheduleMessages) {
      return res.status(403).json({ error: 'El administrador no te permite enviar ni programar mensajes' });
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Adjunta una imagen' });
    const runtime = await runtimeFor(req);
    const kind = req.query.kind === 'sticker' ? 'sticker' : 'image';
    res.status(201).json(await runtime.media.save(runtime.accountId, { buffer: req.body, kind, origin: 'upload' }));
  }));

  // ─── Biblioteca de stickers ────────────────────────────────────────────
  router.get('/api/bot/stickers', handle(async (req, res) => {
    const runtime = await runtimeFor(req);
    res.json(await runtime.stickers.list(runtime.accountId));
  }));

  // Guarda en la biblioteca un sticker (o imagen) que ya está en el panel, p. ej. uno recibido en un chat.
  router.post('/api/bot/stickers', handle(async (req, res) => {
    const runtime = await runtimeFor(req);
    res.status(201).json(await runtime.stickers.add(runtime.accountId, { mediaId: req.body?.mediaId, name: req.body?.name }));
  }));

  router.post('/api/bot/stickers/upload', binaryImage, handle(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Adjunta una imagen' });
    const runtime = await runtimeFor(req);
    res.status(201).json(await runtime.stickers.upload(runtime.accountId, { buffer: req.body, name: req.query.name }));
  }));

  router.put('/api/bot/stickers/:id', handle(async (req, res) => {
    const runtime = await runtimeFor(req);
    const ok = await runtime.stickers.rename(runtime.accountId, req.params.id, req.body?.name);
    if (!ok) return res.status(404).json({ error: 'Sticker no encontrado' });
    res.json({ ok: true });
  }));

  router.delete('/api/bot/stickers/:id', handle(async (req, res) => {
    const runtime = await runtimeFor(req);
    const ok = await runtime.stickers.remove(runtime.accountId, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Sticker no encontrado' });
    res.json({ ok: true });
  }));

  // ─── Almacenamiento ────────────────────────────────────────────────────
  router.get('/api/bot/storage', handle(async (req, res) => {
    const accountId = resolveAccountId(req);
    const config = await getConfig(collections, accountId);
    res.json({ config: normalizeStorageConfig(config?.storage), usage: await storage.usage(accountId) });
  }));

  router.post('/api/bot/storage/clear', handle(async (req, res) => {
    const accountId = resolveAccountId(req);
    const scope = CLEAR_SCOPES.includes(req.body?.scope) ? req.body.scope : null;
    if (!scope) return res.status(400).json({ error: 'Elige qué chats vaciar' });
    const result = await storage.clear(accountId, {
      scope,
      chatIds: req.body?.chatIds,
      olderThanDays: Math.max(0, Number(req.body?.olderThanDays) || 0),
      mediaOnly: req.body?.mediaOnly === true,
    });
    (await runtimeFor(req)).logger.info('storage', 'Chats vaciados desde el panel', { scope, ...result });
    res.json({ ok: true, ...result, usage: await storage.usage(accountId) });
  }));

  return router;
}
