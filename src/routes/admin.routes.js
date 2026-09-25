import { Router } from 'express';
import { createPanelUser, requirePanelOwner, validatePassword, hashPassword } from './auth.middleware.js';

async function countByAccount(collection) {
  const rows = await collection.aggregate([
    { $group: { _id: '$accountId', count: { $sum: 1 } } },
  ]).toArray();
  return new Map(rows.map((row) => [row._id, row.count]));
}

export function createAdminRouter({ collections, registry }) {
  const router = Router();
  router.use('/api/admin', requirePanelOwner);

  // GET /api/admin/overview — Resumen de todas las cuentas
  router.get('/api/admin/overview', async (req, res, next) => {
    try {
      const [users, accounts, configs, groupCounts, contactCounts, messageCounts, scheduledCounts] = await Promise.all([
        collections.users.find({}, { projection: { password: 0 } }).sort({ createdAt: 1 }).toArray(),
        collections.accounts.find({}).toArray(),
        collections.configs.find({}).toArray(),
        countByAccount(collections.groups),
        countByAccount(collections.contacts),
        countByAccount(collections.chatMessages),
        countByAccount(collections.scheduledMessages),
      ]);
      const accountsByUser = new Map(accounts.map((account) => [String(account.userId), account]));
      const configsByAccount = new Map(configs.map((config) => [config.accountId, config]));
      const rows = users.map((user) => {
        const account = accountsByUser.get(String(user._id));
        const config = account ? configsByAccount.get(account.accountId) : null;
        return {
          username: user.username,
          role: user.role || 'account',
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt || null,
          account: account ? {
            accountId: account.accountId,
            label: account.label,
            status: account.status || 'stopped',
            phoneName: account.phoneName || null,
            phoneJid: account.phoneJid || null,
            active: config?.activo === true,
            respuestas: config?.respuestas === true,
            mode: config?.modo || 'normal',
            groups: groupCounts.get(account.accountId) || 0,
            contacts: contactCounts.get(account.accountId) || 0,
            messages: messageCounts.get(account.accountId) || 0,
            scheduled: scheduledCounts.get(account.accountId) || 0,
          } : null,
        };
      });
      res.json({
        summary: {
          users: rows.length,
          connected: rows.filter((row) => row.account?.status === 'connected').length,
          configuredGroups: [...groupCounts.values()].reduce((total, value) => total + value, 0),
          observedMessages: [...messageCounts.values()].reduce((total, value) => total + value, 0),
        },
        users: rows,
      });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/admin/users — Crear nueva cuenta de usuario
  router.post('/api/admin/users', async (req, res) => {
    try {
      const user = await createPanelUser(collections, {
        username: req.body?.username,
        password: req.body?.password,
        role: 'account',
      });
      res.status(201).json({ ok: true, user: { username: user.username, role: user.role } });
    } catch (error) {
      const status = error?.code === 11000 ? 409 : 400;
      res.status(status).json({ error: error.message || 'No se pudo crear la cuenta.' });
    }
  });

  // DELETE /api/admin/users/:username — Eliminar cuenta y todos sus datos
  router.delete('/api/admin/users/:username', async (req, res) => {
    const { username } = req.params;
    if (username === req.panelUser?.username) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta de propietario.' });
    }
    try {
      const user = await collections.users.findOne({ username });
      if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
      if (user.role === 'owner') return res.status(403).json({ error: 'No se puede eliminar una cuenta de propietario.' });

      const account = await collections.accounts.findOne({ userId: String(user._id) });
      if (account) {
        // Detener y desconectar el bot antes de limpiar datos
        await registry.stop(account.accountId, 'admin_delete').catch(() => null);
        await registry.logout(account.accountId).catch(() => null);
        await Promise.all([
          collections.accounts.deleteMany({ userId: String(user._id) }),
          collections.configs.deleteMany({ accountId: account.accountId }),
          collections.groups.deleteMany({ accountId: account.accountId }),
          collections.contacts.deleteMany({ accountId: account.accountId }),
          collections.chatMessages.deleteMany({ accountId: account.accountId }),
          collections.scheduledMessages.deleteMany({ accountId: account.accountId }),
          collections.counters.deleteMany({ accountId: account.accountId }),
          collections.whatsappSessions.deleteMany({ accountId: account.accountId }),
        ]);
      }
      await collections.users.deleteOne({ _id: user._id });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error.message || 'No se pudo eliminar la cuenta.' });
    }
  });

  // PUT /api/admin/users/:username/password — Cambiar contraseña de cualquier cuenta
  router.put('/api/admin/users/:username/password', async (req, res) => {
    const { username } = req.params;
    const { password } = req.body || {};
    try {
      const err = validatePassword(password);
      if (err) return res.status(400).json({ error: err });
      const result = await collections.users.updateOne(
        { username },
        { $set: { password: hashPassword(password), updatedAt: new Date() } },
      );
      if (result.matchedCount === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message || 'No se pudo cambiar la contraseña.' });
    }
  });

  // POST /api/admin/accounts/:accountId/:action — Controlar bot (start/stop/logout)
  router.post('/api/admin/accounts/:accountId/:action', async (req, res) => {
    const { accountId, action } = req.params;
    if (!['start', 'stop', 'logout'].includes(action)) return res.status(400).json({ error: 'Acción inválida.' });
    try {
      const account = await collections.accounts.findOne({ accountId });
      if (!account) return res.status(404).json({ error: 'Cuenta no encontrada.' });
      const status = action === 'start'
        ? await registry.start(accountId)
        : action === 'stop'
          ? await registry.stop(accountId, 'admin_stop')
          : await registry.logout(accountId);
      res.json({ ok: true, status });
    } catch (error) {
      res.status(400).json({ error: error.message || 'No se pudo controlar la cuenta.' });
    }
  });

  return router;
}
