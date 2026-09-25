process.env.UV_THREADPOOL_SIZE = '64';
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, closeDB, getCollections, ensureIndexes } from './src/db/mongo.js';
import { RuntimeRegistry } from './src/core/runtime-registry.js';
import { createMainRouter } from './src/routes/main.routes.js';
import { createAuthRouter, requirePanelAuth } from './src/routes/auth.middleware.js';
import { createAdminRouter } from './src/routes/admin.routes.js';
import rateLimit from 'express-rate-limit';
import { MessageScheduler } from './src/services/message-scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT || 4310);
const publicDir = path.join(__dirname, 'public');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
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
const registry = new RuntimeRegistry({ collections });
const scheduler = new MessageScheduler({ collections, registry });
scheduler.start();

app.use('/css', express.static(path.join(publicDir, 'css')));
app.get('/js/auth.js', (req, res) => res.sendFile(path.join(publicDir, 'js', 'auth.js')));
app.use(createAuthRouter({ collections }));
app.get('/login.html', (req, res) => res.sendFile(path.join(publicDir, 'login.html')));
app.get('/register.html', (req, res) => res.sendFile(path.join(publicDir, 'register.html')));

app.use(requirePanelAuth({ collections }));
app.use(express.static(publicDir, { extensions: ['html'] }));
app.use(createAdminRouter({ collections, registry }));
app.use(createMainRouter({ collections, registry, scheduler }));

app.get('/*splat', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const server = app.listen(port, async () => {
  console.log(`Ibot v2 listo en http://localhost:${port}`);
  console.log(`Base MongoDB: ${process.env.MONGODB_DB || 'Ibotv2'} | Un bot por usuario`);
  
  const userAccounts = await collections.accounts
    .find({ userId: { $type: 'string' } })
    .sort({ userId: 1, createdAt: 1 })
    .toArray();
  const canonicalByUser = new Map();
  for (const account of userAccounts) {
    if (!canonicalByUser.has(account.userId)) canonicalByUser.set(account.userId, account);
  }
  const canonicalAccounts = [...canonicalByUser.values()];
  for (const account of canonicalAccounts) {
    const config = await collections.configs.findOne({ accountId: account.accountId });
    if (config?.activo !== true) continue;
    console.log(`[Auto-start] Iniciando bot: ${account.accountId}`);
    registry.start(account.accountId).catch(err => {
        console.error(`Error auto-arrancando el bot ${account.accountId}:`, err.message);
    });
  }
});

async function shutdown(signal) {
  console.log(`Recibido ${signal}. Cerrando Ibot v2...`);
  server.close(async () => {
    scheduler.stop();
    await registry.stopAll('server_shutdown');
    await closeDB();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));
