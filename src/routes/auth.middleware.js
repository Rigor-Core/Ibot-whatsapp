import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { panelSecret } from '../core/secrets.js';
import { PAGE_PERMISSIONS, normalizePermissions } from '../services/permissions.js';
import { normalizePreferences } from '../services/preferences.js';
import { assertUserCapacity, getSystemSettings } from '../services/settings-service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_DAYS = Number(process.env.PANEL_SESSION_DAYS || 7);
const ITERATIONS = 600000;
const KEYLEN = 32;
const DIGEST = 'sha256';
const CSRF_COOKIE = 'ibot_csrf_token';
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

export const ROLE_OWNER = 'owner';
export const ROLE_ACCOUNT = 'account';

// Páginas del panel de usuario y del panel de administración.
const USER_PAGES = new Set([
  '/', '/index', '/index.html', '/grupos', '/grupos.html', '/grupos-moderno', '/grupos-moderno.html',
  '/contactos', '/contactos.html', '/configuracion', '/configuracion.html', '/chats', '/chats.html',
]);
// La ventana de Grupos tiene dos vistas; cada usuario elige la suya en Ajustes.
const GROUPS_PAGES = new Set(['/grupos', '/grupos.html', '/grupos-moderno', '/grupos-moderno.html']);
const ADMIN_PAGES = new Set(['/admin', '/admin.html']);

export function homePathFor(role) {
  return role === ROLE_OWNER ? '/admin.html' : '/';
}

function isSecureCookie() {
  return process.env.NODE_ENV === 'production' && String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';
}

function sessionCookieName() {
  return isSecureCookie() ? '__Host-ibot_panel_session' : 'ibot_panel_session';
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    String(header || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf('=');
        if (idx === -1) return [part, ''];
        return [decodeURIComponent(part.slice(0, idx)), decodeURIComponent(part.slice(idx + 1))];
      }),
  );
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', panelSecret()).update(payload).digest('base64url');
}

export function createSessionCookie(user) {
  const exp = Date.now() + SESSION_DAYS * DAY_MS;
  // sv (versión de sesión) permite invalidar todas las sesiones de un usuario
  // al cambiar su contraseña o suspenderlo.
  const payload = base64url(JSON.stringify({
    uid: String(user._id),
    username: user.username,
    sv: Number(user.sessionVersion || 0),
    exp,
  }));
  return `${payload}.${sign(payload)}`;
}

export function verifySessionCookie(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.', 2);
  const expected = sign(payload);
  const a = Buffer.from(signature || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    if (!ObjectId.isValid(data.uid)) return null;
    return data;
  } catch {
    return null;
  }
}

export function cookieOptions({ clear = false } = {}) {
  const name = sessionCookieName();
  const secure = isSecureCookie();
  const parts = [
    `${name}=${clear ? '' : '%TOKEN%'}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  if (clear) parts.push('Max-Age=0');
  else parts.push(`Max-Age=${SESSION_DAYS * 24 * 60 * 60}`);
  return parts.join('; ');
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', cookieOptions().replace('%TOKEN%', encodeURIComponent(token)));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', cookieOptions({ clear: true }));
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, ITERATIONS, KEYLEN, DIGEST).toString('hex');
  return { salt, hash, iterations: ITERATIONS, digest: DIGEST };
}

export function verifyPassword(password, user) {
  if (!user?.password?.salt || !user?.password?.hash) return false;
  const computed = crypto.pbkdf2Sync(String(password), user.password.salt, user.password.iterations || ITERATIONS, KEYLEN, user.password.digest || DIGEST).toString('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(user.password.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 12) return 'La contraseña debe tener al menos 12 caracteres.';
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
    return 'La contraseña debe incluir mayúsculas, minúsculas y números.';
  }
  return null;
}

export async function createPanelUser(collections, { username: rawUsername, password, role = ROLE_ACCOUNT }) {
  const username = normalizeUsername(rawUsername);
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('Usuario inválido. Usa 3 a 32 caracteres: letras, números, punto, guion o guion bajo.');
  }
  const passwordError = validatePassword(password);
  if (passwordError) throw new Error(passwordError);
  const normalizedRole = role === ROLE_OWNER ? ROLE_OWNER : ROLE_ACCOUNT;
  if (normalizedRole === ROLE_ACCOUNT) await assertUserCapacity(collections);
  const doc = {
    username,
    password: hashPassword(password),
    role: normalizedRole,
    disabled: false,
    sessionVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const result = await collections.users.insertOne(doc);
  // La cuenta de WhatsApp del usuario se crea la primera vez que entra a su panel.
  return { ...doc, _id: result.insertedId };
}

// Cambia la contraseña e invalida todas las sesiones abiertas del usuario.
export async function setUserPassword(collections, filter, password) {
  const passwordError = validatePassword(password);
  if (passwordError) throw Object.assign(new Error(passwordError), { status: 400 });
  return collections.users.findOneAndUpdate(
    filter,
    {
      $set: { password: hashPassword(password), updatedAt: new Date() },
      $inc: { sessionVersion: 1 },
    },
    { returnDocument: 'after' },
  );
}

async function sessionUser(collections, req) {
  const token = parseCookies(req.headers.cookie)[sessionCookieName()];
  const session = verifySessionCookie(token);
  if (!session) return null;
  const user = await collections.users.findOne({ _id: new ObjectId(session.uid) });
  if (!user || user.username !== session.username || user.disabled) return null;
  if (Number(user.sessionVersion || 0) !== Number(session.sv || 0)) return null;
  return user;
}

function publicUser(user) {
  return { username: user.username, role: user.role || ROLE_ACCOUNT, home: homePathFor(user.role) };
}

// Generate a CSRF token and set it as a non-HttpOnly cookie so the frontend JS can read it
function ensureCsrfCookie(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[CSRF_COOKIE]) return;
  const token = crypto.randomBytes(32).toString('hex');
  const parts = [  
    `${CSRF_COOKIE}=${token}`,
    'Path=/',
    'SameSite=Lax',
  ];
  if (isSecureCookie()) parts.push('Secure');
  parts.push(`Max-Age=${SESSION_DAYS * 24 * 60 * 60}`);
  // Append to existing Set-Cookie headers instead of overwriting
  const existing = res.getHeader('Set-Cookie');
  const all = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  all.push(parts.join('; '));
  res.setHeader('Set-Cookie', all);
}

function validateCsrf(req) {
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[CSRF_COOKIE];
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken) return false;
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createAuthRouter({ collections }) {
  return async function authRouter(req, res, next) {
    if (!req.path.startsWith('/api/auth')) return next();
    try {
      if (req.method === 'GET' && req.path === '/api/auth/status') {
        const [total, user, settings] = await Promise.all([
          collections.users.countDocuments(),
          sessionUser(collections, req),
          getSystemSettings(collections),
        ]);
        ensureCsrfCookie(req, res);
        return res.json({
          authenticated: !!user,
          user: user ? publicUser(user) : null,
          needsSetup: total === 0,
          registrationOpen: total === 0 || settings.publicRegistration,
        });
      }
      if (req.method === 'POST' && req.path === '/api/auth/register') {
        const total = await collections.users.countDocuments();
        const { publicRegistration } = await getSystemSettings(collections);
        if (total > 0 && !publicRegistration) {
          return res.status(403).json({ error: 'El registro público está cerrado. Pide tu cuenta al administrador.' });
        }
        // El primer usuario del sistema es el administrador; los siguientes son usuarios normales.
        const user = await createPanelUser(collections, {
          username: normalizeUsername(req.body?.username),
          password: String(req.body?.password || ''),
          role: total === 0 ? ROLE_OWNER : ROLE_ACCOUNT,
        });
        setSessionCookie(res, createSessionCookie(user));
        return res.json({ ok: true, user: publicUser(user) });
      }
      if (req.method === 'POST' && req.path === '/api/auth/login') {
        const username = normalizeUsername(req.body?.username);
        const password = String(req.body?.password || '');
        const user = await collections.users.findOne({ username });
        if (!user || !verifyPassword(password, user)) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
        if (user.disabled) return res.status(403).json({ error: 'Tu cuenta está suspendida. Contacta al administrador.' });
        setSessionCookie(res, createSessionCookie(user));
        await collections.users.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
        return res.json({ ok: true, user: publicUser(user) });
      }
      if (req.method === 'POST' && req.path === '/api/auth/logout') {
        clearSessionCookie(res);
        return res.json({ ok: true });
      }
      return res.status(404).json({ error: 'Ruta auth no encontrada' });
    } catch (err) {
      if (err?.code === 11000) return res.status(409).json({ error: 'Ese usuario ya existe.' });
      return res.status(err?.status || 400).json({ error: err.message || 'Error de autenticación' });
    }
  };
}

export function requirePanelAuth({ collections }) {
  return async function panelAuth(req, res, next) {
    try {
      if (['/login', '/login.html', '/register', '/register.html'].includes(req.path)) {
        return next();
      }
      const enabled = String(process.env.PANEL_AUTH_ENABLED || 'true').toLowerCase() !== 'false';
      if (!enabled) return next();
      const user = await sessionUser(collections, req);
      if (user) {
        req.panelUser = {
          uid: String(user._id),
          username: user.username,
          role: user.role || ROLE_ACCOUNT,
          permissions: normalizePermissions(user.permissions),
          preferences: normalizePreferences(user.preferences),
        };
        // CSRF validation for all state-changing requests
        const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
        if (mutatingMethods.includes(req.method) && req.path.startsWith('/api/')) {
          if (!validateCsrf(req)) {
            return res.status(403).json({ error: 'Token CSRF inválido o faltante.' });
          }
        }
        ensureCsrfCookie(req, res);
        return next();
      }
      const total = await collections.users.countDocuments().catch(() => 1);
      const target = total === 0 ? '/register.html' : '/login.html';
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sesión requerida', needsSetup: total === 0 });
      const wantsHtml = req.method === 'GET' && !req.path.includes('.');
      if (wantsHtml || req.accepts('html')) return res.redirect(target);
      return res.status(401).json({ error: 'Sesión requerida', needsSetup: total === 0 });
    } catch (err) {
      return next(err);
    }
  };
}

// Cada rol ve solo su propio panel: el administrador no tiene panel de WhatsApp
// y los usuarios no tienen acceso al panel de administración.
export function routePagesByRole(req, res, next) {
  const role = req.panelUser?.role;
  if (!role || req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  if (role === ROLE_OWNER && USER_PAGES.has(req.path)) return res.redirect('/admin.html');
  if (role !== ROLE_OWNER && ADMIN_PAGES.has(req.path)) return res.redirect('/');
  // Páginas que el administrador no permite a este usuario.
  const page = PAGE_PERMISSIONS[req.path];
  if (role !== ROLE_OWNER && page && !req.panelUser.permissions?.pages[page]) return res.redirect('/');
  // /grupos.html sirve la vista (clásica o moderna) que el usuario eligió.
  if (role !== ROLE_OWNER && GROUPS_PAGES.has(req.path)) {
    req.url = req.panelUser.preferences?.groupsView === 'modern' ? '/grupos-moderno.html' : '/grupos.html';
  }
  return next();
}

export function requirePanelOwner(req, res, next) {
  if (req.panelUser?.role === ROLE_OWNER) return next();
  return res.status(403).json({ error: 'Acceso exclusivo para el administrador del panel.' });
}

export function requireAccountUser(req, res, next) {
  if (req.panelUser && req.panelUser.role !== ROLE_OWNER) return next();
  return res.status(403).json({ error: 'El administrador no tiene una cuenta de WhatsApp. Usa el panel de administración.' });
}
