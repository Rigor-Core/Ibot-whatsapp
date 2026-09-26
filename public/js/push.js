// Notificaciones push (Web Push estándar) del panel del usuario.
(() => {
  const card = document.getElementById('pushCard');
  if (!card) return;

  const statusEl = $('#pushStatus');
  const prefsEl = $('#pushPrefs');
  const toggleBtn = $('#pushToggle');
  const testBtn = $('#pushTest');
  const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let info = null;
  let subscription = null;

  function keyToBytes(base64) {
    const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(window.atob(padded), (char) => char.charCodeAt(0));
  }

  function unavailableReason() {
    if (!window.isSecureContext) return 'Las notificaciones necesitan que el panel se abra por HTTPS.';
    if (isIos && !installed) return 'En iPhone: toca Compartir → "Agregar a pantalla de inicio", abre Ibot desde ese ícono y activa aquí las notificaciones.';
    if (!supported) return 'Este navegador no admite notificaciones push.';
    if (Notification.permission === 'denied') return 'Bloqueaste las notificaciones para este sitio. Permítelas en los ajustes del navegador y vuelve a intentarlo.';
    return '';
  }

  function render() {
    const reason = unavailableReason();
    const active = !!subscription && !!info?.subscribed;
    statusEl.textContent = reason || (active
      ? '✅ Este dispositivo recibe notificaciones. Elige cuáles quieres:'
      : 'Este dispositivo no recibe notificaciones todavía.');
    toggleBtn.hidden = !!reason;
    toggleBtn.textContent = active ? 'Desactivar en este dispositivo' : 'Activar en este dispositivo';
    testBtn.hidden = !active;

    if (!info) return;
    // Alertas agrupadas por tema; cada interruptor se guarda al instante.
    prefsEl.innerHTML = Object.entries(info.groups).map(([title, types]) => `
      <div class="push-group">
        <div class="section-label">${escapeHtml(title)}</div>
        <div class="toggles">${types.map((type) => `
          <label class="toggle-row"><span class="text">${escapeHtml(info.types[type])}</span>
            <span class="switch"><input type="checkbox" data-type="${type}" ${info.preferences[type] ? 'checked' : ''}><span></span></span>
          </label>`).join('')}</div>
      </div>`).join('');
    $('#pushKeywords').value = (info.preferences.keywords || []).join(', ');
  }

  async function refresh() {
    const registration = supported ? await navigator.serviceWorker.getRegistration('/') : null;
    subscription = registration ? await registration.pushManager.getSubscription() : null;
    const query = subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : '';
    info = await IbotApi.request(IbotApi.api(`/push${query}`));
    render();
  }

  async function enable() {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      render();
      return;
    }
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    subscription = await registration.pushManager.getSubscription()
      || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(info.publicKey) });
    await IbotApi.request(IbotApi.api('/push/subscribe'), { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) });
    toast('🔔 Notificaciones activadas en este dispositivo');
  }

  async function disable() {
    if (subscription) {
      await IbotApi.request(IbotApi.api('/push/unsubscribe'), { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }) });
      await subscription.unsubscribe().catch(() => null);
    }
    toast('Notificaciones desactivadas en este dispositivo');
  }

  toggleBtn.addEventListener('click', async () => {
    toggleBtn.disabled = true;
    try {
      if (subscription && info?.subscribed) await disable();
      else await enable();
      await refresh();
    } catch (err) {
      toast(`❌ ${err.message}`);
    } finally {
      toggleBtn.disabled = false;
    }
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    try {
      await IbotApi.request(IbotApi.api('/push/test'), { method: 'POST' });
      toast('Notificación de prueba enviada');
    } catch (err) {
      toast(`❌ ${err.message}`);
    } finally {
      testBtn.disabled = false;
    }
  });

  // Cada casilla se guarda al instante, sin botón de guardar.
  prefsEl.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-type]');
    if (!input) return;
    try {
      const saved = await IbotApi.saveConfig({ notifications: { [input.dataset.type]: input.checked } });
      info.preferences = saved.notifications;
      toast(input.checked ? '🔔 Alerta activada' : '🔕 Alerta desactivada');
    } catch (err) {
      input.checked = !input.checked;
      toast(`❌ ${err.message}`);
    }
  });

  $('#pushKeywordsSave').addEventListener('click', async () => {
    const keywords = $('#pushKeywords').value.split(',').map((word) => word.trim()).filter(Boolean);
    try {
      const saved = await IbotApi.saveConfig({ notifications: { keywords } });
      info.preferences = saved.notifications;
      $('#pushKeywords').value = saved.notifications.keywords.join(', ');
      toast(saved.notifications.keywords.length ? '🔔 Palabras clave guardadas' : 'Sin palabras clave');
    } catch (err) {
      toast(`❌ ${err.message}`);
    }
  });

  refresh().catch((err) => { statusEl.textContent = `No se pudo comprobar las notificaciones: ${err.message}`; });
})();
