// Chats: lista de grupos y contactos, conversación en vivo, envío y programación.
(() => {
  const state = { chats: [], type: '', query: '', active: null, messages: [] };
  const timeFormat = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' });
  const dayFormat = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  const shortDay = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short' });
  const MEDIA = { image: '📷 Foto', video: '🎬 Video', audio: '🎤 Audio', sticker: '🌟 Sticker', document: '📄 Documento', contact: '👤 Contacto', location: '📍 Ubicación' };

  const isGroup = (chat) => (chat?.type || (String(chat?.groupId).endsWith('@g.us') ? 'group' : 'contact')) === 'group';
  const initials = (name) => escapeHtml(String(name || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase() || '?');

  function when(ts) {
    const date = new Date(ts);
    return date.toDateString() === new Date().toDateString() ? timeFormat.format(date) : shortDay.format(date);
  }

  function avatar(chat) {
    const pic = chat.pictureUrl ? `<img src="${escapeHtml(chat.pictureUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : initials(chat.subject);
    return `<div class="avatar${isGroup(chat) ? ' group' : ''}">${pic}</div>`;
  }

  // ─── Lista ───────────────────────────────────────────────────────────
  function visibleChats() {
    const query = state.query.toLowerCase();
    return state.chats
      .filter((chat) => !state.type || (state.type === 'group') === isGroup(chat))
      .filter((chat) => !query || `${chat.subject} ${chat.groupId}`.toLowerCase().includes(query))
      .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  }

  function renderList() {
    const rows = visibleChats();
    const container = $('#chatItems');
    if (!rows.length) {
      container.innerHTML = `<div class="empty"><strong>Sin chats</strong>${state.chats.length ? 'Nada coincide con el filtro.' : 'Los chats aparecerán cuando tu WhatsApp reciba mensajes.'}</div>`;
      return;
    }
    container.innerHTML = rows.map((chat) => `
      <button type="button" class="chat-item${chat.groupId === state.active?.groupId ? ' active' : ''}" data-id="${escapeHtml(chat.groupId)}">
        ${avatar(chat)}
        <div class="main">
          <div class="row"><span class="name">${escapeHtml(chat.subject || chat.groupId)}</span><span class="time">${chat.lastMessageAt ? when(chat.lastMessageAt) : ''}</span></div>
          <div class="preview">${escapeHtml(chat.lastMessagePreview || (isGroup(chat) ? 'Grupo' : 'Contacto'))}</div>
        </div>
      </button>`).join('');
  }

  async function loadChats() {
    try {
      state.chats = await IbotApi.chatGroups();
      renderList();
    } catch (error) {
      $('#chatItems').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  }

  // ─── Conversación ────────────────────────────────────────────────────
  function bubble(message, previous) {
    const date = new Date(message.ts);
    const separator = !previous || new Date(previous.ts).toDateString() !== date.toDateString()
      ? `<div class="day-sep">${escapeHtml(dayFormat.format(date))}</div>` : '';
    const who = isGroup(state.active) && !message.fromMe && message.senderName ? `<div class="who">${escapeHtml(message.senderName)}</div>` : '';
    const body = message.text
      ? escapeHtml(message.text)
      : `<span class="media">${escapeHtml(MEDIA[message.mediaType] || 'Mensaje')}</span>`;
    return `${separator}<div class="bubble${message.fromMe ? ' out' : ''}">${who}${body}<div class="at">${timeFormat.format(date)}</div></div>`;
  }

  function renderMessages() {
    const box = $('#messages');
    box.innerHTML = state.messages.length
      ? state.messages.map((message, index) => bubble(message, state.messages[index - 1])).join('')
      : '<div class="empty">Aún no hay mensajes guardados en este chat.</div>';
    box.scrollTop = box.scrollHeight;
  }

  async function openChat(chatId) {
    const chat = state.chats.find((row) => row.groupId === chatId);
    if (!chat) return;
    state.active = chat;
    renderList();
    $('#chatLayout').classList.add('viewing');
    $('#chatPlaceholder').hidden = true;
    $('#chatHead').hidden = false;
    $('#messages').hidden = false;
    const composer = $('#composer');
    if (composer) composer.hidden = false;
    $('#chatAvatar').outerHTML = avatar(chat).replace('class="avatar', 'id="chatAvatar" class="avatar');
    $('#chatTitle').textContent = chat.subject || chat.groupId;
    $('#chatSub').textContent = isGroup(chat)
      ? `Grupo${chat.participantCount ? ` · ${chat.participantCount} participantes` : ''}${chat.configured ? ' · configurado' : ''}`
      : `Contacto · +${chat.groupId.split('@')[0]}`;
    $('#messages').innerHTML = '<div class="empty">Cargando mensajes…</div>';
    try {
      state.messages = await IbotApi.chatMessages(chatId);
      if (state.active?.groupId === chatId) renderMessages();
    } catch (error) {
      $('#messages').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  }

  // ─── Tiempo real ─────────────────────────────────────────────────────
  function onMessage(entry) {
    let chat = state.chats.find((row) => row.groupId === entry.groupId);
    if (!chat) {
      chat = { groupId: entry.groupId, type: entry.type, subject: entry.groupName };
      state.chats.push(chat);
    }
    chat.lastMessageAt = entry.ts;
    chat.lastMessagePreview = entry.preview;
    renderList();
    if (state.active?.groupId !== entry.groupId || state.messages.some((m) => m.id === entry.id)) return;
    const box = $('#messages');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    const previous = state.messages[state.messages.length - 1];
    state.messages.push(entry);
    box.querySelector('.empty')?.remove();
    box.insertAdjacentHTML('beforeend', bubble(entry, previous));
    if (atBottom || entry.fromMe) box.scrollTop = box.scrollHeight;
  }

  function onGroup(group) {
    const chat = state.chats.find((row) => row.groupId === group.groupId);
    if (!chat) return;
    if (group.pictureUrl) chat.pictureUrl = group.pictureUrl;
    if (group.participantCount) chat.participantCount = group.participantCount;
    if (isGroup(chat) && group.subject && !chat.configured) chat.subject = group.subject;
  }

  function connectLive() {
    const source = new EventSource(IbotApi.api('/events/chats'), { withCredentials: true });
    source.addEventListener('message', (event) => onMessage(JSON.parse(event.data)));
    source.addEventListener('group', (event) => onGroup(JSON.parse(event.data)));
  }

  // ─── Eventos ─────────────────────────────────────────────────────────
  $('#chatItems').addEventListener('click', (event) => {
    const item = event.target.closest('.chat-item');
    if (item) openChat(item.dataset.id);
  });
  $('#chatFilter').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-type]');
    if (!button) return;
    state.type = button.dataset.type;
    $('#chatFilter').querySelectorAll('button').forEach((el) => el.classList.toggle('active', el === button));
    renderList();
  });
  $('#chatSearch').addEventListener('input', (event) => {
    state.query = event.target.value.trim();
    renderList();
  });
  $('#chatBack').addEventListener('click', () => $('#chatLayout').classList.remove('viewing'));
  $('#chatSchedule')?.addEventListener('click', () => {
    if (!state.active) return;
    ScheduleDialog.open({
      type: isGroup(state.active) ? 'group' : 'user',
      jid: state.active.groupId,
      name: state.active.subject || state.active.groupId,
    });
  });

  const text = $('#composerText');
  text?.addEventListener('input', () => {
    text.style.height = 'auto';
    text.style.height = `${Math.min(text.scrollHeight, 140)}px`;
  });
  text?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !window.matchMedia('(max-width: 640px)').matches) {
      event.preventDefault();
      $('#composer').requestSubmit();
    }
  });
  $('#composer')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = text.value.trim();
    if (!message || !state.active) return;
    const button = $('#composerSend');
    button.disabled = true;
    try {
      await IbotApi.sendChatMessage(state.active.groupId, message);
      text.value = '';
      text.style.height = 'auto';
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      text.focus();
    }
  });

  loadUserBot().catch(() => null);
  loadChats().then(connectLive);
})();
