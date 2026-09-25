import webpush from 'web-push';
import { decryptSecret, encryptSecret } from '../core/secrets.js';

const VAPID_DOC_ID = 'vapid';
const MAX_SUBSCRIPTIONS_PER_ACCOUNT = 20;

// Alertas que cada usuario puede activar o desactivar.
export const NOTIFICATION_TYPES = Object.freeze({
  disconnected: 'WhatsApp desconectado o sesión cerrada',
  qr: 'Código QR pendiente de escanear',
  order: 'Pedido tomado por el repartidor',
  groupLimit: 'Grupo que llegó a su límite',
  scheduledFailed: 'Mensaje programado que falló',
});

const DEFAULT_PREFERENCES = Object.freeze({
  disconnected: true,
  qr: true,
  order: true,
  groupLimit: true,
  scheduledFailed: true,
});

export function normalizeNotificationPrefs(raw = {}) {
  return Object.fromEntries(Object.keys(NOTIFICATION_TYPES).map((type) => [
    type,
    typeof raw?.[type] === 'boolean' ? raw[type] : DEFAULT_PREFERENCES[type],
  ]));
}

function vapidSubject() {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  const base = String(process.env.PUBLIC_BASE_URL || '');
  return base.startsWith('https://') ? base : 'mailto:notificaciones@ibot.local';
}

function validSubscription(subscription) {
  const endpoint = String(subscription?.endpoint || '');
  const keys = subscription?.keys || {};
  if (!endpoint.startsWith('https://') || endpoint.length > 2000) return null;
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  return { endpoint, keys: { p256dh: keys.p256dh.slice(0, 200), auth: keys.auth.slice(0, 100) } };
}

// Notificaciones Web Push estándar (VAPID): llegan aunque el panel esté cerrado,
// sin depender de servicios de terceros como Firebase.
export class PushService {
  constructor({ collections, eventBus }) {
    this.collections = collections;
    this.eventBus = eventBus;
    this.publicKey = null;
  }

  async init() {
    let publicKey = process.env.VAPID_PUBLIC_KEY;
    let privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      const stored = await this.collections.settings.findOne({ _id: VAPID_DOC_ID });
      if (stored?.publicKey && stored?.privateKey) {
        publicKey = stored.publicKey;
        privateKey = decryptSecret(stored.privateKey);
      }
      if (!publicKey || !privateKey) {
        // Se generan una sola vez: si cambian, todas las suscripciones dejan de servir.
        ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
        await this.collections.settings.updateOne(
          { _id: VAPID_DOC_ID },
          { $set: { publicKey, privateKey: encryptSecret(privateKey), createdAt: new Date() } },
          { upsert: true },
        );
      }
    }
    webpush.setVapidDetails(vapidSubject(), publicKey, privateKey);
    this.publicKey = publicKey;
    this.eventBus.on('notify', (event) => {
      this.notify(event).catch((err) => console.error('[push] Error enviando notificación:', err.message));
    });
  }

  async preferences(accountId) {
    const config = await this.collections.configs.findOne({ accountId }, { projection: { notifications: 1 } });
    return normalizeNotificationPrefs(config?.notifications);
  }

  async subscribe(accountId, subscription, userAgent = '') {
    const valid = validSubscription(subscription);
    if (!valid) throw new Error('Suscripción de notificaciones inválida');
    await this.collections.pushSubscriptions.updateOne(
      { endpoint: valid.endpoint },
      {
        $set: { accountId, keys: valid.keys, userAgent: String(userAgent).slice(0, 300), updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    // Evita acumular dispositivos viejos: se conservan los más recientes.
    const extra = await this.collections.pushSubscriptions
      .find({ accountId }, { projection: { _id: 1 } })
      .sort({ updatedAt: -1 })
      .skip(MAX_SUBSCRIPTIONS_PER_ACCOUNT)
      .toArray();
    if (extra.length) await this.collections.pushSubscriptions.deleteMany({ _id: { $in: extra.map((doc) => doc._id) } });
  }

  async unsubscribe(accountId, endpoint) {
    await this.collections.pushSubscriptions.deleteOne({ accountId, endpoint: String(endpoint || '') });
  }

  async isSubscribed(accountId, endpoint) {
    if (!endpoint) return false;
    return !!(await this.collections.pushSubscriptions.findOne({ accountId, endpoint: String(endpoint) }));
  }

  async notify({ accountId, type, title, body, url = '/', tag, force = false }) {
    if (!this.publicKey || !accountId) return 0;
    if (!force && !(await this.preferences(accountId))[type]) return 0;
    const subscriptions = await this.collections.pushSubscriptions.find({ accountId }).toArray();
    const payload = JSON.stringify({ title, body, url, tag: tag || type });
    const urgency = type === 'order' || type === 'disconnected' ? 'high' : 'normal';
    let delivered = 0;
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          payload,
          { TTL: 3600, urgency },
        );
        delivered += 1;
      } catch (err) {
        // 404/410: el navegador canceló la suscripción; se elimina.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await this.collections.pushSubscriptions.deleteOne({ _id: subscription._id });
        } else {
          console.warn(`[push] Falló el envío a ${accountId}:`, err.statusCode || err.message);
        }
      }
    }));
    return delivered;
  }
}
