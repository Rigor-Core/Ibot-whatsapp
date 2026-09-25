let activeTab = 'console';
let selectedGroup = null;
let groups = [];
let chatSource = null;
let logSource = null;
let logPollTimer = null;

// Modal elements are queried dynamically inside functions to prevent null reference errors on load.

async function init() {
  bindPanelLogout();
  bindEvents();
  await loadUserBot();
  await loadLogs();
  await loadChats();
  connectStreams();
  startLogPolling();
}

function bindEvents() {
  $('#tabConsole').onclick = () => showTab('console');
  $('#tabChats').onclick = () => showTab('chats');
  
  const refreshBtn = document.getElementById('refreshLogsBtn');
  if (refreshBtn) refreshBtn.onclick = loadLogs;
  
  $('#clearLogs').onclick = async () => { 
    if (confirm('¿Limpiar los logs locales del bot?')) { 
      await IbotApi.clearLogs(); 
      await loadLogs(); 
    } 
  };
  
  $('#searchLog').oninput = () => setTimeout(loadLogs, 150);
  $('#level').onchange = loadLogs;
  $('#chatSearch').oninput = () => loadChats($('#chatSearch').value);
  
  // Both the group title bar and button open the configuration modal
  $('#chatHeader').onclick = handleGroupButtonClick;
  $('#addGroupBtn').onclick = handleGroupButtonClick;

  // Back to chat list button on mobile
  const backBtn = document.getElementById('backToListBtn');
  if (backBtn) {
    backBtn.onclick = () => {
      const layout = $('.chat-layout');
      if (layout) layout.classList.remove('show-chat');
      selectedGroup = null;
      loadChats($('#chatSearch').value);
    };
  }

  // Modal events
  const cancelBtn = $('#btn-cancel');
  if (cancelBtn) cancelBtn.onclick = closeModal;
  const formEl = $('#form');
  if (formEl) formEl.onsubmit = saveForm;

  const modalEl = $('#modal');
  if (modalEl) {
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    const modalEl = $('#modal');
    if (e.key === 'Escape' && modalEl && modalEl.classList.contains('show')) closeModal();
  });
}

function showTab(tab) {
  activeTab = tab;
  $('#consoleView').style.display = tab === 'console' ? 'block' : 'none';
  $('#chatView').style.display = tab === 'chats' ? 'block' : 'none';
  $('#tabConsole').classList.toggle('active', tab === 'console');
  $('#tabChats').classList.toggle('active', tab === 'chats');
}

async function loadLogs() {
  const params = new URLSearchParams();
  if ($('#level').value) params.set('level', $('#level').value);
  if ($('#searchLog').value) params.set('q', $('#searchLog').value);
  params.set('limit', '500');
  const rows = await IbotApi.logs(`?${params}`).catch((e) => { toast(e.message); return []; });
  
  const box = $('#consoleBox');
  // Remember if user was already scrolled to bottom before rerendering
  const wasAtBottom = box ? (box.scrollHeight - box.scrollTop - box.clientHeight) < 80 : true;

  box.innerHTML = rows.map((r) => {
    const timeStr = new Date(r.ts).toLocaleTimeString();
    const dateStr = new Date(r.ts).toLocaleDateString();
    const levelStr = r.level.toUpperCase();
    const sourceStr = r.source || 'sys';
    const dataStr = r.data && Object.keys(r.data).length ? ` <span class="log-data">${escapeHtml(JSON.stringify(r.data))}</span>` : '';
    
    return `<div class="logline ${escapeHtml(r.level)}">
      <span class="log-meta-tag">[${dateStr} ${timeStr}]</span>
      <span class="log-level-badge level-${escapeHtml(r.level)}">${escapeHtml(levelStr)}</span>
      <span class="log-source-tag">[${escapeHtml(sourceStr)}]</span>
      <span class="log-separator-arrow">❯</span>
      <span class="log-message-body">${escapeHtml(r.message)}${dataStr}</span>
    </div>`;
  }).join('') || '<div class="muted">Sin logs.</div>';

  // Auto-scroll to bottom so latest logs are always visible
  if (box && wasAtBottom) box.scrollTop = box.scrollHeight;
}

function startLogPolling() {
  if (logPollTimer) clearInterval(logPollTimer);
  // Poll every 10 seconds so console stays up-to-date even when SSE stream is quiet (normal mode)
  logPollTimer = setInterval(() => {
    if (activeTab === 'console') loadLogs();
  }, 10000);
}

async function loadChats(q = '') {
  groups = await IbotApi.chatGroups(q).catch(() => []);

  const container = $('#chatItems');
  container.innerHTML = '';

  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Aún no hay chats detectados.';
    container.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const g of groups) {
    const isSelected = selectedGroup === g.groupId;

    // Card wrapper
    const card = document.createElement('div');
    card.className = `chat-item-card${isSelected ? ' active' : ''}`;
    card.addEventListener('click', () => selectGroup(g.groupId));

    // Avatar circle
    const avatarCircle = document.createElement('div');
    avatarCircle.className = 'chat-item-avatar-circle';

    if (g.pictureUrl) {
      const img = document.createElement('img');
      img.src = g.pictureUrl;
      img.className = 'chat-item-avatar-img';
      img.alt = g.subject || g.groupId;
      avatarCircle.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'chat-item-avatar-placeholder';
      placeholder.textContent = (g.subject || 'G')[0].toUpperCase();
      avatarCircle.appendChild(placeholder);
    }

    // Info section
    const info = document.createElement('div');
    info.className = 'chat-item-info';

    const titleRow = document.createElement('div');
    titleRow.className = 'chat-item-title-row';

    const subjectSpan = document.createElement('span');
    subjectSpan.className = 'chat-item-subject-name';
    subjectSpan.textContent = g.subject || g.groupId;

    const iconWrapper = document.createElement('span');
    iconWrapper.className = 'chat-item-icon-wrapper';
    if (g.configured) {
      iconWrapper.innerHTML = `<svg class="chat-status-icon configured" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#39ff6a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" title="Agregado"><polyline points="20 6 9 17 4 12"/></svg>`;
    } else {
      iconWrapper.innerHTML = `<svg class="chat-status-icon not-configured" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#a4a9c4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" title="No agregado"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
    }

    titleRow.appendChild(subjectSpan);
    titleRow.appendChild(iconWrapper);

    const preview = document.createElement('div');
    preview.className = 'chat-item-msg-preview';
    const lastMsg = g.lastMessagePreview || 'Sin mensajes';
    preview.title = lastMsg;
    preview.textContent = lastMsg;

    info.appendChild(titleRow);
    info.appendChild(preview);

    card.appendChild(avatarCircle);
    card.appendChild(info);
    fragment.appendChild(card);
  }

  container.appendChild(fragment);
}

async function selectGroup(groupId) {
  selectedGroup = groupId;
  const g = groups.find((x) => x.groupId === selectedGroup) || { groupId: selectedGroup };
  $('#chatName').textContent = g.subject || g.groupId;
  $('#chatId').textContent = g.groupId;
  $('#chatAvatar').innerHTML = g.pictureUrl ? `<img src="${g.pictureUrl}" style="width:100%;height:100%;object-fit:cover;">` : escapeHtml((g.subject || 'G')[0].toUpperCase());
  
  const btn = $('#addGroupBtn');
  btn.style.display = 'inline-block';
  if (g.configured) {
    btn.textContent = 'Agregado';
    btn.className = 'btn success-neon';
  } else {
    btn.textContent = '➕ Agregar';
    btn.className = 'btn';
  }
  
  const layout = $('.chat-layout');
  if (layout) layout.classList.add('show-chat');

  await loadMessages();
}

async function loadMessages() {
  if (!selectedGroup) return;
  const rows = await IbotApi.chatMessages(selectedGroup).catch(() => []);
  
  $('#messages').innerHTML = rows.map((m) => {
    const timeStr = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const senderMarkup = m.fromMe ? '' : `<div class="sender" style="color: var(--accent); font-weight: 700; font-size: 12px; margin-bottom: 4px;">${escapeHtml(m.senderName || m.senderId)}</div>`;
    
    return `
      <div class="bubble ${m.fromMe ? 'me' : ''}">
        ${senderMarkup}
        <div style="word-break: break-word; font-size: 15px;">${escapeHtml(m.preview || m.text || '')}</div>
        <div class="bubble-time">${timeStr}</div>
      </div>
    `;
  }).join('') || '<div class="empty-state">Sin mensajes en este chat.</div>';
  setTimeout(() => {
    const msgBox = $('#messages');
    if (msgBox) msgBox.scrollTop = msgBox.scrollHeight;
  }, 100);
}

/* Modal Helpers */
function openGroupConfigModal(groupId, config) {
  const modalEl = $('#modal');
  if (!modalEl) return;

  if (config) {
    // Edit configured group
    $('#field-groupId').value = groupId;
    $('#field-groupId-input').value = groupId;
    $('#field-groupId-input').disabled = true;
    $('#field-nombre').value = config.nombre || '';
    $('#field-grupo').value = config.grupo || 'detectados';
    $('#field-tipo').value = config.tipoMensaje || 'texto';
    $('#field-responder').value = config.responder ? '1' : '0';
    $('#field-duracion').value = String(config.duracion || 0);
    $('#field-respuesta').value = config.respuesta?.text || (typeof config.respuesta === 'string' ? config.respuesta : '');
    $('#field-independiente').checked = !!config.independiente;
    $('#field-limite').value = config.limite ?? '';
    $('#field-contador').value = config.contador ?? 0;
    $('#field-contador').dataset.original = $('#field-contador').value;
    $('#field-commands-enabled').checked = !!config.commandSettings?.enabled;
    $('#field-command-prefix').value = config.commandSettings?.prefix || '!';
    $('#field-welcome-message').value = config.commandSettings?.welcomeMessage || '¡Bienvenido/a {user} a {group}!';
    $('#field-farewell-message').value = config.commandSettings?.farewellMessage || '{user} ha salido de {group}.';
    $('#modalTitle').textContent = 'Editar configuración de grupo';
  } else {
    // Configure new group
    const g = groups.find((x) => x.groupId === groupId) || { groupId };
    $('#field-groupId').value = '';
    $('#field-groupId-input').value = groupId;
    $('#field-groupId-input').disabled = true;
    $('#field-nombre').value = g.subject || groupId;
    $('#field-grupo').value = 'detectados';
    $('#field-tipo').value = 'texto';
    $('#field-responder').value = '1';
    $('#field-duracion').value = '0';
    $('#field-respuesta').value = '';
    $('#field-independiente').checked = false;
    $('#field-limite').value = '';
    $('#field-contador').value = 0;
    delete $('#field-contador').dataset.original;
    $('#field-commands-enabled').checked = false;
    $('#field-command-prefix').value = '!';
    $('#field-welcome-message').value = '¡Bienvenido/a {user} a {group}!';
    $('#field-farewell-message').value = '{user} ha salido de {group}.';
    $('#modalTitle').textContent = 'Configurar nuevo grupo';
  }
  syncGroupCommandFields();
  modalEl.classList.add('show');
  modalEl.style.display = 'flex';
}

function syncGroupCommandFields() {
  const enabled = !!$('#field-commands-enabled')?.checked;
  const container = $('#group-command-fields');
  if (!container) return;
  container.classList.toggle('is-disabled', !enabled);
  container.querySelectorAll('input, textarea').forEach((input) => { input.disabled = !enabled; });
}

function closeModal() {
  const modalEl = $('#modal');
  if (modalEl) {
    modalEl.classList.remove('show');
    modalEl.style.display = 'none';
  }
}

function getFormPayload() {
  const payload = {
    groupId: ($('#field-groupId-input').value || $('#field-groupId').value || selectedGroup).trim(),
    nombre: $('#field-nombre').value.trim() || 'Sin nombre',
    grupo: $('#field-grupo').value.trim() || 'otros',
    tipoMensaje: $('#field-tipo').value,
    responder: $('#field-responder').value === '1',
    respuesta: { text: $('#field-respuesta').value || '' },
    duracion: Number($('#field-duracion').value) || 0,
    independiente: !!$('#field-independiente').checked,
    limite: $('#field-limite').value === '' ? null : Number($('#field-limite').value),
    commandSettings: {
      enabled: !!$('#field-commands-enabled').checked,
      prefix: $('#field-command-prefix').value.trim() || '!',
      welcomeMessage: $('#field-welcome-message').value.trim(),
      farewellMessage: $('#field-farewell-message').value.trim(),
    },
  };
  // El contador solo se envía en grupos nuevos o si el usuario lo cambió: el valor
  // cargado al abrir el formulario pisaría las respuestas registradas mientras tanto.
  const contador = $('#field-contador');
  if (contador.dataset.original === undefined || contador.value !== contador.dataset.original) {
    payload.contador = Number(contador.value || 0);
  }
  return payload;
}

async function saveForm(e) {
  e.preventDefault();
  const data = getFormPayload();
  const isEdit = !!$('#field-groupId').value;
  try {
    if (isEdit) {
      await IbotApi.updateGroup(data.groupId, data);
      toast('📝 Configuración actualizada');
    } else {
      await IbotApi.createGroup(data);
      toast('➕ Grupo configurado y agregado');
    }
    closeModal();
    await loadChats($('#chatSearch').value);
    await selectGroup(data.groupId);
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

async function handleGroupButtonClick() {
  if (!selectedGroup) return;
  const info = await IbotApi.chatInfo(selectedGroup).catch(() => ({ groupId: selectedGroup }));
  openGroupConfigModal(selectedGroup, info.configured || null);
}

function connectStreams() {
  if (chatSource) chatSource.close();
  if (logSource) logSource.close();
  try {
    chatSource = new EventSource(IbotApi.api('/events/chats'), { withCredentials: true });
    chatSource.addEventListener('message', (e) => { 
      const m = JSON.parse(e.data); 
      if (m.groupId === selectedGroup) loadMessages(); 
      loadChats($('#chatSearch').value); 
    });
    chatSource.addEventListener('group', () => loadChats($('#chatSearch').value));
    
    logSource = new EventSource(IbotApi.api('/logs/stream'), { withCredentials: true });
    // Refresh immediately when any log event fires via SSE
    logSource.addEventListener('log', () => { 
      if (activeTab === 'console') loadLogs(); 
    });
    // On SSE error/reconnect, force a manual refresh to avoid stale display
    logSource.addEventListener('error', () => {
      if (activeTab === 'console') loadLogs();
    });
  } catch (err) { 
    console.warn(err); 
  }
}

$('#field-commands-enabled')?.addEventListener('change', syncGroupCommandFields);
init();
