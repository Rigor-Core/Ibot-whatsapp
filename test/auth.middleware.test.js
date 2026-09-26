import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionCookie,
  homePathFor,
  requireAccountUser,
  requirePanelOwner,
  routePagesByRole,
  validatePassword,
  verifySessionCookie,
} from '../src/routes/auth.middleware.js';
import { deniedApiPermission, deniedConfigChange, normalizePermissions } from '../src/services/permissions.js';

test('exige contraseñas robustas para nuevas cuentas', () => {
  assert.match(validatePassword('corta'), /12 caracteres/);
  assert.match(validatePassword('solominusculas123'), /mayúsculas/);
  assert.match(validatePassword('SOLOMAYUSCULAS123'), /minúsculas/);
  assert.match(validatePassword('SinNumerosSegura'), /números/);
  assert.equal(validatePassword('ClaveSegura2026'), null);
});

function fakeResponse() {
  return {
    redirectedTo: null,
    statusCode: 200,
    body: null,
    redirect(path) { this.redirectedTo = path; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('cada rol solo accede a su propio panel', () => {
  const run = (role, path, method = 'GET', permissions = normalizePermissions()) => {
    const res = fakeResponse();
    let passed = false;
    routePagesByRole({ panelUser: role ? { role, permissions } : undefined, path, method }, res, () => { passed = true; });
    return { passed, redirectedTo: res.redirectedTo };
  };
  assert.deepEqual(run('owner', '/grupos.html'), { passed: false, redirectedTo: '/admin.html' });
  assert.deepEqual(run('owner', '/'), { passed: false, redirectedTo: '/admin.html' });
  assert.deepEqual(run('owner', '/admin.html'), { passed: true, redirectedTo: null });
  assert.deepEqual(run('account', '/admin.html'), { passed: false, redirectedTo: '/' });
  assert.deepEqual(run('account', '/grupos.html'), { passed: true, redirectedTo: null });
  assert.deepEqual(run('account', '/api/admin/overview'), { passed: true, redirectedTo: null });
  const noContacts = normalizePermissions({ pages: { contactos: false } });
  assert.deepEqual(run('account', '/contactos.html', 'GET', noContacts), { passed: false, redirectedTo: '/' });
  assert.deepEqual(run('account', '/grupos.html', 'GET', noContacts), { passed: true, redirectedTo: null });
  assert.equal(homePathFor('owner'), '/admin.html');
  assert.equal(homePathFor('account'), '/');
});

test('la API de WhatsApp es solo para usuarios y la de administración solo para el administrador', () => {
  const guard = (middleware, role) => {
    const res = fakeResponse();
    let passed = false;
    middleware({ panelUser: { role } }, res, () => { passed = true; });
    return passed ? 200 : res.statusCode;
  };
  assert.equal(guard(requireAccountUser, 'account'), 200);
  assert.equal(guard(requireAccountUser, 'owner'), 403);
  assert.equal(guard(requirePanelOwner, 'owner'), 200);
  assert.equal(guard(requirePanelOwner, 'account'), 403);
});

test('la cookie de sesión incluye la versión de sesión para poder invalidarla', () => {
  const user = { _id: '65f1c2a4b7e8d9a0b1c2d3e4', username: 'repartidor', sessionVersion: 3 };
  const session = verifySessionCookie(createSessionCookie(user));
  assert.equal(session.username, 'repartidor');
  assert.equal(session.sv, 3);
  const [payload, signature] = createSessionCookie(user).split('.');
  assert.equal(verifySessionCookie(`${payload}x.${signature}`), null);
});

test('la API respeta páginas, funciones y modos prohibidos', () => {
  const permissions = normalizePermissions({
    pages: { chats: false },
    features: { manageGroups: false, iaSettings: false },
    modes: { ia: false },
  });
  assert.match(deniedApiPermission(permissions, 'GET', '/api/bot/chats/groups'), /Chats/);
  assert.equal(deniedApiPermission(permissions, 'GET', '/api/bot/grupos'), null);
  assert.match(deniedApiPermission(permissions, 'POST', '/api/bot/grupos'), /grupos/);
  assert.match(deniedConfigChange(permissions, { modo: 'ia' }), /IA/);
  assert.equal(deniedConfigChange(permissions, { modo: 'repartidor' }), null);
  assert.match(deniedConfigChange(permissions, { ia: {} }), /IA/);
  const none = normalizePermissions({ modes: { repartidor: false, normal: false, watch: false, ia: false } });
  assert.equal(none.modes.repartidor, true);
});
