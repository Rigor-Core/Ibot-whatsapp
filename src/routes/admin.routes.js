import { Router } from 'express';
import {
  ROLE_ACCOUNT,
  createPanelUser,
  createSessionCookie,
  requirePanelOwner,
  setSessionCookie,
  setUserPassword,
  verifyPassword,
} from './auth.middleware.js';
import {
  assertOrphanAccount,
  assignAccountToUser,
  buildOverview,
  buildStats,
  deleteUserWithData,
  systemInfo,
} from '../services/admin-service.js';
import { getSystemSettings, updateSystemSettings } from '../services/settings-service.js';

const ACCOUNT_ACTIONS = new Set(['start', 'stop', 'logout']);

// Envuelve un handler async y responde los errores en JSON.
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      const status = error?.code === 11000 ? 409 : (error?.status || 500);
      const message = error?.code === 11000 ? 'Ese usuario ya existe.' : (error?.message || 'Error interno');
      if (status >= 500) console.error('[admin] Error:', error);
      res.status(status).json({ error: message });
    }
  };
}

async function findAccountUser(collections, username) {
  const user = await collections.users.findOne({ username: String(username || '').toLowerCase() });
  if (!user) throw Object.assign(new Error('Usuario no encontrado.'), { status: 404 });
  if (user.role === 'owner') {
    throw Object.assign(new Error('Los administradores se gestionan desde "Mi cuenta".'), { status: 403 });
  }
  return user;
}

export function createAdminRouter({ collections, registry, scheduler }) {
  const router = Router();
  router.use('/api/admin', requirePanelOwner);

  // ─── Resumen y estadísticas ────────────────────────────────────────────
  router.get('/api/admin/overview', handle(async (req, res) => {
    res.json(await buildOverview({ collections, registry }));
  }));

  router.get('/api/admin/stats', handle(async (req, res) => {
    res.json(await buildStats({ collections, registry, days: req.query.days }));
  }));

  router.get('/api/admin/system', handle(async (req, res) => {
    res.json(systemInfo({ registry, scheduler }));
  }));

  // ─── Configuración del sistema ─────────────────────────────────────────
  router.get('/api/admin/settings', handle(async (req, res) => {
    res.json(await getSystemSettings(collections));
  }));

  router.put('/api/admin/settings', handle(async (req, res) => {
    try {
      res.json(await updateSystemSettings(collections, req.body || {}));
    } catch (error) {
      throw Object.assign(error, { status: error.status || 400 });
    }
  }));

  // ─── Usuarios ──────────────────────────────────────────────────────────
  router.post('/api/admin/users', handle(async (req, res) => {
    const assignAccountId = String(req.body?.assignAccountId || '').trim();
    if (assignAccountId) await assertOrphanAccount(collections, assignAccountId);
    let user;
    try {
      user = await createPanelUser(collections, {
        username: req.body?.username,
        password: req.body?.password,
        role: ROLE_ACCOUNT,
      });
    } catch (error) {
      throw Object.assign(error, { status: error.status || 400 });
    }
    if (assignAccountId) await assignAccountToUser({ collections, accountId: assignAccountId, user });
    res.status(201).json({ ok: true, user: { username: user.username } });
  }));

  router.delete('/api/admin/users/:username', handle(async (req, res) => {
    const user = await findAccountUser(collections, req.params.username);
    await deleteUserWithData({ collections, registry, user });
    res.json({ ok: true });
  }));

  router.put('/api/admin/users/:username/password', handle(async (req, res) => {
    const user = await findAccountUser(collections, req.params.username);
    await setUserPassword(collections, { _id: user._id }, req.body?.password);
    res.json({ ok: true });
  }));

  // Suspender cierra todas las sesiones del usuario y apaga su WhatsApp.
  router.post('/api/admin/users/:username/status', handle(async (req, res) => {
    const user = await findAccountUser(collections, req.params.username);
    const disabled = req.body?.disabled === true;
    await collections.users.updateOne(
      { _id: user._id },
      { $set: { disabled, updatedAt: new Date() }, ...(disabled ? { $inc: { sessionVersion: 1 } } : {}) },
    );
    if (disabled) {
      const account = await collections.accounts.findOne({ userId: String(user._id) });
      if (account && registry.isRunning(account.accountId)) {
        await registry.stop(account.accountId, 'admin_suspend');
      }
    }
    res.json({ ok: true, disabled });
  }));

  // ─── Cuentas de WhatsApp ───────────────────────────────────────────────
  router.post('/api/admin/accounts/:accountId/assign', handle(async (req, res) => {
    const user = await findAccountUser(collections, req.body?.username);
    await assignAccountToUser({ collections, accountId: req.params.accountId, user });
    res.json({ ok: true });
  }));

  router.post('/api/admin/accounts/:accountId/:action', handle(async (req, res) => {
    const { accountId, action } = req.params;
    if (!ACCOUNT_ACTIONS.has(action)) return res.status(400).json({ error: 'Acción inválida.' });
    const account = await collections.accounts.findOne({ accountId });
    if (!account) return res.status(404).json({ error: 'Cuenta no encontrada.' });
    const status = action === 'start'
      ? await registry.start(accountId)
      : action === 'stop'
        ? await registry.stop(accountId, 'admin_stop')
        : await registry.logout(accountId);
    res.json({ ok: true, status });
  }));

  // ─── Cuenta del administrador ──────────────────────────────────────────
  router.put('/api/admin/me/password', handle(async (req, res) => {
    const me = await collections.users.findOne({ username: req.panelUser.username });
    if (!me || !verifyPassword(String(req.body?.currentPassword || ''), me)) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
    }
    const updated = await setUserPassword(collections, { _id: me._id }, req.body?.password);
    // Las demás sesiones quedan cerradas; esta se renueva.
    setSessionCookie(res, createSessionCookie(updated));
    res.json({ ok: true });
  }));

  return router;
}
