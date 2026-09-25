document.addEventListener('DOMContentLoaded', async () => {
  const PAGE_SIZE = 200;
  const state = {
    overview: null,
    timezone: 'America/Hermosillo',
    sections: new Map(),
    scheduleTarget: null,
  };

  const groupsContainer = $('#directoryGroups');
  const refreshButton = $('#btnRefresh');
  const scheduleModal = $('#scheduleModal');

  function formatPhone(phone) {
    return phone ? `+${phone}` : 'Número no disponible';
  }

  function formatDate(value) {
    if (!value) return 'Sin actividad reciente';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sin actividad reciente';
    return new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const field = document.createElement('textarea');
    field.value = value;
    field.readOnly = true;
    field.className = 'clipboard-field';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    if (!copied) throw new Error('No se pudo copiar');
  }

  function actionButton(icon, title, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `contact-action ${className}`.trim();
    button.textContent = icon;
    button.title = title;
    button.setAttribute('aria-label', title);
    return button;
  }

  function timeZoneDefaults() {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: state.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(future).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
    );
    $('#scheduleDate').value = `${parts.year}-${parts.month}-${parts.day}`;
    const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: state.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    $('#scheduleDate').min = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
    $('#scheduleTime').value = `${parts.hour}:${parts.minute}`;
  }

  function openSchedule(target) {
    state.scheduleTarget = target;
    $('#scheduleTarget').textContent = `${target.type === 'group' ? 'Grupo' : 'Usuario'}: ${target.name}`;
    $('#scheduleTimezone').textContent = state.timezone;
    $('#scheduleMessage').value = '';
    timeZoneDefaults();
    scheduleModal.classList.add('show');
    scheduleModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => $('#scheduleMessage').focus(), 30);
  }

  function closeSchedule() {
    state.scheduleTarget = null;
    scheduleModal.classList.remove('show');
    scheduleModal.setAttribute('aria-hidden', 'true');
  }

  function contactRow(item, includeOrigin) {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    const name = document.createElement('div');
    name.className = 'contact-primary';
    name.textContent = item.name || 'Sin nombre identificado';
    nameCell.appendChild(name);
    if (!item.hasKnownName) {
      const hint = document.createElement('div');
      hint.className = 'contact-secondary';
      hint.textContent = 'Nombre no sincronizado';
      nameCell.appendChild(hint);
    }

    const identityCell = document.createElement('td');
    const phone = document.createElement('div');
    phone.className = 'contact-primary';
    phone.textContent = formatPhone(item.phone);
    const identity = document.createElement('div');
    identity.className = 'contact-secondary';
    identity.textContent = item.phone || item.jid || 'Sin identificador';
    identity.title = item.jid || '';
    identityCell.append(phone, identity);
    if (includeOrigin) {
      const origin = document.createElement('div');
      origin.className = 'contact-secondary';
      origin.textContent = `${item.lastChat || 'Modo Watch'} · ${formatDate(item.lastSeen)}`;
      identityCell.appendChild(origin);
    }

    const actionsCell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'contact-actions';

    const copy = actionButton('⧉', item.hasPhone ? 'Copiar número' : 'Copiar identificador');
    copy.addEventListener('click', async () => {
      try {
        await copyText(item.phone || item.jid);
        toast(item.hasPhone ? 'Número copiado' : 'Identificador copiado');
      } catch (error) {
        toast(error.message);
      }
    });
    actions.appendChild(copy);

    if (item.hasPhone) {
      const chat = document.createElement('a');
      chat.href = `https://wa.me/${item.phone}`;
      chat.target = '_blank';
      chat.rel = 'noopener noreferrer';
      chat.className = 'contact-action chat';
      chat.textContent = '↗';
      chat.title = 'Abrir chat';
      chat.setAttribute('aria-label', 'Abrir chat');
      actions.appendChild(chat);
    } else {
      const chat = actionButton('↗', 'No hay número disponible', 'chat');
      chat.disabled = true;
      actions.appendChild(chat);
    }

    const schedule = actionButton('◷', 'Programar mensaje', 'schedule');
    schedule.addEventListener('click', () => openSchedule({
      type: 'user',
      jid: item.jid,
      name: item.name || formatPhone(item.phone),
    }));
    actions.appendChild(schedule);
    actionsCell.appendChild(actions);
    row.append(nameCell, identityCell, actionsCell);
    return row;
  }

  function renderSectionRows(section, items, append = false) {
    let table = section.querySelector('.contacts-table');
    if (!table) {
      table = document.createElement('table');
      table.className = 'contacts-table';
      const head = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const label of ['Nombre', 'Teléfono / identidad', 'Acciones']) {
        const th = document.createElement('th');
        th.textContent = label;
        headRow.appendChild(th);
      }
      head.appendChild(headRow);
      table.append(head, document.createElement('tbody'));
      section.querySelector('.group-content').replaceChildren(table);
    }
    const tbody = table.querySelector('tbody');
    const fragment = document.createDocumentFragment();
    for (const item of items) fragment.appendChild(contactRow(item, section.dataset.scope === 'external'));
    if (append) tbody.appendChild(fragment);
    else tbody.replaceChildren(fragment);
  }

  function renderLoadMore(section, pagination) {
    section.querySelector('.load-more-row')?.remove();
    if (!pagination?.hasNext) return;
    const row = document.createElement('div');
    row.className = 'load-more-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn util';
    button.textContent = `Cargar más (${pagination.totalItems - (pagination.page * pagination.limit)} pendientes)`;
    button.addEventListener('click', () => loadSection(section, pagination.page + 1, true));
    row.appendChild(button);
    section.querySelector('.group-content').appendChild(row);
  }

  async function loadSection(section, page = 1, append = false) {
    const key = section.dataset.key;
    if (state.sections.get(key)?.loading) return;
    state.sections.set(key, { loading: true, loaded: append || false });
    if (!append) section.querySelector('.group-content').innerHTML = '<div class="section-state">Cargando contactos...</div>';
    try {
      const params = {
        scope: section.dataset.scope,
        groupId: section.dataset.groupId || 'all',
        page,
        limit: PAGE_SIZE,
        sort: 'name',
      };
      const data = await IbotApi.directory(params);
      renderSectionRows(section, data.items || [], append);
      renderLoadMore(section, data.pagination);
      const count = section.querySelector('.group-count');
      if (count) count.textContent = `${data.pagination.totalItems} contacto${data.pagination.totalItems === 1 ? '' : 's'}`;
      if (!data.items?.length && !append) {
        section.querySelector('.group-content').innerHTML = '<div class="section-state">No hay contactos disponibles.</div>';
      }
      state.sections.set(key, { loading: false, loaded: true });
    } catch (error) {
      section.querySelector('.group-content').innerHTML = `<div class="section-state">${escapeHtml(error.message)}</div>`;
      state.sections.set(key, { loading: false, loaded: false });
    }
  }

  function groupSection({ key, name, groupId = '', count = 0, scope = 'groups', external = false }) {
    const details = document.createElement('details');
    details.className = `contact-group${external ? ' external' : ''}`;
    details.dataset.key = key;
    details.dataset.scope = scope;
    details.dataset.groupId = groupId;

    const summary = document.createElement('summary');
    summary.className = 'group-summary';
    const chevron = document.createElement('span');
    chevron.className = 'group-chevron';
    chevron.textContent = '›';
    const info = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'group-name';
    title.textContent = name;
    const id = document.createElement('div');
    id.className = 'group-id';
    id.textContent = external ? 'Contactos fuera de los grupos registrados' : groupId;
    info.append(title, id);
    const countBadge = document.createElement('span');
    countBadge.className = 'group-count';
    countBadge.textContent = `${count} contacto${count === 1 ? '' : 's'}`;
    summary.append(chevron, info, countBadge);

    if (!external) {
      const schedule = actionButton('◷', 'Programar mensaje para todo el grupo', 'schedule-group');
      schedule.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openSchedule({ type: 'group', jid: groupId, name });
      });
      summary.appendChild(schedule);
    } else {
      const spacer = document.createElement('span');
      summary.appendChild(spacer);
    }

    const content = document.createElement('div');
    content.className = 'group-content';
    content.innerHTML = '<div class="section-state">Abre la lista para cargar los contactos.</div>';
    details.append(summary, content);
    details.addEventListener('toggle', () => {
      if (details.open && !state.sections.get(key)?.loaded) loadSection(details);
    });
    return details;
  }

  function renderOverview(data) {
    const stats = data.stats || {};
    $('#kpiGroupMembers').textContent = Number(stats.totalGroupMembers || 0).toLocaleString('es');
    $('#kpiExternal').textContent = Number(stats.totalExternal || 0).toLocaleString('es');
    $('#kpiGroupsCount').textContent = Number(data.groups?.length || 0).toLocaleString('es');
    $('#kpiNamesCount').textContent = Number(stats.totalKnownNames || 0).toLocaleString('es');

    const fragment = document.createDocumentFragment();
    for (const group of data.groups || []) {
      fragment.appendChild(groupSection({
        key: group.groupId,
        name: group.nombre || group.groupId,
        groupId: group.groupId,
        count: Number(group.memberCount || 0),
      }));
    }
    fragment.appendChild(groupSection({
      key: 'external',
      name: 'Externos / Modo Watch',
      count: Number(stats.totalExternal || 0),
      scope: 'external',
      external: true,
    }));
    groupsContainer.replaceChildren(fragment);
  }

  async function loadOverview(refresh = false) {
    refreshButton.disabled = true;
    refreshButton.classList.add('is-loading');
    groupsContainer.innerHTML = '<div class="section-state">Sincronizando grupos y contactos...</div>';
    state.sections.clear();
    try {
      const [data, config] = await Promise.all([
        IbotApi.directory({ scope: 'external', page: 1, limit: 10, refresh: refresh ? 1 : '' }),
        IbotApi.config(),
      ]);
      state.overview = data;
      state.timezone = config.timezone || 'America/Hermosillo';
      renderOverview(data);
      if (refresh) toast('Contactos actualizados');
    } catch (error) {
      groupsContainer.innerHTML = `<div class="section-state">${escapeHtml(error.message)}</div>`;
      toast('No se pudieron cargar los contactos');
    } finally {
      refreshButton.disabled = false;
      refreshButton.classList.remove('is-loading');
    }
  }

  $('#scheduleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.scheduleTarget) return;
    const button = $('#saveSchedule');
    button.disabled = true;
    button.textContent = 'Programando...';
    try {
      await IbotApi.scheduleMessage({
        target: state.scheduleTarget,
        localDate: $('#scheduleDate').value,
        localTime: $('#scheduleTime').value,
        message: $('#scheduleMessage').value.trim(),
      });
      closeSchedule();
      toast('Mensaje programado correctamente');
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Programar';
    }
  });
  $('#cancelSchedule').addEventListener('click', closeSchedule);
  scheduleModal.addEventListener('click', (event) => {
    if (event.target === scheduleModal) closeSchedule();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && scheduleModal.classList.contains('show')) closeSchedule();
  });
  refreshButton.addEventListener('click', () => loadOverview(true));
  bindPanelLogout();

  try {
    await loadUserBot();
    await loadOverview();
  } catch (error) {
    groupsContainer.innerHTML = `<div class="section-state">${escapeHtml(error.message)}</div>`;
  }
});
