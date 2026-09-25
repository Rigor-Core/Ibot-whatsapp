import crypto from 'crypto';
import fs from 'fs';
import { ObjectId } from 'mongodb';
import { ensureUserAccount } from '../services/account-service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_DAYS = Number(process.env.PANEL_SESSION_DAYS || 7);
const ITERATIONS = 600000;
const KEYLEN = 32;
const DIGEST = 'sha256';
const CSRF_COOKIE = 'ibot_csrf_token';
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

// Resolve the HMAC signing secret following a secure multi-tier strategy:
// 1. Environment variable (production)
// 2. Local file (deployment)
// 3. Ephemeral random key (development only — logs a warning)
let _cachedSecret = null;
function panelSecret() {
  if (_cachedSecret) return _cachedSecret;
  if (process.env.PANEL_SECRET) {
    _cachedSecret = process.env.PANEL_SECRET;
    return _cachedSecret;
  }
  if (process.env.PANEL_PASSWORD) {
    _cachedSecret = process.env.PANEL_PASSWORD;
    return _cachedSecret;
  }
  try {
    const filePath = new URL('./panel_secret.txt', import.meta.url);
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (content) {
      _cachedSecret = content;
      return _cachedSecret;
    }
  } catch { /* file not found, continue */ }
  // TODO(security): In production, enforce a persistent secret via env var or KMS.
  console.warn('[SECURITY] Generating ephemeral HMAC secret. Sessions will NOT survive restarts. Set PANEL_SECRET env var for production.');
  _cachedSecret = crypto.randomBytes(32).toString('hex');
  return _cachedSecret;
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
  const payload = base64url(JSON.stringify({ uid: String(user._id), username: user.username, exp }));
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

export async function createPanelUser(collections, { username: rawUsername, password, role = 'account' }) {
  const username = normalizeUsername(rawUsername);
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('Usuario inválido. Usa 3 a 32 caracteres: letras, números, punto, guion o guion bajo.');
  }
  const passwordError = validatePassword(password);
  if (passwordError) throw new Error(passwordError);
  const normalizedRole = role === 'owner' ? 'owner' : 'account';
  const doc = {
    username,
    password: hashPassword(password),
    role: normalizedRole,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const result = await collections.users.insertOne(doc);
  const user = { ...doc, _id: result.insertedId };
  await ensureUserAccount(collections, user);
  return user;
}

async function sessionUser(collections, req) {
  const token = parseCookies(req.headers.cookie)[sessionCookieName()];
  const session = verifySessionCookie(token);
  if (!session) return null;
  const user = await collections.users.findOne({ _id: new ObjectId(session.uid) });
  if (!user || user.username !== session.username) return null;
  return user;
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
        const total = await collections.users.countDocuments();
        const user = await sessionUser(collections, req);
        ensureCsrfCookie(req, res);
        return res.json({ authenticated: !!user, user: user ? { username: user.username, role: user.role } : null, needsSetup: total === 0 });
      }
      if (req.method === 'POST' && req.path === '/api/auth/register') {
        const total = await collections.users.countDocuments();
        const publicRegistration = String(process.env.PANEL_ALLOW_PUBLIC_REGISTRATION || 'false').toLowerCase() === 'true';
        const currentUser = await sessionUser(collections, req);
        if (total > 0 && !publicRegistration && currentUser?.role !== 'owner') {
          return res.status(403).json({ error: 'El registro público está cerrado. Solo el propietario puede crear cuentas.' });
        }
        const username = normalizeUsername(req.body?.username);
        const password = String(req.body?.password || '');
        const user = await createPanelUser(collections, { username, password, role: total === 0 ? 'owner' : 'account' });
        if (total === 0) setSessionCookie(res, createSessionCookie(user));
        return res.json({ ok: true, user: { username: user.username, role: user.role } });
      }
      if (req.method === 'POST' && req.path === '/api/auth/login') {
        const username = normalizeUsername(req.body?.username);
        const password = String(req.body?.password || '');
        const user = await collections.users.findOne({ username });
        if (!user || !verifyPassword(password, user)) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
        if (user.role !== 'owner') return res.status(403).json({ error: 'Acceso denegado. Solo el administrador puede iniciar sesión.' });
        await ensureUserAccount(collections, user);
        setSessionCookie(res, createSessionCookie(user));
        await collections.users.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(), updatedAt: new Date() } });
        return res.json({ ok: true, user: { username: user.username, role: user.role } });
      }
      if (req.method === 'POST' && req.path === '/api/auth/logout') {
        clearSessionCookie(res);
        return res.json({ ok: true });
      }
      return res.status(404).json({ error: 'Ruta auth no encontrada' });
    } catch (err) {
      if (err?.code === 11000) return res.status(409).json({ error: 'Ese usuario ya existe.' });
      return res.status(500).json({ error: err.message || 'Error de autenticación' });
    }
  };
}

export function requirePanelAuth({ collections }) {
  return async function panelAuth(req, res, next) {
    if (['/login', '/login.html', '/register', '/register.html'].includes(req.path)) {
      return next();
    }
    const enabled = String(process.env.PANEL_AUTH_ENABLED || 'true').toLowerCase() !== 'false';
    if (!enabled) return next();
    const user = await sessionUser(collections, req);
    if (user) {
      req.panelUser = { uid: String(user._id), username: user.username, role: user.role || 'account' };
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
    const target = '/login.html';
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sesión requerida', needsSetup: total === 0 });
    const wantsHtml = req.method === 'GET' && !req.path.includes('.');
    if (wantsHtml || req.accepts('html')) return res.redirect(target);
    return res.status(401).json({ error: 'Sesión requerida', needsSetup: total === 0 });
  };
}

export function requirePanelOwner(req, res, next) {
  if (req.panelUser?.role === 'owner') return next();
  return res.status(403).json({ error: 'Acceso exclusivo para el propietario del panel.' });
}
