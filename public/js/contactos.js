// Contactos: integrantes de los grupos, otros contactos, búsqueda y mensajes programados.
(() => {
  const PAGE_SIZE = 100;
  const state = { tab: 'groups', query: '', overview: null, pages: new Map(), aiRules: null };
  const dateTime = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  const panel = $('#panel');
  const canSchedule = () => userPermissions()?.features.scheduleMessages !== false;
  // Reglas de IA por chat (solo si el usuario puede configurar la IA).
  const canAi = () => userPermissions()?.features.iaSettings !== false && !!state.aiRules;
  const AI_OPTIONS = { inherit: 'IA: general', allow: 'IA: sí', block: 'IA: no' };
  const icon = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    copy: icon('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
    open: icon('<path d="M14 3h7v7"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>'),
    clock: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    chev: icon('<path d="M9 6l6 6-6 6"/>'),
  };

  const initials = (name) => escapeHtml(String(name || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase() || '?');
  const phoneLabel = (item) => (item.phone ? `+${item.phone}` : 'Sin número visible');

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(value);
    const field = document.createElement('textarea');
    field.value = value;
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    if (!ok) throw new Error('No se pudo copiar');
  }

  function aiSelect(jid, name) {
    if (!canAi() || !jid) return '';
    const access = state.aiRules.get(jid)?.access || 'inherit';
    return `<select class="input ai-select ${access}" data-ai-chat="${escapeHtml(jid)}" data-name="${escapeHtml(name || '')}" title="¿Responde la IA en este chat?" aria-label="IA en este chat">
      ${Object.entries(AI_OPTIONS).map(([value, label]) => `<option value="${value}"${value === access ? ' selected' : ''}>${label}</option>`).join('')}
    </select>`;
  }

  // ─── Contactos ───────────────────────────────────────────────────────
  function contactItem(item, showOrigin = false) {
    const origin = showOrigin && item.lastChat ? ` · ${escapeHtml(item.lastChat)}` : '';
    return `
      <div class="list-item">
        <div class="avatar">${initials(item.name)}</div>
        <div class="main">
          <div class="title">${escapeHtml(item.name || 'Sin nombre')}</div>
          <div class="meta">${escapeHtml(phoneLabel(item))}${origin}</div>
        </div>
        <div class="actions contact-actions">
          ${aiSelect(item.jid, item.name)}
          <button class="btn sm icon ghost" type="button" data-action="copy" data-value="${escapeHtml(item.phone || item.jid)}" title="Copiar">${ICONS.copy}</button>
          ${item.hasPhone ? `<a class="btn sm icon ghost" href="https://wa.me/${escapeHtml(item.phone)}" target="_blank" rel="noopener noreferrer" title="Abrir en WhatsApp">${ICONS.open}</a>` : ''}
          ${canSchedule() ? `<button class="btn sm" type="button" data-action="schedule" data-type="user" data-jid="${escapeHtml(item.jid)}" data-name="${escapeHtml(item.name || phoneLabel(item))}">${ICONS.clock}<span class="label">Programar</span></button>` : ''}
        </div>
      </div>`;
  }

  function contactList(items, pagination, key, showOrigin) {
    const more = pagination?.hasNext
      ? `<div class="load-more"><button class="btn sm" type="button" data-action="more" data-key="${escapeHtml(key)}">Cargar más (${pagination.totalItems - pagination.page * pagination.limit})</button></div>`
      : '';
    return `<div class="list" data-list="${escapeHtml(key)}">${items.map((item) => contactItem(item, showOrigin)).join('')}</div>${more}`;
  }

  async function fetchContacts(key, params, page = 1) {
    const data = await IbotApi.directory({ ...params, page, limit: PAGE_SIZE, sort: 'name' });
    state.pages.set(key, { params, page, pagination: data.pagination });
    return data;
  }

  async function loadMore(button) {
    const key = button.dataset.key;
    const entry = state.pages.get(key);
    if (!entry) return;
    button.disabled = true;
    const data = await fetchContacts(key, entry.params, entry.page + 1);
    const list = panel.querySelector(`[data-list="${CSS.escape(key)}"]`);
    list.insertAdjacentHTML('beforeend', data.items.map((item) => contactItem(item, entry.params.scope !== 'groups')).join(''));
    const { pagination } = data;
    if (!pagination.hasNext) {
      button.closest('.load-more').remove();
      return;
    }
    button.textContent = `Cargar más (${pagination.totalItems - pagination.page * pagination.limit})`;
    button.disabled = false;
  }

  // ─── Pestañas ────────────────────────────────────────────────────────
  function renderGroups() {
    const groups = state.overview?.groups || [];
    if (!groups.length) {
      panel.innerHTML = '<div class="empty"><strong>Sin grupos</strong>Configura grupos o espera a que tu WhatsApp los detecte.</div>';
      return;
    }
    panel.innerHTML = groups.map((group) => `
      <details class="group-block" data-group="${escapeHtml(group.groupId)}">
        <summary>
          <span class="chev">${ICONS.chev}</span>
          <div class="avatar group">${initials(group.nombre)}</div>
          <div class="main">
            <div class="title" style="font-weight:700">${escapeHtml(group.nombre || group.groupId)}</div>
            <div class="hint">${Number(group.memberCount || 0)} integrante(s)</div>
          </div>
          <span class="group-actions">
            ${aiSelect(group.groupId, group.nombre)}
            ${canSchedule() ? `<button class="btn sm" type="button" data-action="schedule" data-type="group" data-jid="${escapeHtml(group.groupId)}" data-name="${escapeHtml(group.nombre || group.groupId)}">${ICONS.clock}<span class="label">Programar</span></button>` : ''}
          </span>
        </summary>
        <div class="members"><div class="empty">Cargando integrantes…</div></div>
      </details>`).join('');
  }

  async function openGroup(details) {
    if (details.dataset.loaded) return;
    details.dataset.loaded = 'true';
    const groupId = details.dataset.group;
    const members = details.querySelector('.members');
    try {
      const data = await fetchContacts(`group:${groupId}`, { scope: 'groups', groupId });
      members.innerHTML = data.items.length
        ? contactList(data.items, data.pagination, `group:${groupId}`, false)
        : '<div class="empty">Sin integrantes visibles.</div>';
    } catch (error) {
      members.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
      delete details.dataset.loaded;
    }
  }

  async function renderExternal() {
    panel.innerHTML = '<div class="empty">Cargando contactos…</div>';
    const data = await fetchContacts('external', { scope: 'external' });
    panel.innerHTML = data.items.length
      ? contactList(data.items, data.pagination, 'external', true)
      : '<div class="empty"><strong>Sin otros contactos</strong>Aquí aparecen las personas que te escriben fuera de tus grupos.</div>';
  }

  async function renderSearch() {
    panel.innerHTML = '<div class="empty">Buscando…</div>';
    const data = await fetchContacts('search', { scope: 'all', q: state.query });
    panel.innerHTML = data.items.length
      ? `<div class="hint" style="margin-bottom:6px">${data.pagination.totalItems} resultado(s)</div>${contactList(data.items, data.pagination, 'search', true)}`
      : '<div class="empty"><strong>Sin resultados</strong>Prueba con otro nombre o número.</div>';
  }

  const STATUS = {
    pending: ['Pendiente', 'accent'], processing: ['Enviando', 'warn'], sent: ['Enviado', 'good'],
    failed: ['Falló', 'danger'], cancelled: ['Cancelado', ''],
  };

  function scheduledItem(row) {
    const [label, tone] = STATUS[row.status] || [row.status, ''];
    const repeat = row.repeat && row.repeat !== 'none' ? ` · 🔁 ${ScheduleDialog.REPEAT_LABELS[row.repeat]}` : '';
    const error = row.status === 'failed' && row.lastError ? `<div class="hint" style="color:var(--danger)">${escapeHtml(row.lastError)}</div>` : '';
    const media = row.media?.mediaId
      ? `<span class="attach-chip ${row.media.type}" style="margin-top:6px"><img src="${IbotApi.mediaUrl(row.media.mediaId)}" alt=""><span class="name">${row.media.type === 'sticker' ? 'Sticker' : 'Imagen'}</span></span>`
      : '';
    const cancel = ['pending'].includes(row.status)
      ? `<button class="btn sm danger" type="button" data-action="cancel" data-id="${escapeHtml(row.id)}">Cancelar</button>` : '';
    return `
      <div class="list-item">
        <div class="avatar${row.target?.type === 'group' ? ' group' : ''}">${initials(row.target?.name)}</div>
        <div class="main">
          <div class="title">${escapeHtml(row.target?.name || row.target?.jid)}</div>
          <div class="sched-when">${escapeHtml(dateTime.format(new Date(row.scheduledFor)))}<span class="hint">${escapeHtml(repeat)}</span></div>
          ${row.message ? `<div class="sched-msg">${escapeHtml(row.message)}</div>` : ''}
          ${media}
          ${error}
        </div>
        <div class="actions"><span class="pill ${tone}">${label}</span>${cancel}</div>
      </div>`;
  }

  async function renderScheduled() {
    panel.innerHTML = '<div class="empty">Cargando programados…</div>';
    const [pending, history] = await Promise.all([IbotApi.scheduledMessages('pending'), IbotApi.scheduledMessages('history', 30)]);
    updateScheduledCount(pending.length);
    panel.innerHTML = `
      <div class="section-label">Próximos envíos</div>
      <div class="list">${pending.map(scheduledItem).join('') || '<div class="empty">No tienes mensajes pendientes. Prográmalos desde un contacto, un grupo o un chat.</div>'}</div>
      <hr class="divider">
      <div class="section-label">Historial reciente</div>
      <div class="list">${history.map(scheduledItem).join('') || '<div class="empty">Sin historial todavía.</div>'}</div>`;
  }

  function updateScheduledCount(count) {
    $('#kpiScheduled').textContent = count;
    const badge = $('#scheduledCount');
    if (badge) badge.textContent = count ? ` ${count}` : '';
  }

  async function render() {
    try {
      if (state.query) return await renderSearch();
      if (state.tab === 'groups') return renderGroups();
      if (state.tab === 'external') return await renderExternal();
      if (state.tab === 'scheduled') return await renderScheduled();
    } catch (error) {
      panel.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  }

  async function loadOverview(refresh = false) {
    const button = $('#refreshBtn');
    button.disabled = true;
    try {
      const data = await IbotApi.directory({ scope: 'external', page: 1, limit: 10, refresh: refresh ? 1 : '' });
      state.overview = data;
      state.pages.clear();
      $('#kpiMembers').textContent = Number(data.stats?.totalGroupMembers || 0).toLocaleString('es');
      $('#kpiExternal').textContent = Number(data.stats?.totalExternal || 0).toLocaleString('es');
      $('#kpiGroups').textContent = Number(data.groups?.length || 0).toLocaleString('es');
      if (refresh) toast('Contactos sincronizados con WhatsApp');
      await render();
    } catch (error) {
      panel.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    } finally {
      button.disabled = false;
    }
  }

  // ─── Eventos ─────────────────────────────────────────────────────────
  $('#tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (!tab) return;
    state.tab = tab.dataset.tab;
    state.query = '';
    $('#searchInput').value = '';
    $('#tabs').querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el === tab));
    render();
  });

  let searchTimer = null;
  $('#searchInput').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = event.target.value.trim();
      render();
    }, 250);
  });

  panel.addEventListener('toggle', (event) => {
    if (event.target.matches('details.group-block') && event.target.open) openGroup(event.target);
  }, true);

  // Cambiar si la IA responde en un contacto o grupo.
  panel.addEventListener('change', async (event) => {
    const select = event.target.closest('select[data-ai-chat]');
    if (!select) return;
    const jid = select.dataset.aiChat;
    const previous = state.aiRules.get(jid);
    try {
      const rule = await IbotApi.setIaRule(jid, { access: select.value, templateId: previous?.templateId || null, name: select.dataset.name });
      if (rule.access === 'inherit' && !rule.templateId) state.aiRules.delete(jid);
      else state.aiRules.set(jid, rule);
      select.className = `input ai-select ${rule.access}`;
      toast({ inherit: 'La IA seguirá la configuración general aquí', allow: 'La IA responderá en este chat', block: 'La IA no responderá en este chat' }[rule.access]);
    } catch (error) {
      select.value = previous?.access || 'inherit';
      toast(error.message);
    }
  });
  // Que el selector de IA no abra ni cierre el grupo al tocarlo.
  panel.addEventListener('click', (event) => {
    if (event.target.closest('select[data-ai-chat]')) event.preventDefault();
  }, true);

  panel.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action } = button.dataset;
    if (action === 'schedule') {
      event.preventDefault();
      ScheduleDialog.open(
        { type: button.dataset.type, jid: button.dataset.jid, name: button.dataset.name },
        { onScheduled: () => (state.tab === 'scheduled' ? renderScheduled() : IbotApi.scheduledMessages('pending').then((rows) => updateScheduledCount(rows.length))) },
      );
    }
    if (action === 'copy') {
      try {
        await copyText(button.dataset.value);
        toast('Copiado');
      } catch (error) {
        toast(error.message);
      }
    }
    if (action === 'more') loadMore(button).catch((error) => { toast(error.message); button.disabled = false; });
    if (action === 'cancel') {
      if (!(await IbotDialog.confirm({ title: '¿Cancelar este mensaje programado?', confirmText: 'Cancelar envío', cancelText: 'Volver', danger: true }))) return;
      button.disabled = true;
      try {
        await IbotApi.cancelScheduledMessage(button.dataset.id);
        toast('Mensaje cancelado');
        await renderScheduled();
      } catch (error) {
        toast(error.message);
        button.disabled = false;
      }
    }
  });

  $('#refreshBtn').addEventListener('click', () => loadOverview(true));
  $('#exportBtn')?.addEventListener('click', async () => {
    try {
      const blob = await IbotApi.directoryExport({ scope: 'all', q: state.query });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `contactos-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (error) {
      toast(error.message);
    }
  });

  loadUserBot()
    .then(async (bot) => {
      if (bot.permissions.features.iaSettings !== false) {
        const rules = await IbotApi.iaRules().catch(() => null);
        state.aiRules = rules ? new Map(rules.map((rule) => [rule.chatId, rule])) : null;
      }
    })
    .then(() => Promise.all([
      loadOverview(),
      canSchedule() ? IbotApi.scheduledMessages('pending').then((rows) => updateScheduledCount(rows.length)) : null,
    ]))
    .catch((error) => { panel.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; });
})();
