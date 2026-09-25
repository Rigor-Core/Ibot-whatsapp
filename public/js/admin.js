// Panel de administración: usuarios, conexiones de WhatsApp, estadísticas y ajustes.
(() => {
  const REFRESH_MS = 30000;
  const SECTIONS = ['resumen', 'usuarios', 'conexiones', 'configuracion', 'cuenta'];
  const STATUS = {
    connected: { label: 'Conectado', cls: 'good', color: 'var(--good)' },
    qr: { label: 'Esperando QR', cls: 'warning', color: 'var(--warning)' },
    starting: { label: 'Iniciando', cls: 'warning', color: 'var(--warning)' },
    connecting: { label: 'Conectando', cls: 'warning', color: 'var(--warning)' },
    reconnecting: { label: 'Reconectando', cls: 'serious', color: 'var(--serious)' },
    disconnected: { label: 'Desconectado', cls: 'serious', color: 'var(--serious)' },
    error: { label: 'Error', cls: 'critical', color: 'var(--critical)' },
    logged_out: { label: 'Sesión cerrada', cls: '', color: 'var(--muted)' },
    stopped: { label: 'Apagado', cls: '', color: 'var(--muted)' },
  };
  const SCHEDULED = {
    pending: { label: 'Pendientes', cls: 'warning', color: 'var(--warning)' },
    processing: { label: 'Enviando', cls: 'serious', color: 'var(--serious)' },
    sent: { label: 'Enviados', cls: 'good', color: 'var(--good)' },
    failed: { label: 'Fallidos', cls: 'critical', color: 'var(--critical)' },
    cancelled: { label: 'Cancelados', cls: '', color: 'var(--muted)' },
  };
  const MODES = { normal: 'Normal', watch: 'Watch', ia: 'IA' };
  const RUNNING = ['connected', 'connecting', 'qr', 'starting', 'reconnecting'];

  const api = {
    overview: () => IbotApi.request('/api/admin/overview'),
    stats: (days) => IbotApi.request(`/api/admin/stats?days=${encodeURIComponent(days)}`),
    system: () => IbotApi.request('/api/admin/system'),
    settings: () => IbotApi.request('/api/admin/settings'),
    saveSettings: (body) => IbotApi.request('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) }),
    createUser: (body) => IbotApi.request('/api/admin/users', { method: 'POST', body: JSON.stringify(body) }),
    deleteUser: (username) => IbotApi.request(`/api/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' }),
    setPassword: (username, password) => IbotApi.request(`/api/admin/users/${encodeURIComponent(username)}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
    setDisabled: (username, disabled) => IbotApi.request(`/api/admin/users/${encodeURIComponent(username)}/status`, { method: 'POST', body: JSON.stringify({ disabled }) }),
    assign: (accountId, username) => IbotApi.request(`/api/admin/accounts/${encodeURIComponent(accountId)}/assign`, { method: 'POST', body: JSON.stringify({ username }) }),
    control: (accountId, action) => IbotApi.request(`/api/admin/accounts/${encodeURIComponent(accountId)}/${action}`, { method: 'POST' }),
    myPassword: (body) => IbotApi.request('/api/admin/me/password', { method: 'PUT', body: JSON.stringify(body) }),
  };

  const state = {
    overview: null,
    stats: null,
    days: 14,
    section: 'resumen',
    loading: false,
    passwordTarget: null,
    assignTarget: null,
  };

  const dateFormat = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeFormat = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' });
  const relativeFormat = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

  // ─── Utilidades de formato ───────────────────────────────────────────
  function formatDate(value) {
    return value ? dateFormat.format(new Date(value)) : '—';
  }

  function formatRelative(value) {
    if (!value) return 'Nunca';
    const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
    const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, size] of units) {
      if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
    }
    return 'Hace un momento';
  }

  function formatDuration(totalSeconds) {
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (days) return `${days} d ${hours} h`;
    if (hours) return `${hours} h ${minutes} min`;
    return `${minutes} min`;
  }

  function formatBytes(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  }

  function formatPhone(jid) {
    const digits = String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    return digits ? `+${digits}` : '';
  }

  function statusPill(status) {
    const info = STATUS[status] || { label: status || 'Desconocido', cls: '' };
    return `<span class="status ${info.cls}">${escapeHtml(info.label)}</span>`;
  }

  function initials(name) {
    return escapeHtml(String(name || '?').slice(0, 1).toUpperCase());
  }

  function icon(name) {
    const paths = {
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
      phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
      reply: '<path d="M9 17l-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
      groups: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
      eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
      clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
      more: '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
  }

  // ─── Modales ─────────────────────────────────────────────────────────
  function openModal(id) {
    const modal = document.getElementById(id);
    modal.classList.add('open');
    modal.querySelector('input, select')?.focus();
  }

  function closeModal(modal) {
    modal.classList.remove('open');
    modal.querySelectorAll('.form-error').forEach((el) => { el.textContent = ''; });
    modal.querySelector('form')?.reset();
  }

  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('[data-close-modal]')) closeModal(modal);
    });
  });
  let confirmResolver = null;
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.modal.open').forEach(closeModal);
    closeMenus();
    confirmResolver?.(false);
    confirmResolver = null;
  });

  function confirmAction({ title, text, accept = 'Confirmar' }) {
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmAccept').textContent = accept;
    openModal('confirmModal');
    return new Promise((resolve) => { confirmResolver = resolve; });
  }
  $('#confirmAccept').addEventListener('click', () => {
    closeModal($('#confirmModal'));
    confirmResolver?.(true);
    confirmResolver = null;
  });
  $('#confirmModal').addEventListener('click', (event) => {
    if (event.target === $('#confirmModal') || event.target.closest('[data-close-modal]')) {
      confirmResolver?.(false);
      confirmResolver = null;
    }
  });

  async function submitWithButton(button, errorEl, task) {
    errorEl.textContent = '';
    button.disabled = true;
    try {
      await task();
      return true;
    } catch (error) {
      errorEl.textContent = error.message;
      return false;
    } finally {
      button.disabled = false;
    }
  }

  // ─── Navegación ──────────────────────────────────────────────────────
  function showSection(name) {
    const section = SECTIONS.includes(name) ? name : 'resumen';
    state.section = section;
    document.querySelectorAll('.section').forEach((el) => el.classList.toggle('active', el.id === `section-${section}`));
    document.querySelectorAll('.nav-item[data-section]').forEach((el) => el.classList.toggle('active', el.dataset.section === section));
    const el = document.getElementById(`section-${section}`);
    $('#sectionTitle').textContent = el.dataset.title;
    $('#sectionSubtitle').textContent = el.dataset.subtitle;
    $('#shell').classList.remove('nav-open');
    if (section === 'resumen' && state.stats) renderStats();
    if (section === 'configuracion') loadConfiguration();
  }

  window.addEventListener('hashchange', () => showSection(location.hash.slice(1)));
  $('#menuToggle').addEventListener('click', () => $('#shell').classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => $('#shell').classList.remove('nav-open'));
  $('#logoutBtn').addEventListener('click', async () => {
    await IbotApi.logoutPanel().catch(() => null);
    location.href = '/login.html';
  });

  // ─── Carga de datos ──────────────────────────────────────────────────
  async function refresh() {
    if (state.loading) return;
    state.loading = true;
    $('#refreshBtn').disabled = true;
    try {
      const [overview, stats] = await Promise.all([api.overview(), api.stats(state.days)]);
      state.overview = overview;
      state.stats = stats;
      renderOverview();
      renderStats();
      if (state.section === 'configuracion') loadConfiguration();
      $('#lastUpdated').textContent = `Actualizado ${timeFormat.format(new Date())}`;
    } catch (error) {
      toast(`No se pudieron cargar los datos: ${error.message}`);
    } finally {
      state.loading = false;
      $('#refreshBtn').disabled = false;
      $('#loading').style.display = 'none';
    }
  }

  function renderOverview() {
    const { summary, users, orphanAccounts, admins } = state.overview;
    $('#navUsersCount').textContent = summary.users;
    $('#navConnectedCount').textContent = summary.connected;

    const kpis = [
      { icon: 'users', label: 'Usuarios', value: summary.activeUsers, foot: summary.suspendedUsers ? `${summary.suspendedUsers} suspendido(s)` : `${summary.users} en total` },
      { icon: 'phone', label: 'WhatsApp conectados', value: summary.connected, foot: `${summary.linkedAccounts} vinculado(s)` },
      { icon: 'reply', label: 'Respuestas enviadas', value: summary.orders, foot: 'Total histórico' },
      { icon: 'groups', label: 'Grupos configurados', value: summary.configuredGroups, foot: 'En todas las cuentas' },
      { icon: 'eye', label: 'Mensajes observados', value: summary.observedMessages, foot: 'Modo watch' },
      { icon: 'clock', label: 'Programados pendientes', value: summary.pendingScheduled, foot: 'Por enviar' },
    ];
    $('#kpiGrid').innerHTML = kpis.map((kpi) => `
      <div class="kpi">
        <div class="kpi-label">${icon(kpi.icon)}${escapeHtml(kpi.label)}</div>
        <div class="kpi-value">${AdminCharts.format(kpi.value)}</div>
        <div class="kpi-foot">${escapeHtml(kpi.foot)}</div>
      </div>`).join('');

    renderUsers();
    renderConnections(users, orphanAccounts);
    $('#adminsBody').innerHTML = admins.map((admin) => `
      <tr>
        <td><div class="user-cell"><div class="avatar">${initials(admin.username)}</div><div class="name">${escapeHtml(admin.username)}</div></div></td>
        <td>${formatDate(admin.createdAt)}</td>
        <td>${escapeHtml(formatRelative(admin.lastLoginAt))}</td>
      </tr>`).join('');
  }

  function renderStats() {
    if (!state.stats || state.section !== 'resumen') return;
    const stats = state.stats;
    const sum = (values) => values.reduce((total, value) => total + value, 0);
    $('#rangeTimezone').textContent = `Días según ${stats.timeZone}`;

    $('#ordersTotal').textContent = AdminCharts.format(sum(stats.orders));
    AdminCharts.bars($('#ordersChart'), { labels: stats.days, values: stats.orders, color: 'var(--series-1)', title: 'Respuestas enviadas por día', unit: 'respuestas' });
    $('#observedTotal').textContent = AdminCharts.format(sum(stats.observed));
    AdminCharts.bars($('#observedChart'), { labels: stats.days, values: stats.observed, color: 'var(--series-2)', title: 'Mensajes observados por día', unit: 'mensajes' });
    $('#signupsTotal').textContent = AdminCharts.format(sum(stats.signups));
    AdminCharts.bars($('#signupsChart'), { labels: stats.days, values: stats.signups, color: 'var(--series-3)', title: 'Nuevos usuarios por día', unit: 'usuarios' });

    const statusRows = Object.keys(STATUS)
      .filter((status) => stats.statusCounts[status])
      .map((status) => ({ label: STATUS[status].label, value: stats.statusCounts[status], color: STATUS[status].color, statusClass: STATUS[status].cls || 'neutral' }));
    AdminCharts.hbars($('#statusChart'), statusRows, { emptyText: 'Todavía no hay cuentas de WhatsApp' });
    AdminCharts.hbars($('#topChart'), stats.topAccounts.map((row) => ({ label: row.name, value: row.total, color: 'var(--series-1)' })), { emptyText: 'Sin respuestas en este periodo' });
    const scheduledRows = Object.keys(SCHEDULED)
      .filter((status) => stats.scheduled[status])
      .map((status) => ({ label: SCHEDULED[status].label, value: stats.scheduled[status], color: SCHEDULED[status].color, statusClass: SCHEDULED[status].cls || 'neutral' }));
    AdminCharts.hbars($('#scheduledChart'), scheduledRows, { emptyText: 'No hay mensajes programados' });
  }

  $('#rangeSelector').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-days]');
    if (!button || Number(button.dataset.days) === state.days) return;
    state.days = Number(button.dataset.days);
    $('#rangeSelector').querySelectorAll('button').forEach((el) => el.classList.toggle('active', el === button));
    try {
      state.stats = await api.stats(state.days);
      renderStats();
    } catch (error) {
      toast(error.message);
    }
  });
  $('#refreshBtn').addEventListener('click', () => refresh());

  // ─── Usuarios ────────────────────────────────────────────────────────
  function userMatches(user, query, filter) {
    const account = user.account;
    if (filter === 'connected' && account?.status !== 'connected') return false;
    if (filter === 'unlinked' && account?.phoneJid) return false;
    if (filter === 'suspended' && !user.disabled) return false;
    if (!query) return true;
    return [user.username, account?.phoneName, formatPhone(account?.phoneJid)]
      .some((value) => String(value || '').toLowerCase().includes(query));
  }

  function userMenu(user) {
    const account = user.account;
    const running = account && RUNNING.includes(account.status);
    const items = [];
    if (account) {
      items.push(running
        ? `<button type="button" data-action="stop" data-account="${escapeHtml(account.accountId)}">Apagar WhatsApp</button>`
        : `<button type="button" data-action="start" data-account="${escapeHtml(account.accountId)}">Encender WhatsApp</button>`);
      if (account.phoneJid) items.push(`<button type="button" data-action="logout" data-account="${escapeHtml(account.accountId)}" data-name="${escapeHtml(user.username)}">Desvincular WhatsApp</button>`);
      items.push('<hr>');
    }
    items.push(`<button type="button" data-action="password" data-username="${escapeHtml(user.username)}">Cambiar contraseña</button>`);
    items.push(user.disabled
      ? `<button type="button" data-action="enable" data-username="${escapeHtml(user.username)}">Reactivar usuario</button>`
      : `<button type="button" data-action="disable" data-username="${escapeHtml(user.username)}">Suspender usuario</button>`);
    items.push('<hr>');
    items.push(`<button type="button" class="danger" data-action="delete" data-username="${escapeHtml(user.username)}">Eliminar usuario</button>`);
    return `<div class="menu"><button class="btn icon ghost" type="button" data-action="menu" aria-label="Acciones de ${escapeHtml(user.username)}">${icon('more')}</button><div class="menu-panel">${items.join('')}</div></div>`;
  }

  function renderUsers() {
    const users = state.overview?.users || [];
    const query = $('#userSearch').value.trim().toLowerCase();
    const filter = $('#userFilter').value;
    const rows = users.filter((user) => userMatches(user, query, filter));
    if (!rows.length) {
      $('#usersBody').innerHTML = `<tr><td colspan="7" class="empty">${users.length ? 'Ningún usuario coincide con la búsqueda.' : 'Todavía no hay usuarios. Crea el primero con "Nuevo usuario".'}</td></tr>`;
      return;
    }
    $('#usersBody').innerHTML = rows.map((user) => {
      const account = user.account;
      const phone = formatPhone(account?.phoneJid);
      const whatsapp = account?.phoneJid
        ? `${statusPill(account.status)}<div class="muted" style="margin-top:4px">${escapeHtml(phone)}${account.phoneName ? ` · ${escapeHtml(account.phoneName)}` : ''}</div>`
        : `<span class="muted">${account ? statusPill(account.status) : 'Sin vincular'}</span>`;
      return `
        <tr>
          <td class="cell-main">
            <div class="user-cell">
              <div class="avatar">${initials(user.username)}</div>
              <div>
                <div class="name">${escapeHtml(user.username)} ${user.disabled ? '<span class="status critical">Suspendido</span>' : ''}</div>
                <div class="meta">Creado ${formatDate(user.createdAt)}</div>
              </div>
            </div>
          </td>
          <td data-label="WhatsApp">${whatsapp}</td>
          <td data-label="Modo">${account ? escapeHtml(MODES[account.mode] || account.mode) : '—'}</td>
          <td data-label="Respuestas" class="num">${AdminCharts.format(account?.orders || 0)}</td>
          <td data-label="Grupos" class="num">${AdminCharts.format(account?.groups || 0)}</td>
          <td data-label="Último acceso">${escapeHtml(formatRelative(user.lastLoginAt))}</td>
          <td class="cell-actions"><div class="actions">${userMenu(user)}</div></td>
        </tr>`;
    }).join('');
  }

  $('#userSearch').addEventListener('input', renderUsers);
  $('#userFilter').addEventListener('change', renderUsers);

  // ─── Conexiones ──────────────────────────────────────────────────────
  function renderConnections(users, orphanAccounts) {
    const rows = [
      ...users.filter((user) => user.account).map((user) => ({ owner: user.username, account: user.account })),
      ...orphanAccounts.map((account) => ({ owner: null, account })),
    ];
    $('#orphanNotice').innerHTML = orphanAccounts.length ? `
      <div class="notice">
        <div>
          <strong>${orphanAccounts.length} WhatsApp sin usuario.</strong>
          Son cuentas que no pertenecen a ningún usuario (por ejemplo, la que usaba el administrador antes de separar los paneles).
          Siguen funcionando con su configuración; asígnalas a un usuario para que pueda administrarlas desde su panel.
        </div>
      </div>` : '';
    if (!rows.length) {
      $('#connectionsBody').innerHTML = '<tr><td colspan="7" class="empty">Ningún usuario ha vinculado WhatsApp todavía.</td></tr>';
      return;
    }
    $('#connectionsBody').innerHTML = rows.map(({ owner, account }) => {
      const running = RUNNING.includes(account.status);
      const accountAttr = `data-account="${escapeHtml(account.accountId)}"`;
      const buttons = [
        running
          ? `<button class="btn" type="button" data-action="stop" ${accountAttr}>Apagar</button>`
          : `<button class="btn" type="button" data-action="start" ${accountAttr}>Encender</button>`,
      ];
      if (account.phoneJid) buttons.push(`<button class="btn danger" type="button" data-action="logout" ${accountAttr} data-name="${escapeHtml(owner || account.label || account.accountId)}">Desvincular</button>`);
      if (!owner) buttons.unshift(`<button class="btn primary" type="button" data-action="assign" ${accountAttr}>Asignar</button>`);
      return `
        <tr>
          <td class="cell-main">
            <div class="user-cell">
              <div class="avatar">${owner ? initials(owner) : '?'}</div>
              <div>
                <div class="name">${owner ? escapeHtml(owner) : 'Sin usuario'}</div>
                <div class="meta">${escapeHtml(account.phoneName || account.label || account.accountId)}</div>
              </div>
            </div>
          </td>
          <td data-label="Estado">${statusPill(account.status)}</td>
          <td data-label="Número">${escapeHtml(formatPhone(account.phoneJid) || '—')}</td>
          <td data-label="Modo">${escapeHtml(MODES[account.mode] || account.mode)}</td>
          <td data-label="Respuestas automáticas">${account.respuestas ? '<span class="status good">Activadas</span>' : '<span class="status">Desactivadas</span>'}</td>
          <td data-label="Programados" class="num">${AdminCharts.format(account.scheduled)}</td>
          <td class="cell-actions"><div class="actions">${buttons.join('')}</div></td>
        </tr>`;
    }).join('');
  }

  // ─── Acciones (delegadas) ────────────────────────────────────────────
  // El menú se posiciona respecto a la ventana para que la tabla no lo recorte.
  function placeMenu(menu, button) {
    const panel = menu.querySelector('.menu-panel');
    const rect = button.getBoundingClientRect();
    const height = panel.offsetHeight;
    const below = rect.bottom + 6 + height <= window.innerHeight;
    panel.style.top = `${below ? rect.bottom + 6 : Math.max(8, rect.top - 6 - height)}px`;
    panel.style.left = `${Math.max(8, Math.min(rect.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 8))}px`;
  }
  window.addEventListener('resize', () => closeMenus());
  window.addEventListener('scroll', () => closeMenus(), true);

  function closeMenus(except) {
    document.querySelectorAll('.menu.open').forEach((menu) => { if (menu !== except) menu.classList.remove('open'); });
  }

  async function runAction(label, task) {
    try {
      await task();
      toast(label);
      await refresh();
    } catch (error) {
      toast(error.message);
    }
  }

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) {
      if (!event.target.closest('.menu')) closeMenus();
      return;
    }
    const { action, account, username, name } = target.dataset;
    if (action === 'menu') {
      const menu = target.closest('.menu');
      closeMenus(menu);
      menu.classList.toggle('open');
      if (menu.classList.contains('open')) placeMenu(menu, target);
      return;
    }
    closeMenus();

    if (action === 'start') return runAction('WhatsApp encendido', () => api.control(account, 'start'));
    if (action === 'stop') return runAction('WhatsApp apagado', () => api.control(account, 'stop'));
    if (action === 'logout') {
      const ok = await confirmAction({
        title: 'Desvincular WhatsApp',
        text: `Se cerrará la sesión de WhatsApp de ${name}. Para volver a usarlo deberá escanear un nuevo QR.`,
        accept: 'Desvincular',
      });
      if (ok) runAction('WhatsApp desvinculado', () => api.control(account, 'logout'));
      return;
    }
    if (action === 'password') {
      state.passwordTarget = username;
      $('#passwordModalTitle').textContent = `Contraseña de ${username}`;
      openModal('passwordModal');
      return;
    }
    if (action === 'disable') {
      const ok = await confirmAction({
        title: `Suspender a ${username}`,
        text: 'No podrá iniciar sesión, se cerrarán sus sesiones abiertas y su WhatsApp se apagará. Sus datos se conservan.',
        accept: 'Suspender',
      });
      if (ok) runAction('Usuario suspendido', () => api.setDisabled(username, true));
      return;
    }
    if (action === 'enable') return runAction('Usuario reactivado', () => api.setDisabled(username, false));
    if (action === 'delete') {
      const ok = await confirmAction({
        title: `Eliminar a ${username}`,
        text: 'Se desvinculará su WhatsApp y se borrarán permanentemente sus grupos, contactos, mensajes, programados y estadísticas. Esta acción no se puede deshacer.',
        accept: 'Eliminar definitivamente',
      });
      if (ok) runAction('Usuario eliminado', () => api.deleteUser(username));
      return;
    }
    if (action === 'assign') openAssign(account);
  });

  // ─── Crear usuario ───────────────────────────────────────────────────
  $('#newUserBtn').addEventListener('click', () => {
    const orphans = state.overview?.orphanAccounts || [];
    $('#assignField').style.display = orphans.length ? '' : 'none';
    $('#newAssignAccount').innerHTML = '<option value="">No asignar (vinculará un WhatsApp nuevo)</option>'
      + orphans.map((account) => `<option value="${escapeHtml(account.accountId)}">${escapeHtml(account.phoneName || account.label || account.accountId)}${account.phoneJid ? ` · ${escapeHtml(formatPhone(account.phoneJid))}` : ''}</option>`).join('');
    openModal('userModal');
  });

  $('#userForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = $('#newPassword').value;
    if (password !== $('#newPasswordConfirm').value) {
      $('#userFormError').textContent = 'Las contraseñas no coinciden.';
      return;
    }
    const username = $('#newUsername').value.trim();
    const ok = await submitWithButton($('#userFormSave'), $('#userFormError'), () => api.createUser({
      username,
      password,
      assignAccountId: $('#newAssignAccount').value || undefined,
    }));
    if (ok) {
      closeModal($('#userModal'));
      toast(`Usuario ${username.toLowerCase()} creado`);
      refresh();
    }
  });

  // ─── Contraseña de un usuario ────────────────────────────────────────
  $('#passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = $('#userNewPassword').value;
    if (password !== $('#userNewPasswordConfirm').value) {
      $('#passwordFormError').textContent = 'Las contraseñas no coinciden.';
      return;
    }
    const ok = await submitWithButton($('#passwordFormSave'), $('#passwordFormError'), () => api.setPassword(state.passwordTarget, password));
    if (ok) {
      closeModal($('#passwordModal'));
      toast('Contraseña actualizada');
    }
  });

  // ─── Asignar cuenta sin dueño ────────────────────────────────────────
  function openAssign(accountId) {
    const candidates = (state.overview?.users || []).filter((user) => !user.account);
    if (!candidates.length) {
      toast('Todos los usuarios ya tienen WhatsApp. Crea un usuario nuevo y asígnale esta cuenta al crearlo.');
      return;
    }
    state.assignTarget = accountId;
    $('#assignUser').innerHTML = candidates.map((user) => `<option value="${escapeHtml(user.username)}">${escapeHtml(user.username)}</option>`).join('');
    openModal('assignModal');
  }

  $('#assignForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#assignUser').value;
    const ok = await submitWithButton($('#assignFormSave'), $('#assignFormError'), () => api.assign(state.assignTarget, username));
    if (ok) {
      closeModal($('#assignModal'));
      toast(`WhatsApp asignado a ${username}`);
      refresh();
    }
  });

  // ─── Configuración y sistema ─────────────────────────────────────────
  function fillTimezones(selected) {
    const select = $('#setTimezone');
    const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    const list = [...new Set([selected, ...zones])].filter(Boolean);
    select.innerHTML = list.map((zone) => `<option value="${escapeHtml(zone)}">${escapeHtml(zone.replaceAll('_', ' '))}</option>`).join('');
    select.value = selected;
  }

  function infoRow(label, value) {
    return `<div class="info-row"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
  }

  function check(ok, good, bad) {
    return ok ? `<span class="status good">${escapeHtml(good)}</span>` : `<span class="status critical">${escapeHtml(bad)}</span>`;
  }

  async function loadConfiguration() {
    try {
      const [settings, system] = await Promise.all([api.settings(), api.system()]);
      if (!$('#settingsForm').contains(document.activeElement)) {
        $('#setPublicRegistration').checked = settings.publicRegistration;
        $('#setMaxUsers').value = settings.maxUsers;
        fillTimezones(settings.defaultTimezone);
      }
      const syncLabels = { 'change-streams': 'Tiempo real (change streams)', polling: 'Polling cada 5 s', idle: 'Sin cuentas cargadas' };
      $('#systemInfo').innerHTML = [
        infoRow('Versión', `v${escapeHtml(system.version)}`),
        infoRow('Entorno', escapeHtml(system.environment)),
        infoRow('Node.js', escapeHtml(system.node)),
        infoRow('En línea desde hace', escapeHtml(formatDuration(system.uptimeSeconds))),
        infoRow('Memoria en uso', escapeHtml(formatBytes(system.memory.rss))),
        infoRow('Base de datos', escapeHtml(system.database)),
        infoRow('Sincronización de cambios', escapeHtml(syncLabels[system.syncMode] || system.syncMode)),
        infoRow('WhatsApp en ejecución', `${system.runningBots} de ${system.runtimesLoaded} cargados`),
        infoRow('Mensajes programados', check(system.schedulerRunning, 'Activo', 'Detenido')),
        infoRow('Secreto de sesión persistente', check(system.persistentSecret, 'Configurado', 'Falta PANEL_SECRET')),
        infoRow('Cookies seguras (HTTPS)', check(system.secureCookies, 'Activadas', 'Desactivadas')),
        infoRow('Autenticación del panel', check(system.panelAuthEnabled, 'Activada', 'Desactivada')),
        infoRow('Clave DeepSeek (modo IA)', check(system.deepseekKeyConfigured, 'Configurada', 'No configurada')),
      ].join('');
    } catch (error) {
      toast(error.message);
    }
  }

  $('#settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const ok = await submitWithButton($('#settingsSave'), $('#settingsError'), () => api.saveSettings({
      publicRegistration: $('#setPublicRegistration').checked,
      defaultTimezone: $('#setTimezone').value,
      maxUsers: Number($('#setMaxUsers').value || 0),
    }));
    if (ok) {
      toast('Ajustes guardados');
      document.activeElement?.blur();
      loadConfiguration();
    }
  });

  // ─── Mi cuenta ───────────────────────────────────────────────────────
  $('#myPasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = $('#myNewPassword').value;
    if (password !== $('#myConfirmPassword').value) {
      $('#myPasswordError').textContent = 'Las contraseñas no coinciden.';
      return;
    }
    const ok = await submitWithButton($('#myPasswordSave'), $('#myPasswordError'), () => api.myPassword({
      currentPassword: $('#myCurrentPassword').value,
      password,
    }));
    if (ok) {
      $('#myPasswordForm').reset();
      toast('Contraseña actualizada');
    }
  });

  // ─── Inicio ──────────────────────────────────────────────────────────
  async function init() {
    const status = await IbotApi.authStatus().catch(() => null);
    const username = status?.user?.username || 'Administrador';
    $('#adminName').textContent = username;
    $('#adminAvatar').textContent = username.slice(0, 1).toUpperCase();
    showSection(location.hash.slice(1));
    await refresh();
    setInterval(() => {
      if (document.visibilityState === 'visible' && !document.querySelector('.modal.open')) refresh();
    }, REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
    });
  }

  init();
})();
