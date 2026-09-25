const IbotApi = (() => {
  // Extract a cookie value by name from document.cookie
  function getCookie(name) {
    const match = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
  }
  async function request(url, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    // Inject CSRF token for all state-changing requests (Double Submit Cookie pattern)
    const method = (opts.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      const csrf = getCookie('ibot_csrf_token');
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...opts,
      headers,
    });
    if (res.status === 401) {
      const text = await res.text().catch(() => '');
      try {
        const data = text ? JSON.parse(text) : null;
        location.href = data?.needsSetup ? '/register.html' : '/login.html';
      } catch { location.href = '/login.html'; }
      throw new Error('Sesión requerida');
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new Error(data?.error || data?.message || res.statusText);
    return data;
  }
  async function requestBlob(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (res.status === 401) {
      location.href = '/login.html';
      throw new Error('Sesión requerida');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let message = res.statusText;
      try {
        const data = text ? JSON.parse(text) : null;
        message = data?.error || data?.message || message;
      } catch {
        if (text) message = text;
      }
      throw new Error(message || 'No se pudo descargar el archivo.');
    }
    return res.blob();
  }
  const api = (path = '') => `/api/bot${path}`;
  const queryString = (params = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    }
    const serialized = query.toString();
    return serialized ? `?${serialized}` : '';
  };
  return {
    request, api,
    authStatus: () => request('/api/auth/status'),
    logoutPanel: () => request('/api/auth/logout', { method: 'POST' }),
    bot: () => request('/api/bot'),
    status: () => request(api('/status')),
    start: () => request(api('/start'), { method: 'POST' }),
    stop: () => request(api('/stop'), { method: 'POST' }),
    logout: () => request(api('/logout'), { method: 'POST' }),
    config: () => request(api('/config')),
    saveConfig: (body) => request(api('/config'), { method: 'PUT', body: JSON.stringify(body) }),
    testConnNotification: (body) => request(api('/config/conn-notification/test'), { method: 'POST', body: JSON.stringify(body) }),
    saveOrder: (body) => request(api('/config/order'), { method: 'PUT', body: JSON.stringify(body) }),
    toggleRespuestas: () => request(api('/respuestas/toggle'), { method: 'POST' }),
    iaProviders: () => request(api('/ia/providers')),
    resetIaMemory: () => request(api('/ia/reset-memory'), { method: 'POST' }),
    groups: () => request(api('/grupos')),
    categories: () => request(api('/grupos/categories')),
    createGroup: (body) => request(api('/grupos'), { method: 'POST', body: JSON.stringify(body) }),
    updateGroup: (id, body) => request(api(`/grupos/${encodeURIComponent(id)}`), { method: 'PUT', body: JSON.stringify(body) }),
    deleteGroup: (id) => request(api(`/grupos/${encodeURIComponent(id)}`), { method: 'DELETE' }),
    resetGroup: (id) => request(api(`/grupos/${encodeURIComponent(id)}/reset-contador`), { method: 'POST' }),
    toggleGroupCommands: (id) => request(api(`/grupos/${encodeURIComponent(id)}/commands/toggle`), { method: 'PUT' }),
    toggleIndependent: () => request(api('/grupos/toggle_independent'), { method: 'POST' }),
    logs: (params = '') => request(api(`/logs/console${params}`)),
    clearLogs: () => request(api('/logs/console'), { method: 'DELETE' }),
    chatGroups: (q = '') => request(api(`/chats/groups${q ? `?q=${encodeURIComponent(q)}` : ''}`)),
    chatMessages: (groupId) => request(api(`/chats/groups/${encodeURIComponent(groupId)}/messages?limit=300`)),
    chatInfo: (groupId) => request(api(`/chats/groups/${encodeURIComponent(groupId)}/info`)),
    directory: (params = {}, opts = {}) => request(api(`/directory${queryString(params)}`), opts),
    directoryExport: (params = {}) => requestBlob(api(`/directory/export.csv${queryString(params)}`)),
    scheduledMessages: (limit = 30) => request(api(`/scheduled-messages?limit=${encodeURIComponent(limit)}`)),
    scheduleMessage: (body) => request(api('/scheduled-messages'), { method: 'POST', body: JSON.stringify(body) }),
    cancelScheduledMessage: (id) => request(api(`/scheduled-messages/${encodeURIComponent(id)}`), { method: 'DELETE' }),
  };
})();
function $(s, root = document) { return root.querySelector(s); }
// Función global compartida por las páginas cargadas después de api.js.
// eslint-disable-next-line no-unused-vars
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function create(tag, props = {}) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') el.className = value;
    else if (key === 'innerHTML') el.innerHTML = value;
    else if (key === 'textContent' || key === 'innerText') el.textContent = value;
    else if (key === 'style') el.setAttribute('style', value);
    else el[key] = value;
  }
  return el;
}
// Función global compartida por las páginas cargadas después de api.js.
// eslint-disable-next-line no-unused-vars
function toast(msg) {
  const t = $('#toast') || document.body.appendChild(create('div', { id: 'toast', className: 'toast' }));
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}
// eslint-disable-next-line no-unused-vars
async function loadUserBot() {
  return IbotApi.bot();
}
// Cambios en tiempo real (estado del WhatsApp y grupos). EventSource se
// reconecta solo si se corta la conexión.
// eslint-disable-next-line no-unused-vars
function subscribeLive(onData) {
  if (typeof EventSource !== 'function') return null;
  const source = new EventSource(IbotApi.api('/events/live'), { withCredentials: true });
  source.addEventListener('live', (event) => {
    try { onData(JSON.parse(event.data)); } catch (err) { console.error('[live]', err); }
  });
  return source;
}
// eslint-disable-next-line no-unused-vars
function bindPanelLogout() {
  const btn = document.getElementById('panelLogoutBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    await IbotApi.logoutPanel().catch(() => null);
    location.href = '/login.html';
  });
}
