import { Router } from 'express';
import { getUserAccount, getConfig, defaultBotConfig } from '../services/account-service.js';
import {
  buildDirectorySnapshot,
  directoryCsv,
  paginateDirectory,
} from '../services/directory-service.js';
import { cleanGroupPayload, normalizeGroupDoc } from '../bot/utils/group-normalizer.js';
import { normalizeAdminCommandsConfig } from '../services/admin-command-service.js';
import { isValidTimeZone } from '../services/message-scheduler.js';
import { publicSafeAccount, publicSafeConfig, now } from '../core/utils.js';
import { requireAccountUser } from './auth.middleware.js';
import { BOT_MODES } from '../bot/bot-runtime.js';
import {
  IA_DEFAULTS,
  ensureDipisikProfile,
  mergeIaUpdate,
  publicIaConfig,
  publicProviderCatalog,
} from '../services/ai-providers.js';
import { getSystemSettingsCached } from '../services/settings-service.js';
import { NOTIFICATION_GROUPS, NOTIFICATION_TYPES, normalizeNotificationPrefs } from '../services/push-service.js';
import { allowedModes, deniedApiPermission, deniedConfigChange } from '../services/permissions.js';
import { normalizePreferences } from '../services/preferences.js';
import { normalizeStorageConfig } from '../services/storage-service.js';
import { publicExtensionsConfig } from '../extensions/index.js';
import { createMediaRouter } from './media.routes.js';
import { createAiRouter } from './ai.routes.js';

const CHAT_JID = /@(g\.us|s\.whatsapp\.net|lid)$/;

// Configuración que ve el panel: sin claves de IA ni tokens de extensiones.
function publicConfig(config) {
  return {
    ...publicSafeConfig(config),
    ignoreOwnMessages: config?.ignoreOwnMessages !== false,
    ia: publicIaConfig(config?.ia),
    notifications: normalizeNotificationPrefs(config?.notifications),
    storage: normalizeStorageConfig(config?.storage),
    extensions: publicExtensionsConfig(config?.extensions),
  };
}

function repartidorSettings(current = {}, body = {}) {
  const merged = { ...current, ...body };
  const globalLimit = Number(merged.globalLimit ?? 1);
  return {
    globalLimit: Number.isInteger(globalLimit) && globalLimit >= 0 ? globalLimit : 1,
    filterEnabled: merged.filterEnabled !== false,
  };
}

export function createMainRouter({ collections, registry, scheduler, push, storage }) {
  const router = Router();

  // Solo los usuarios normales tienen cuenta de WhatsApp; el administrador no.
  router.use('/api/bot', requireAccountUser, async (req, res, next) => {
    const denied = deniedApiPermission(req.panelUser.permissions, req.method, req.originalUrl.split('?')[0]);
    if (denied) return res.status(403).json({ error: `El administrador no te permite: ${denied}` });
    try {
      const account = await getUserAccount(collections, req.panelUser);
      req.botAccount = account;
      req.resolvedAccountId = account.accountId;
      next();
    } catch (err) {
      next(err);
    }
  });

  function resolveAccountId(req) {
    if (!req.resolvedAccountId) throw new Error('accountId requerido');
    return req.resolvedAccountId;
  }

  router.get('/api/bot', (req, res) => res.json({
    ...publicSafeAccount(req.botAccount),
    permissions: req.panelUser.permissions,
    allowedModes: allowedModes(req.panelUser.permissions),
    preferences: req.panelUser.preferences,
  }));

  // Preferencias del panel de este usuario (por ejemplo, la vista de Grupos).
  router.put('/api/bot/preferences', async (req, res) => {
    const preferences = normalizePreferences({ ...req.panelUser.preferences, ...(req.body || {}) });
    await collections.users.updateOne({ username: req.panelUser.username }, { $set: { preferences, updatedAt: now() } });
    res.json(preferences);
  });

  router.get('/api/bot/status', async (req, res) => {
    const runtime = await registry.get(resolveAccountId(req));
    const counter = await collections.counters.findOne({ accountId: runtime.accountId, name: 'OrdenesRecibidas' });
    const status = runtime.getPublicStatus();
    status.ordenesRecibidas = counter?.seq ?? status.ordenesRecibidas;
    status.hasSession = await runtime.hasSavedSession();
    res.json(status);
  });

  router.post('/api/bot/start', async (req, res) => {
    try { res.json(await registry.start(resolveAccountId(req))); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/api/bot/stop', async (req, res) => {
    try { res.json(await registry.stop(resolveAccountId(req), 'manual_stop')); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/api/bot/logout', async (req, res) => {
    try { res.json(await registry.logout(resolveAccountId(req))); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/api/bot/config', async (req, res) => {
    const accountId = resolveAccountId(req);
    const config = await getConfig(collections, accountId) || defaultBotConfig(accountId);
    res.json(publicConfig(config));
  });

  router.put('/api/bot/config', async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const current = await getConfig(collections, accountId) || defaultBotConfig(accountId);
      const body = req.body || {};
      const deniedChange = deniedConfigChange(req.panelUser.permissions, body);
      if (deniedChange) return res.status(403).json({ error: `El administrador no te permite: ${deniedChange}` });
      const set = { updatedAt: now() };
      if (body.modo !== undefined) {
        if (!BOT_MODES.includes(body.modo)) return res.status(400).json({ error: 'Modo inválido' });
        set.modo = body.modo;
      }
      if (body.respuestas !== undefined) set.respuestas = !!body.respuestas;
      if (body.activo !== undefined) set.activo = !!body.activo;
      if (body.ignoreOwnMessages !== undefined) set.ignoreOwnMessages = body.ignoreOwnMessages !== false;
      if (body.storage !== undefined) set.storage = normalizeStorageConfig({ ...normalizeStorageConfig(current.storage), ...body.storage });
      if (body.repartidor) set.repartidor = repartidorSettings(current.repartidor, body.repartidor);
      if (body.ia) {
        set.ia = mergeIaUpdate(current.ia, body.ia);
        if (set.ia.provider === 'custom' && !(await getSystemSettingsCached(collections)).aiAllowCustomEndpoints) {
          return res.status(400).json({ error: 'El administrador no permite endpoints de IA personalizados' });
        }
      }
      if (body.connectionNotification) {
        set.connectionNotification = {
          enabled: !!body.connectionNotification.enabled,
          groupId: String(body.connectionNotification.groupId || '').trim(),
          message: String(body.connectionNotification.message || '').trim()
        };
      }
      if (body.timezone !== undefined) {
        const timezone = String(body.timezone || '').trim();
        if (!isValidTimeZone(timezone)) return res.status(400).json({ error: 'Zona horaria inválida' });
        set.timezone = timezone;
      }
      if (body.adminCommands !== undefined) {
        set.adminCommands = normalizeAdminCommandsConfig(body.adminCommands);
      }
      if (body.notifications !== undefined) {
        set.notifications = normalizeNotificationPrefs({ ...normalizeNotificationPrefs(current.notifications), ...body.notifications });
      }
      await collections.configs.updateOne({ accountId }, { $set: set }, { upsert: true });
      const runtime = await registry.get(accountId);
      await runtime.reloadConfig();
      if (set.ia) {
        // Deja listo el profile de Dipisik antes del primer mensaje (no bloquea el guardado).
        getSystemSettingsCached(collections)
          .then((settings) => ensureDipisikProfile(runtime.config.ia, settings, accountId))
          .catch((err) => runtime.logger.warn('ia', 'No se pudo preparar el profile de Dipisik', { error: err.message }));
      }
      const updated = await getConfig(collections, accountId);
      res.json(publicConfig(updated));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ─── Modo IA ───────────────────────────────────────────────────────────
  router.get('/api/bot/ia/providers', async (req, res) => {
    const settings = await getSystemSettingsCached(collections);
    res.json({ providers: publicProviderCatalog(settings), defaults: publicIaConfig(IA_DEFAULTS) });
  });

  // ─── Notificaciones push ───────────────────────────────────────────────
  router.get('/api/bot/push', async (req, res) => {
    const accountId = resolveAccountId(req);
    res.json({
      publicKey: push.publicKey,
      types: NOTIFICATION_TYPES,
      groups: NOTIFICATION_GROUPS,
      preferences: await push.preferences(accountId),
      subscribed: await push.isSubscribed(accountId, req.query.endpoint),
    });
  });

  router.post('/api/bot/push/subscribe', async (req, res) => {
    try {
      await push.subscribe(resolveAccountId(req), req.body?.subscription, req.headers['user-agent']);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/api/bot/push/unsubscribe', async (req, res) => {
    await push.unsubscribe(resolveAccountId(req), req.body?.endpoint);
    res.json({ ok: true });
  });

  router.post('/api/bot/push/test', async (req, res) => {
    const delivered = await push.notify({
      accountId: resolveAccountId(req),
      type: 'test',
      title: 'Ibot',
      body: '🔔 Las notificaciones funcionan en este dispositivo.',
      force: true,
    });
    if (!delivered) return res.status(400).json({ error: 'No hay dispositivos suscritos o el envío falló.' });
    res.json({ ok: true, delivered });
  });

  router.post('/api/bot/config/conn-notification/test', async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const runtime = await registry.get(accountId);
      if (!runtime.socket || runtime.status !== 'connected') {
        return res.status(400).json({ error: 'El bot no está conectado a WhatsApp. Conéctalo desde el Home primero.' });
      }
      const { groupId, message } = req.body || {};
      if (!groupId || !message) {
        return res.status(400).json({ error: 'El grupo destinatario y el mensaje son requeridos.' });
      }
      const sendStart = performance.now();
      await runtime.send(groupId, { text: `[Prueba de Notificación]\n${message}` }, { origin: 'panel' });
      const sendTime = performance.now() - sendStart;

      console.log(
        `[LATENCY] [${accountId}] Mensaje de prueba enviado a grupo ${groupId}:` +
        ` | Envío Socket: ${sendTime.toFixed(2)}ms` +
        ` | TOTAL: ${sendTime.toFixed(2)}ms`
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });


  router.put('/api/bot/config/order', async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const { categoryOrder, groupOrder } = req.body || {};
      const set = { updatedAt: now() };
      if (categoryOrder !== undefined) {
        if (!Array.isArray(categoryOrder)) return res.status(400).json({ error: 'categoryOrder debe ser un array' });
        set.categoryOrder = categoryOrder;
      }
      if (groupOrder !== undefined) {
        if (!Array.isArray(groupOrder)) return res.status(400).json({ error: 'groupOrder debe ser un array' });
        set.groupOrder = groupOrder;
      }
      await collections.configs.updateOne({ accountId }, { $set: set }, { upsert: true });
      const runtime = await registry.get(accountId);
      await runtime.reloadConfig();
      const updated = await getConfig(collections, accountId);
      res.json(publicConfig(updated));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/api/bot/respuestas/toggle', async (req, res) => {
    const accountId = resolveAccountId(req);
    const config = await getConfig(collections, accountId);
    const next = !config?.respuestas;
    await collections.configs.updateOne({ accountId }, { $set: { respuestas: next, updatedAt: now() } });
    const runtime = await registry.get(accountId);
    await runtime.reloadConfig();
    res.json({ respuestas: next });
  });

  router.put('/api/bot/grupos/:groupId/commands/toggle', async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const groupId = decodeURIComponent(req.params.groupId);
      const existing = await collections.groups.findOne({ accountId, groupId });
      if (!existing) return res.status(404).json({ error: 'grupo no encontrado' });
      const current = normalizeGroupDoc(existing);
      const nextEnabled = !current.commandSettings.enabled;
      await collections.groups.updateOne(
        { accountId, groupId },
        {
          $set: {
            'commandSettings.enabled': nextEnabled,
            updatedAt: now(),
          },
        },
      );
      const runtime = await registry.get(accountId);
      await runtime.reloadGroups();
      res.json({ ok: true, enabled: nextEnabled });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/api/bot/grupos', async (req, res) => {
    const accountId = resolveAccountId(req);
    const rows = await collections.groups.find({ accountId }).sort({ grupo: 1, nombre: 1 }).toArray();
    res.json(rows.map(normalizeGroupDoc));
  });

  router.get('/api/bot/grupos/categories', async (req, res) => {
    const accountId = resolveAccountId(req);
    const rows = await collections.groups.distinct('grupo', { accountId });
    res.json(rows.filter(Boolean).sort());
  });

  router.post('/api/bot/grupos', async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const doc = cleanGroupPayload(req.body, accountId);
      const { maxGroups } = req.panelUser.permissions.limits;
      if (maxGroups && await collections.groups.countDocuments({ accountId }) >= maxGroups) {
        return res.status(403).json({ error: `Alcanzaste el límite de ${maxGroups} grupo(s) que te asignó el administrador.` });
      }
      await collections.groups.insertOne({ ...doc, createdAt: now(), updatedAt: now() });
      const runtime = await registry.get(accountId);
      await runtime.reloadGroups();
      res.json({ ok: true, grupo: doc });
    } catch (err) {
      const code = /duplicate/i.test(err.message) || err.code === 11000 ? 409 : 400;
      res.status(code).json({ error: err.message });
    }
  });

  // IMPORTANT: rutas estáticas ANTES de /:groupId para evitar colisión en Express
  router.post('/api/bot/grupos/toggle_independent', async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const active = await collections.groups.countDocuments({ accountId, independiente: true, responder: true }) > 0;
      const newState = !active;
      const result = await collections.groups.updateMany({ accountId, independiente: true }, { $set: { responder: newState, updatedAt: now() } });
      const runtime = await registry.get(accountId);
      await runtime.reloadGroups();
      res.json({ ok: true, independientesActivos: newState, matched: result.matchedCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/bot/grupos/:groupId', async (req, res) => {
    const accountId = resolveAccountId(req);
    const groupId = decodeURIComponent(req.params.groupId);
    const doc = await collections.groups.findOne({ accountId, groupId });
    if (!doc) return res.status(404).json({ error: 'grupo no encontrado' });
    res.json(normalizeGroupDoc(doc));
  });

  router.put('/api/bot/grupos/:groupId', async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const groupId = decodeURIComponent(req.params.groupId);
      const existing = await collections.groups.findOne({ accountId, groupId });
      if (!existing) return res.status(404).json({ error: 'grupo no encontrado' });
      const doc = cleanGroupPayload({ ...existing, ...req.body, groupId }, accountId);
      delete doc.createdAt;
      await collections.groups.updateOne({ accountId, groupId }, { $set: { ...doc, updatedAt: now() } }, { upsert: false });
      const runtime = await registry.get(accountId);
      // El formulario siempre envía el contador; solo se aplica si el usuario lo cambió.
      // Se aplica antes de recargar para que la recarga tome el resto de campos
      // (por ejemplo, reactivar un grupo que había llegado a su límite).
      if (req.body?.contador !== undefined && Number(doc.contador) !== Number(existing.contador || 0)) {
        runtime.setGroupCounter(groupId, doc.contador);
      }
      await runtime.reloadGroups();
      const updated = await collections.groups.findOne({ accountId, groupId });
      res.json({ ok: true, grupo: normalizeGroupDoc(updated) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/api/bot/grupos/:groupId', async (req, res) => {
    const accountId = resolveAccountId(req);
    const groupId = decodeURIComponent(req.params.groupId);
    const result = await collections.groups.deleteOne({ accountId, groupId });
    const runtime = await registry.get(accountId);
    await runtime.reloadGroups();
    res.json({ ok: result.deletedCount > 0 });
  });

  router.post('/api/bot/grupos/:groupId/reset-contador', async (req, res) => {
    const accountId = resolveAccountId(req);
    const groupId = decodeURIComponent(req.params.groupId);
    await collections.groups.updateOne({ accountId, groupId }, { $set: { contador: 0, updatedAt: now() } });
    const runtime = await registry.get(accountId);
    runtime.setGroupCounter(groupId, 0);
    await runtime.reloadGroups();
    res.json({ ok: true });
  });

  // Chats registrados (grupos y contactos). ?type=group|contact filtra. Incluye
  // la regla de IA de cada chat (permitir/bloquear y plantilla).
  router.get('/api/bot/chats/groups', async (req, res) => {
    const runtime = await registry.get(resolveAccountId(req));
    const [configured, rows] = await Promise.all([
      collections.groups.find({ accountId: runtime.accountId }, { projection: { groupId: 1, nombre: 1 } }).toArray(),
      runtime.chatStore.listGroups({ q: req.query.q, type: req.query.type }),
    ]);
    const configuredMap = new Map(configured.map((g) => [g.groupId, g]));
    res.json(rows.map((g) => {
      const isGroup = String(g.groupId).endsWith('@g.us');
      const rule = runtime.aiRuleFor(g.groupId);
      return {
        ...g,
        type: isGroup ? 'group' : 'contact',
        subject: configuredMap.get(g.groupId)?.nombre || (isGroup ? g.subject : runtime.chatName(g.groupId)) || g.groupId,
        configured: configuredMap.has(g.groupId),
        isSelf: runtime.isSelfChat(g.groupId),
        ai: { access: rule?.access || 'inherit', templateId: rule?.templateId || null },
      };
    }));
  });

  // Envía texto, una imagen (con texto como pie) o un sticker de la biblioteca.
  router.post('/api/bot/chats/:chatId/send', async (req, res) => {
    try {
      const chatId = decodeURIComponent(req.params.chatId);
      if (!CHAT_JID.test(chatId)) return res.status(400).json({ error: 'Chat inválido' });
      const text = String(req.body?.text || '').trim().slice(0, 4000);
      const runtime = await registry.get(resolveAccountId(req));
      if (req.body?.stickerId) {
        const sticker = await runtime.stickers.resolve(runtime.accountId, String(req.body.stickerId));
        if (!sticker) return res.status(404).json({ error: 'El sticker ya no existe' });
        const content = await runtime.media.messageContent(runtime.accountId, sticker.mediaId);
        await runtime.send(chatId, content, { origin: 'panel', mediaId: sticker.mediaId });
        runtime.stickers.markUsed(runtime.accountId, sticker.id);
        return res.json({ ok: true });
      }
      if (req.body?.mediaId) {
        const media = await runtime.media.meta(runtime.accountId, req.body.mediaId);
        if (!media) return res.status(404).json({ error: 'La imagen ya no existe' });
        const content = await runtime.media.messageContent(runtime.accountId, media.id, text);
        await runtime.send(chatId, content, { origin: 'panel', mediaId: media.id });
        return res.json({ ok: true });
      }
      if (!text) return res.status(400).json({ error: 'Escribe un mensaje' });
      await runtime.send(chatId, { text }, { origin: 'panel' });
      res.json({ ok: true });
    } catch (err) {
      res.status(/no está conectado/.test(err.message) ? 400 : 500).json({ error: err.message });
    }
  });

  router.get('/api/bot/chats/groups/:groupId/messages', async (req, res) => {
    const runtime = await registry.get(resolveAccountId(req));
    const rows = await runtime.chatStore.readMessages(decodeURIComponent(req.params.groupId), {
      limit: req.query.limit,
      before: req.query.before,
    });
    res.json(rows);
  });

  // Vacía los mensajes guardados de un chat (o solo sus imágenes y stickers).
  router.delete('/api/bot/chats/groups/:groupId/messages', async (req, res) => {
    const accountId = resolveAccountId(req);
    const chatId = decodeURIComponent(req.params.groupId);
    const result = await storage.clear(accountId, { scope: 'chats', chatIds: [chatId], mediaOnly: req.query.mediaOnly === '1' });
    res.json({ ok: true, ...result });
  });

  router.get('/api/bot/directory/export.csv', async (req, res) => {
    try {
      const runtime = await registry.get(resolveAccountId(req));
      const snapshot = await buildDirectorySnapshot({
        accountId: runtime.accountId,
        collections,
        runtime,
        refresh: req.query.refresh === '1',
      });
      const csv = directoryCsv(snapshot, req.query);
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="directorio-ibot-${date}.csv"`);
      res.send(csv);
    } catch (error) {
      console.error('[directory] Error exportando el directorio:', error);
      res.status(500).json({ error: 'No se pudo exportar el directorio de contactos.' });
    }
  });

  router.get('/api/bot/directory', async (req, res) => {
    try {
      const runtime = await registry.get(resolveAccountId(req));
      const snapshot = await buildDirectorySnapshot({
        accountId: runtime.accountId,
        collections,
        runtime,
        refresh: req.query.refresh === '1',
      });
      res.json(paginateDirectory(snapshot, req.query));
    } catch (error) {
      console.error('[directory] Error cargando el directorio:', error);
      res.status(500).json({ error: 'No se pudo cargar el directorio de contactos.' });
    }
  });

  router.get('/api/bot/scheduled-messages', async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      res.json(await scheduler.list(accountId, { limit: req.query.limit, status: req.query.status }));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/bot/scheduled-messages', async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const config = await getConfig(collections, accountId) || defaultBotConfig(accountId);
      const scheduled = await scheduler.create({
        accountId,
        message: req.body?.message,
        media: req.body?.media,
        target: req.body?.target,
        localDate: req.body?.localDate,
        localTime: req.body?.localTime,
        repeat: req.body?.repeat || 'none',
        timeZone: config.timezone || 'America/Hermosillo',
      });
      res.status(201).json(scheduled);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.delete('/api/bot/scheduled-messages/:id', async (req, res) => {
    try {
      const cancelled = await scheduler.cancel(resolveAccountId(req), req.params.id);
      if (!cancelled) return res.status(404).json({ error: 'Mensaje pendiente no encontrado' });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Estado del WhatsApp y grupos en tiempo real para el panel del usuario.
  router.get('/api/bot/events/live', async (req, res) => {
    const runtime = await registry.get(resolveAccountId(req));
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    const send = (payload) => res.write(`event: live\ndata: ${JSON.stringify(payload)}\n\n`);
    const off = registry.eventBus.on(`live:${runtime.accountId}`, send);
    // Comentario periódico para que proxies no cierren la conexión inactiva.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { off(); clearInterval(heartbeat); });
  });

  router.get('/api/bot/events/chats', async (req, res) => {
    const accountId = resolveAccountId(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    const offMsg = registry.eventBus.on(`chat-message:${accountId}`, (entry) => res.write(`event: message\ndata: ${JSON.stringify(entry)}\n\n`));
    const offGroup = registry.eventBus.on(`chat-groups:${accountId}`, (entry) => res.write(`event: group\ndata: ${JSON.stringify(entry)}\n\n`));
    const offMedia = registry.eventBus.on(`chat-media:${accountId}`, (entry) => res.write(`event: media\ndata: ${JSON.stringify(entry)}\n\n`));
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { offMsg(); offGroup(); offMedia(); clearInterval(heartbeat); });
  });

  router.use(createMediaRouter({ collections, registry, storage, resolveAccountId }));
  router.use(createAiRouter({ collections, registry, resolveAccountId }));

  return router;
}
