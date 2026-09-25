import crypto from 'crypto';
import fs from 'fs';

// Secreto del panel para firmar sesiones y cifrar datos sensibles:
// 1. Variable de entorno (producción)
// 2. Archivo local src/routes/panel_secret.txt (despliegue)
// 3. Clave aleatoria efímera (solo desarrollo; se avisa en consola)
let cachedSecret = null;
export function panelSecret() {
  if (cachedSecret) return cachedSecret;
  if (process.env.PANEL_SECRET) {
    cachedSecret = process.env.PANEL_SECRET;
    return cachedSecret;
  }
  if (process.env.PANEL_PASSWORD) {
    cachedSecret = process.env.PANEL_PASSWORD;
    return cachedSecret;
  }
  try {
    const filePath = new URL('../routes/panel_secret.txt', import.meta.url);
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (content) {
      cachedSecret = content;
      return cachedSecret;
    }
  } catch { /* file not found, continue */ }
  console.warn('[SECURITY] Generating ephemeral HMAC secret. Sessions will NOT survive restarts. Set PANEL_SECRET env var for production.');
  cachedSecret = crypto.randomBytes(32).toString('hex');
  return cachedSecret;
}

const PREFIX = 'enc:v1:';

function encryptionKey() {
  return crypto.createHash('sha256').update(`ibot-secret-box:${panelSecret()}`).digest();
}

// Cifra un valor sensible (por ejemplo una API key) con AES-256-GCM.
export function encryptSecret(plain) {
  const value = String(plain || '');
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}

// Descifra un valor; los valores antiguos guardados sin cifrar se devuelven tal cual.
export function decryptSecret(stored) {
  const value = String(stored || '');
  if (!value.startsWith(PREFIX)) return value;
  try {
    const [iv, tag, data] = value.slice(PREFIX.length).split('.').map((part) => Buffer.from(part, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
