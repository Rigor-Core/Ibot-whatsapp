process.env.UV_THREADPOOL_SIZE = '64';
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, closeDB, getCollections, ensureIndexes } from './src/db/mongo.js';
import { runDataMigrations } from './src/db/migrations.js';
import { RuntimeRegistry } from './src/core/runtime-registry.js';
import { APP_VERSION } from './src/core/app-info.js';
import { createMainRouter } from './src/routes/main.routes.js';
import { createAuthRouter, homePathFor, requirePanelAuth, routePagesByRole } from './src/routes/auth.middleware.js';
import { createAdminRouter } from './src/routes/admin.routes.js';
import rateLimit from 'express-rate-limit';
import { MessageScheduler } from './src/services/message-scheduler.js';
import { PushService } from './src/services/push-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT || 4310);
const publicDir = path.join(__dirname, 'public');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Límite general amplio: el panel consulta estado, logs y estadísticas de forma
// periódica. La protección contra fuerza bruta está en authLimiter.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500,
  message: { error: 'Demasiadas peticiones, por favor intenta más tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

// Stricter rate limiter for auth endpoints to prevent brute-force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Demasiados intentos de autenticación. Intenta en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/', apiLimiter);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    // Google Fonts styles are loaded via @import in styles.css
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    // WhatsApp profile pictures come from mmg/pps subdomains; data: for QR codes
    "img-src 'self' data: https://*.whatsapp.net https://mmg.whatsapp.net https://pps.whatsapp.net",
    // Google Fonts actual font files are served from gstatic
    "font-src 'self' https://fonts.gstatic.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "connect-src 'self'",
  ].join('; '));
  next();
});

const db = await connectDB();
await ensureIndexes(db);
const collections = getCollections(db);
await runDataMigrations(collections);
const registry = new RuntimeRegistry({ collections });
const scheduler = new MessageScheduler({ collections, registry });
scheduler.start();
const push = new PushService({ collections, eventBus: registry.eventBus });
await push.init();

app.get('/api/health', (req, res) => res.json({ ok: true, version: APP_VERSION }));
app.use('/css', express.static(path.join(publicDir, 'css')));
// Archivos de la app instalable y de las notificaciones: los navegadores los piden sin sesión.
app.use('/icons', express.static(path.join(publicDir, 'icons')));
app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json').sendFile(path.join(publicDir, 'manifest.webmanifest'));
});
app.get('/sw.js', (req, res) => res.sendFile(path.join(publicDir, 'sw.js')));
app.get('/js/auth.js', (req, res) => res.sendFile(path.join(publicDir, 'js', 'auth.js')));
app.use(createAuthRouter({ collections }));
app.get('/login.html', (req, res) => res.sendFile(path.join(publicDir, 'login.html')));
app.get('/register.html', (req, res) => res.sendFile(path.join(publicDir, 'register.html')));

app.use(requirePanelAuth({ collections }));
app.use(routePagesByRole);
// La antigua página de logs ahora es Chats.
app.get(['/logs', '/logs.html'], (req, res) => res.redirect(301, '/chats.html'));
app.use(express.static(publicDir, { extensions: ['html'] }));
app.use(createAdminRouter({ collections, registry, scheduler }));
app.use(createMainRouter({ collections, registry, scheduler, push }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

app.get('/*splat', (req, res) => {
  const home = homePathFor(req.panelUser?.role);
  if (home !== '/') return res.redirect(home);
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Errores no controlados: JSON para la API y una respuesta simple para páginas.
app.use((err, req, res, next) => {
  console.error(`[http] ${req.method} ${req.path}:`, err);
  const status = err.status || err.statusCode || 500;
  if (res.headersSent) return;
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message });
  res.status(status).send('Error interno del servidor');
});

const server = app.listen(port, () => {
  console.log(`Ibot v${APP_VERSION} listo en http://localhost:${port}`);
  console.log(`Base MongoDB: ${process.env.MONGODB_DB || 'Ibotv2'}`);
  registry.resumeActiveAccounts().catch((err) => {
    console.error('No se pudieron reanudar las cuentas activas:', err.message);
  });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Recibido ${signal}. Cerrando Ibot...`);
  setTimeout(() => process.exit(1), 10000).unref();
  // Las conexiones SSE (logs y chats en vivo) nunca terminan solas.
  server.close();
  server.closeAllConnections();
  scheduler.stop();
  await registry.stopAll('server_shutdown');
  await closeDB().catch(() => null);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));
