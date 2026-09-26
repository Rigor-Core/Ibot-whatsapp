import { Router } from 'express';
import { getConfig, defaultBotConfig } from '../services/account-service.js';
import { normalizeIaConfig, normalizeIaRules } from '../services/ai-providers.js';
import { AiTemplateStore, TEMPLATE_PRESETS } from '../services/ai-templates.js';
import { getSystemSettingsCached } from '../services/settings-service.js';
import { getExtension, normalizeExtensionsConfig, publicExtensions } from '../extensions/index.js';
import { runAgent } from '../bot/ai/agent.js';
import { buildSystemPrompt } from '../bot/ai/context.js';

// Rutas de la IA (plantillas, reglas por chat, prueba y memoria) y de las
// extensiones. Se montan detrás del middleware de /api/bot.
export function createAiRouter({ collections, registry, resolveAccountId }) {
  const router = Router();
  const templates = new AiTemplateStore({ collections });
  const runtimeFor = (req) => registry.get(resolveAccountId(req));
  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  };

  async function currentIa(accountId) {
    const config = await getConfig(collections, accountId) || defaultBotConfig(accountId);
    return normalizeIaConfig(config.ia);
  }

  async function saveIaFields(accountId, fields) {
    const set = Object.fromEntries(Object.entries(fields).map(([key, value]) => [`ia.${key}`, value]));
    await collections.configs.updateOne({ accountId }, { $set: { ...set, updatedAt: new Date() } }, { upsert: true });
    const runtime = await registry.get(accountId);
    await runtime.reloadConfig();
    return runtime.config.ia;
  }

  // ─── Plantillas de comportamiento ──────────────────────────────────────
  router.get('/api/bot/ia/templates', handle(async (req, res) => {
    const accountId = resolveAccountId(req);
    const ia = await currentIa(accountId);
    res.json({ templates: await templates.list(accountId), presets: TEMPLATE_PRESETS, defaultTemplateId: ia.defaultTemplateId });
  }));

  router.post('/api/bot/ia/templates', handle(async (req, res) => {
    const runtime = await runtimeFor(req);
    const created = await templates.create(runtime.accountId, req.body || {});
    await runtime.reloadAiTemplates();
    res.status(201).json(created);
  }));

  router.put('/api/bot/ia/templates/:id', handle(async (req, res) => {
    const runtime = await runtimeFor(req);
    const updated = await templates.update(runtime.accountId, req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Plantilla no encontrada' });
    await runtime.reloadAiTemplates();
    res.json(updated);
  }));

  // Al borrar una plantilla, los chats que la usaban vuelven a la general.
  router.delete('/api/bot/ia/templates/:id', handle(async (req, res) => {
    const runtime = await runtimeFor(req);
    const { id } = req.params;
    if (!(await templates.remove(runtime.accountId, id))) return res.status(404).json({ error: 'Plantilla no encontrada' });
    const ia = await currentIa(runtime.accountId);
    await saveIaFields(runtime.accountId, {
      defaultTemplateId: ia.defaultTemplateId === id ? '' : ia.defaultTemplateId,
      rules: normalizeIaRules(ia.rules.map((rule) => (rule.templateId === id ? { ...rule, templateId: null } : rule))),
    });
    await runtime.reloadAiTemplates();
    res.json({ ok: true });
  }));

  router.put('/api/bot/ia/default-template', handle(async (req, res) => {
    const accountId = resolveAccountId(req);
    const id = String(req.body?.templateId || '');
    if (id && !(await templates.list(accountId)).some((template) => template.id === id)) {
      return res.status(404).json({ error: 'Plantilla no encontrada' });
    }
    const ia = await saveIaFields(accountId, { defaultTemplateId: id });
    res.json({ defaultTemplateId: ia.defaultTemplateId });
  }));

  // ─── Reglas por chat (permitir, bloquear, plantilla propia) ────────────
  router.get('/api/bot/ia/rules', handle(async (req, res) => {
    res.json((await currentIa(resolveAccountId(req))).rules);
  }));

  router.put('/api/bot/ia/rules/:chatId', handle(async (req, res) => {
    const accountId = resolveAccountId(req);
    const chatId = decodeURIComponent(req.params.chatId);
    const ia = await currentIa(accountId);
    const next = normalizeIaRules([
      ...ia.rules.filter((rule) => rule.chatId !== chatId),
      { chatId, access: req.body?.access, templateId: req.body?.templateId, name: req.body?.name },
    ]);
    const saved = await saveIaFields(accountId, { rules: next });
    res.json(saved.rules.find((rule) => rule.chatId === chatId) || { chatId, access: 'inherit', templateId: null });
  }));

  // ─── Memoria y prueba ──────────────────────────────────────────────────
  // La IA deja de usar como contexto lo anterior a este momento.
  router.post('/api/bot/ia/reset-memory', handle(async (req, res) => {
    const runtime = await runtimeFor(req);
    runtime.aiMemory.clear();
    await saveIaFields(runtime.accountId, { memoryResetAt: Date.now() });
    res.json({ ok: true });
  }));

  // Prueba la configuración (proveedor, clave y plantilla) sin enviar nada a WhatsApp.
  router.post('/api/bot/ia/test', handle(async (req, res) => {
    const runtime = await runtimeFor(req);
    const text = String(req.body?.text || '').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: 'Escribe un mensaje de prueba' });
    const ia = runtime.config.ia;
    const template = runtime.aiTemplates.get(String(req.body?.templateId || ia.defaultTemplateId)) || null;
    const system = await buildSystemPrompt({
      runtime,
      chat: { isGroup: false, name: 'una persona (prueba desde el panel)' },
      template,
      isOwnerChat: false,
      stickers: [],
      hasTools: false,
    });
    const started = Date.now();
    const { text: answer } = await runAgent({
      ia,
      settings: await getSystemSettingsCached(collections),
      accountId: runtime.accountId,
      messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
      temperature: template?.temperature ?? undefined,
    });
    res.json({ answer: answer || '(respuesta vacía)', ms: Date.now() - started });
  }));

  // ─── Extensiones ───────────────────────────────────────────────────────
  router.get('/api/bot/extensions', handle(async (req, res) => {
    const config = await getConfig(collections, resolveAccountId(req));
    res.json(publicExtensions(config?.extensions, req.panelUser.permissions));
  }));

  async function permittedExtension(req) {
    const extension = getExtension(req.params.id);
    if (!extension) throw Object.assign(new Error('Extensión desconocida'), { status: 404 });
    if (!req.panelUser.permissions.extensions?.[extension.id]) {
      throw Object.assign(new Error(`El administrador no te permite usar ${extension.name}`), { status: 403 });
    }
    return extension;
  }

  router.put('/api/bot/extensions/:id', handle(async (req, res) => {
    const extension = await permittedExtension(req);
    const accountId = resolveAccountId(req);
    const config = await getConfig(collections, accountId);
    const current = normalizeExtensionsConfig(config?.extensions)[extension.id];
    const next = extension.mergeUpdate(current, req.body || {});
    await collections.configs.updateOne({ accountId }, { $set: { [`extensions.${extension.id}`]: next, updatedAt: new Date() } }, { upsert: true });
    const runtime = await registry.get(accountId);
    await runtime.reloadConfig();
    res.json(publicExtensions(runtime.config.extensions, req.panelUser.permissions).find((item) => item.id === extension.id));
  }));

  router.post('/api/bot/extensions/:id/test', handle(async (req, res) => {
    const extension = await permittedExtension(req);
    const config = await getConfig(collections, resolveAccountId(req));
    const settings = normalizeExtensionsConfig(config?.extensions)[extension.id];
    if (!extension.isConfigured(settings)) return res.status(400).json({ error: 'Primero guarda el token' });
    res.json(await extension.test(settings));
  }));

  return router;
}
