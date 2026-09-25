/* ─── Estado del panel ──────────────────────────────────────────────── */
let adminData = null;       // último snapshot de datos
let autoRefreshTimer = null;
let pwdTargetUsername = null;

/* ─── Utilidades de formato ─────────────────────────────────────────── */
function fmtDate(value) {
  if (!value) return 'Nunca';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'Nunca' : d.toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('es');
}

function userInitial(username) {
  return String(username || '?')[0].toUpperCase();
}

/* ─── Modal contraseña ──────────────────────────────────────────────── */
function openPwdModal(username) {
  pwdTargetUsername = username;
  document.getElementById('pwdModalSub').textContent = `Cambiar contraseña de la cuenta "${username}".`;
  document.getElementById('newPwdInput').value = '';
  document.getElementById('confirmPwdInput').value = '';
  document.getElementById('pwdModalError').textContent = '';
  document.getElementById('pwdModal').classList.add('show');
  document.getElementById('newPwdInput').focus();
}

function closePwdModal() {
  pwdTargetUsername = null;
  document.getElementById('pwdModal').classList.remove('show');
}

async function savePwd() {
  const pwd = document.getElementById('newPwdInput').value;
  const confirm = document.getElementById('confirmPwdInput').value;
  const errEl = document.getElementById('pwdModalError');
  errEl.textContent = '';

  if (pwd.length < 12) { errEl.textContent = 'Mínimo 12 caracteres.'; return; }
  if (!/[A-Z]/.test(pwd) || !/[a-z]/.test(pwd) || !/\d/.test(pwd)) {
    errEl.textContent = 'Debe incluir mayúsculas, minúsculas y números.';
    return;
  }
  if (pwd !== confirm) { errEl.textContent = 'Las contraseñas no coinciden.'; return; }

  const btn = document.getElementById('pwdModalSave');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    await IbotApi.resetAccountPassword(pwdTargetUsername, pwd);
    closePwdModal();
    toast('✓ Contraseña actualizada');
  } catch (err) {
    errEl.textContent = err.message || 'Error al cambiar la contraseña.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

/* ─── Acciones sobre cuentas ────────────────────────────────────────── */
async function controlAccount(accountId, action, btn) {
  const labels = { start: 'Iniciando…', stop: 'Apagando…', logout: 'Desconectando…' };
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = labels[action] || '…';
  try {
    await IbotApi.controlAccount(accountId, action);
    toast('✓ Acción ejecutada');
    await refreshData();
  } catch (err) {
    toast('✗ ' + (err.message || 'Error'));
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

async function deleteAccount(username) {
  if (!confirm(`⚠️ ¿Eliminar la cuenta "${username}"?\nSe borrarán todos sus datos: grupos, contactos, mensajes y sesión de WhatsApp. Esta acción no se puede deshacer.`)) return;
  try {
    await IbotApi.deleteAccount(username);
    toast('✓ Cuenta eliminada');
    await refreshData();
  } catch (err) {
    toast('✗ ' + (err.message || 'No se pudo eliminar'));
  }
}

/* ─── Renderizado ───────────────────────────────────────────────────── */
function statusBadge(status) {
  const map = {
    connected: ['badge-connected', '●', 'Conectado'],
    stopped:   ['badge-stopped',   '●', 'Apagado'],
    error:     ['badge-error',     '●', 'Error'],
    logged_out:['badge-logged_out','●', 'Desconectado'],
  };
  const [cls, dot, label] = map[status] || ['badge-neutral', '●', escapeHtml(status || 'Sin datos')];
  return `<span class="badge ${cls}"><span class="badge-dot"></span>${label}</span>`;
}

function modeBadge(mode) {
  const labels = { normal: 'Normal', watch: 'Observador', ia: 'IA' };
  return `<span class="badge badge-mode">Modo ${escapeHtml(labels[mode] || mode)}</span>`;
}

function renderAccountCard(row) {
  const { username, role, createdAt, lastLoginAt, account } = row;
  const isOwner = role === 'owner';

  const card = document.createElement('article');
  card.className = `account-card${isOwner ? ' is-owner' : ''}`;
  card.dataset.username = username;

  // Header
  const header = `
    <div class="ac-header">
      <div class="ac-avatar">${escapeHtml(userInitial(username))}</div>
      <div class="ac-info">
        <div class="ac-name">${escapeHtml(username)}</div>
        <div class="ac-sub">${account?.phoneName ? escapeHtml(account.phoneName) : (account ? 'WhatsApp sin vincular' : 'Sin cuenta de bot')}</div>
      </div>
    </div>`;

  // Badges de estado
  let badges = '';
  if (account) {
    badges = `<div class="ac-status-row">
      ${statusBadge(account.status)}
      ${modeBadge(account.mode)}
      ${account.active ? '<span class="badge badge-connected">Bot Activo</span>' : '<span class="badge badge-stopped">Bot Inactivo</span>'}
      ${account.respuestas ? '<span class="badge badge-mode">Respuestas ON</span>' : ''}
    </div>`;
  }

  // Métricas
  let metrics = '';
  if (account) {
    metrics = `
      <div class="ac-metrics">
        <div class="ac-metric"><div class="ac-metric-val">${fmtNum(account.groups)}</div><div class="ac-metric-lbl">Grupos</div></div>
        <div class="ac-metric"><div class="ac-metric-val">${fmtNum(account.contacts)}</div><div class="ac-metric-lbl">Contactos</div></div>
        <div class="ac-metric"><div class="ac-metric-val">${fmtNum(account.messages)}</div><div class="ac-metric-lbl">Mensajes</div></div>
        <div class="ac-metric"><div class="ac-metric-val">${fmtNum(account.scheduled)}</div><div class="ac-metric-lbl">Programados</div></div>
      </div>`;
  }

  // Acciones
  let actions = '<div class="ac-actions">';
  if (account) {
    if (account.status === 'connected') {
      actions += `<button class="ac-btn ac-btn-stop" data-action="stop" data-id="${escapeHtml(account.accountId)}">⏹ Apagar</button>`;
    } else {
      actions += `<button class="ac-btn ac-btn-start" data-action="start" data-id="${escapeHtml(account.accountId)}">▶ Encender</button>`;
    }
    actions += `<button class="ac-btn ac-btn-logout" data-action="logout" data-id="${escapeHtml(account.accountId)}">⊙ Cerrar WA</button>`;
  }
  actions += `<button class="ac-btn ac-btn-pwd" data-action="pwd" data-user="${escapeHtml(username)}">🔑 Contraseña</button>`;
  if (!isOwner) {
    actions += `<button class="ac-btn ac-btn-delete" data-action="delete" data-user="${escapeHtml(username)}">🗑 Eliminar</button>`;
  }
  actions += '</div>';

  const footer = `<div class="last-login">
    Miembro desde ${fmtDate(createdAt)} · Último acceso: ${fmtDate(lastLoginAt)}
  </div>`;

  card.innerHTML = `
    ${header}
    ${badges}
    ${metrics ? `<div class="ac-divider"></div>${metrics}` : ''}
    <div class="ac-divider"></div>
    ${actions}
    ${footer}
  `;

  // Eventos
  card.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'pwd') { openPwdModal(btn.dataset.user); return; }
      if (action === 'delete') { deleteAccount(btn.dataset.user); return; }
      controlAccount(btn.dataset.id, action, btn);
    });
  });

  return card;
}

function renderKpis(summary) {
  return `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-icon">👥</div>
        <div class="kpi-label">Cuentas</div>
        <div class="kpi-value">${fmtNum(summary.users)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon">🟢</div>
        <div class="kpi-label">Conectadas</div>
        <div class="kpi-value green">${fmtNum(summary.connected)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon">💬</div>
        <div class="kpi-label">Grupos configurados</div>
        <div class="kpi-value accent">${fmtNum(summary.configuredGroups)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon">📨</div>
        <div class="kpi-label">Mensajes observados</div>
        <div class="kpi-value">${fmtNum(summary.observedMessages)}</div>
      </div>
    </div>`;
}

function renderSidePanel(summary) {
  return `
    <div class="panel side-panel">
      <div class="side-panel-title">📊 Resumen del sistema</div>
      <div class="side-panel-sub">Estado actual de todos los bots gestionados.</div>

      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:rgba(255,255,255,.03);border:1px solid var(--border-soft);border-radius:10px;">
          <span style="font-size:13px;color:var(--muted);">Total cuentas</span>
          <span style="font-weight:800;color:#fff;">${fmtNum(summary.users)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:rgba(57,255,20,.04);border:1px solid rgba(57,255,20,.15);border-radius:10px;">
          <span style="font-size:13px;color:var(--muted);">Conectadas</span>
          <span style="font-weight:800;color:#39ff14;">${fmtNum(summary.connected)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:rgba(255,255,255,.03);border:1px solid var(--border-soft);border-radius:10px;">
          <span style="font-size:13px;color:var(--muted);">Grupos totales</span>
          <span style="font-weight:800;color:var(--accent);">${fmtNum(summary.configuredGroups)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:rgba(255,255,255,.03);border:1px solid var(--border-soft);border-radius:10px;">
          <span style="font-size:13px;color:var(--muted);">Mensajes procesados</span>
          <span style="font-weight:800;color:#fff;">${fmtNum(summary.observedMessages)}</span>
        </div>
      </div>

      <div class="side-panel-title" style="margin-top:4px;">⚡ Acciones rápidas</div>
      <div class="side-panel-sub">Navega al panel de control del bot.</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <a href="/" class="btn util full" style="text-decoration:none;text-align:center;">🤖 Panel del Bot</a>
        <a href="/grupos.html" class="btn util full" style="text-decoration:none;text-align:center;">👥 Configurar Grupos</a>
        <a href="/configuracion.html" class="btn util full" style="text-decoration:none;text-align:center;">⚙️ Configuración</a>
        <a href="/logs.html" class="btn util full" style="text-decoration:none;text-align:center;">📜 Ver Logs</a>
      </div>
    </div>`;
}

function renderAdmin(data) {
  const { summary, users } = data;
  const app = document.getElementById('adminApp');

  // KPIs
  const kpiHtml = renderKpis(summary);

  // Toolbar
  const toolbar = `
    <div class="list-toolbar">
      <div>
        <div class="list-toolbar-title">Bots registrados</div>
        <div class="list-toolbar-sub">Cada bot gestiona una única cuenta de WhatsApp</div>
      </div>
      <button id="refreshBtn" class="refresh-btn" title="Actualizar">
        <svg id="refreshIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"></polyline>
          <polyline points="1 20 1 14 7 14"></polyline>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
        Actualizar
      </button>
    </div>`;

  // Account list
  const listEl = document.createElement('section');
  listEl.className = 'account-list';
  if (users.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🤖</div><div>No hay bots registrados aún.</div></div>`;
  } else {
    for (const row of users) listEl.appendChild(renderAccountCard(row));
  }

  // Columna izquierda
  const leftCol = document.createElement('div');
  leftCol.innerHTML = toolbar;
  leftCol.appendChild(listEl);

  // Columna derecha
  const rightCol = document.createElement('div');
  rightCol.innerHTML = renderSidePanel(summary);

  // Layout
  const layout = document.createElement('div');
  layout.className = 'admin-layout';
  layout.appendChild(leftCol);
  layout.appendChild(rightCol);

  // Montar en app
  app.innerHTML = kpiHtml;
  app.appendChild(layout);

  // Evento refresh
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    const btnEl = document.getElementById('refreshBtn');
    btnEl.classList.add('spinning');
    btnEl.disabled = true;
    await refreshData();
    btnEl.classList.remove('spinning');
    btnEl.disabled = false;
  });
}

/* ─── Carga y refresh ───────────────────────────────────────────────── */
async function refreshData() {
  try {
    adminData = await IbotApi.adminOverview();
    renderAdmin(adminData);
  } catch (err) {
    toast('✗ Error al actualizar: ' + (err.message || ''));
  }
}

function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  // Auto-refresh cada 30 segundos
  autoRefreshTimer = setInterval(() => {
    if (!document.hidden) refreshData();
  }, 30000);
}

/* ─── Modal events ──────────────────────────────────────────────────── */
function bindModalEvents() {
  document.getElementById('pwdModalCancel').addEventListener('click', closePwdModal);
  document.getElementById('pwdModalSave').addEventListener('click', savePwd);
  document.getElementById('pwdModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closePwdModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePwdModal();
    if (e.key === 'Enter' && document.getElementById('pwdModal').classList.contains('show')) savePwd();
  });
}

/* ─── Init ──────────────────────────────────────────────────────────── */
async function initAdmin() {
  bindPanelLogout();
  bindModalEvents();

  const status = await IbotApi.authStatus();
  if (status.user?.role !== 'owner') {
    document.getElementById('adminApp').innerHTML = `
      <div class="panel access-denied">
        <div class="title">🔒 Acceso restringido</div>
        <p>Esta sección está reservada exclusivamente para el propietario del panel.</p>
      </div>`;
    return;
  }

  await refreshData();
  startAutoRefresh();
}

initAdmin().catch((err) => {
  document.getElementById('adminApp').innerHTML = `
    <div class="panel access-denied">
      <div class="title">Error</div>
      <p>${escapeHtml(err.message || 'No se pudo cargar el panel.')}</p>
    </div>`;
});
