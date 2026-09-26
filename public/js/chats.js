// Chats: lista de grupos y contactos, conversación en vivo con imágenes y
// stickers, envío, programación, configuración de grupos e IA por chat.
(() => {
  const PAGE = 150;
  const state = { chats: [], type: '', query: '', active: null, messages: [], hasOlder: false, attachment: null, templates: null };
  const timeFormat = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' });
  const dayFormat = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  const shortDay = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short' });
  const MEDIA = { image: '📷 Foto', video: '🎬 Video', audio: '🎤 Audio', sticker: '🌟 Sticker', document: '📄 Documento', contact: '👤 Contacto', location: '📍 Ubicación' };
  const ORIGIN = { ia: 'IA', bot: 'Bot', panel: 'Panel', scheduled: 'Programado' };
  const svg = (d, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    addGroup: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>'),
    groupOk: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M16 11l2 2 4-4"/>'),
    save: svg('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
    aiAllow: svg('<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/>', 14),
    aiBlock: svg('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>', 14),
    self: svg('<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="4"/>', 14),
  };

  const isGroup = (chat) => (chat?.type || (String(chat?.groupId).endsWith('@g.us') ? 'group' : 'contact')) === 'group';
  const initials = (name) => escapeHtml(String(name || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase() || '?');
  const layout = $('#chatLayout');

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
      .sort((a, b) => (Number(!!b.isSelf) - Number(!!a.isSelf)) || ((b.lastMessageAt || 0) - (a.lastMessageAt || 0)));
  }

  function marks(chat) {
    const list = [];
    if (chat.isSelf) list.push(`<span title="Tu chat personal: aquí te atiende el asistente">${ICONS.self}</span>`);
    if (chat.ai?.access === 'allow') list.push(`<span class="ai-allow" title="La IA responde aquí">${ICONS.aiAllow}</span>`);
    if (chat.ai?.access === 'block') list.push(`<span class="ai-block" title="La IA nunca responde aquí">${ICONS.aiBlock}</span>`);
    return list.length ? `<span class="marks">${list.join('')}</span>` : '';
  }

  function renderList() {
    const rows = visibleChats();
    const container = $('#chatItems');
    $('#chatCount').textContent = state.chats.length ? String(state.chats.length) : '';
    if (!rows.length) {
      container.innerHTML = `<div class="empty"><strong>Sin chats</strong>${state.chats.length ? 'Nada coincide con el filtro.' : 'Aparecerán cuando tu WhatsApp reciba mensajes.'}</div>`;
      return;
    }
    container.innerHTML = rows.map((chat) => `
      <button type="button" class="chat-item${chat.groupId === state.active?.groupId ? ' active' : ''}" data-id="${escapeHtml(chat.groupId)}">
        ${avatar(chat)}
        <div class="main">
          <div class="row"><span class="name">${escapeHtml(chat.isSelf ? 'Tú (asistente)' : chat.subject || chat.groupId)}</span>${marks(chat)}<span class="time">${chat.lastMessageAt ? when(chat.lastMessageAt) : ''}</span></div>
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
  function mediaBody(message) {
    if (message.mediaType === 'image' && message.mediaId) {
      return `<img class="bubble-img" src="${IbotApi.mediaUrl(message.mediaId)}" alt="Imagen" loading="lazy" data-zoom>${message.text ? escapeHtml(message.text) : ''}`;
    }
    if (message.mediaType === 'sticker' && message.mediaId) {
      // Sin espacios entre etiquetas: la burbuja conserva los saltos de línea del texto.
      return `<img class="bubble-sticker" src="${IbotApi.mediaUrl(message.mediaId)}" alt="Sticker" loading="lazy">`
        + `<button class="btn sm icon save-sticker" type="button" data-save-sticker="${escapeHtml(message.mediaId)}" title="Guardar sticker" aria-label="Guardar sticker">${ICONS.save}</button>`;
    }
    const label = `<span class="media">${escapeHtml(MEDIA[message.mediaType] || 'Mensaje')}</span>`;
    return message.text ? `${label}\n${escapeHtml(message.text)}` : label;
  }

  function bubble(message, previous) {
    const date = new Date(message.ts);
    const separator = !previous || new Date(previous.ts).toDateString() !== date.toDateString()
      ? `<div class="day-sep">${escapeHtml(dayFormat.format(date))}</div>` : '';
    const who = isGroup(state.active) && !message.fromMe && message.senderName ? `<div class="who">${escapeHtml(message.senderName)}</div>` : '';
    const body = message.mediaType ? mediaBody(message) : escapeHtml(message.text);
    const sticker = message.mediaType === 'sticker' && message.mediaId;
    const origin = message.fromMe && ORIGIN[message.origin] ? `<span class="origin">${ORIGIN[message.origin]}</span>` : '';
    return `${separator}<div class="bubble${message.fromMe ? ' out' : ''}${sticker ? ' sticker' : ''}" data-msg="${escapeHtml(message.id)}">${who}${body}<div class="at">${origin}${timeFormat.format(date)}</div></div>`;
  }

  function renderMessages({ keepPosition = false } = {}) {
    const box = $('#messages');
    const previousHeight = box.scrollHeight;
    const older = state.hasOlder ? '<button class="btn sm older" type="button" id="loadOlder">Ver mensajes anteriores</button>' : '';
    box.innerHTML = state.messages.length
      ? older + state.messages.map((message, index) => bubble(message, state.messages[index - 1])).join('')
      : '<div class="empty">Aún no hay mensajes guardados en este chat.</div>';
    box.scrollTop = keepPosition ? box.scrollHeight - previousHeight : box.scrollHeight;
  }

  function renderHead() {
    const chat = state.active;
    $('#chatAvatar').outerHTML = avatar(chat).replace('class="avatar', 'id="chatAvatar" class="avatar');
    $('#chatTitle').textContent = chat.isSelf ? 'Tú (asistente personal)' : chat.subject || chat.groupId;
    $('#chatSub').textContent = isGroup(chat)
      ? `Grupo${chat.participantCount ? ` · ${chat.participantCount} participantes` : ''}${chat.configured ? ' · configurado' : ''}`
      : chat.isSelf ? 'Escríbele a la IA desde tu WhatsApp' : `+${chat.groupId.split('@')[0]}`;
    const groupBtn = $('#chatGroupBtn');
    if (groupBtn) {
      groupBtn.hidden = !isGroup(chat);
      groupBtn.innerHTML = chat.configured ? ICONS.groupOk : ICONS.addGroup;
      groupBtn.classList.toggle('done', !!chat.configured);
      groupBtn.title = chat.configured ? 'Editar la configuración del grupo' : 'Agregar a mis grupos configurados';
      groupBtn.setAttribute('aria-label', groupBtn.title);
    }
  }

  async function openChat(chatId) {
    const chat = state.chats.find((row) => row.groupId === chatId);
    if (!chat) return;
    state.active = chat;
    state.messages = [];
    renderList();
    layout.classList.add('viewing');
    document.body.classList.add('focus');
    $('#chatPlaceholder').hidden = true;
    $('#chatHead').hidden = false;
    $('#messages').hidden = false;
    const composer = $('#composer');
    if (composer) composer.hidden = false;
    clearAttachment();
    renderHead();
    if (location.hash !== `#${encodeURIComponent(chatId)}`) history.replaceState(null, '', `#${encodeURIComponent(chatId)}`);
    $('#messages').innerHTML = '<div class="empty">Cargando mensajes…</div>';
    try {
      const rows = await IbotApi.chatMessages(chatId);
      if (state.active?.groupId !== chatId) return;
      state.messages = rows;
      state.hasOlder = rows.length >= PAGE;
      renderMessages();
    } catch (error) {
      $('#messages').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  }

  async function loadOlder(button) {
    const chat = state.active;
    if (!chat || !state.messages.length) return;
    button.disabled = true;
    try {
      const rows = await IbotApi.chatMessages(chat.groupId, state.messages[0].ts);
      if (state.active !== chat) return;
      state.messages = [...rows, ...state.messages];
      state.hasOlder = rows.length >= PAGE;
      renderMessages({ keepPosition: true });
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  }

  function closeChat() {
    layout.classList.remove('viewing');
    document.body.classList.remove('focus');
    StickerPicker.close();
    history.replaceState(null, '', location.pathname);
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
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const previous = state.messages[state.messages.length - 1];
    state.messages.push(entry);
    box.querySelector('.empty')?.remove();
    box.insertAdjacentHTML('beforeend', bubble(entry, previous));
    if (atBottom || entry.fromMe) box.scrollTop = box.scrollHeight;
  }

  // La imagen o el sticker de un mensaje llega unos segundos después del texto.
  function onMedia({ id, groupId, mediaId }) {
    if (state.active?.groupId !== groupId) return;
    const message = state.messages.find((m) => m.id === id);
    if (!message) return;
    message.mediaId = mediaId;
    const node = $(`[data-msg="${CSS.escape(id)}"]`);
    if (!node) return;
    const index = state.messages.indexOf(message);
    const box = $('#messages');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    node.outerHTML = bubble(message, state.messages[index - 1]).replace(/^<div class="day-sep">.*?<\/div>/, '');
    if (atBottom) box.scrollTop = box.scrollHeight;
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
    source.addEventListener('media', (event) => onMedia(JSON.parse(event.data)));
  }

  // ─── Envío (texto, imagen y sticker) ─────────────────────────────────
  const text = $('#composerText');

  function clearAttachment() {
    state.attachment = null;
    const box = $('#composerAttachment');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    if (text) text.placeholder = 'Escribe un mensaje…';
  }

  function showAttachment(media, name) {
    state.attachment = media;
    const box = $('#composerAttachment');
    box.hidden = false;
    box.innerHTML = `<span class="attach-chip"><img src="${IbotApi.mediaUrl(media.id)}" alt=""><span class="name">${escapeHtml(name)}</span>
      <button class="btn ghost sm icon" type="button" data-detach aria-label="Quitar imagen">✕</button></span>`;
    text.placeholder = 'Agrega un texto a la imagen (opcional)…';
    text.focus();
  }

  async function send(payload) {
    const button = $('#composerSend');
    button.disabled = true;
    try {
      await IbotApi.sendChatMessage(state.active.groupId, payload);
      return true;
    } catch (error) {
      toast(error.message);
      return false;
    } finally {
      button.disabled = false;
    }
  }

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
    if (!state.active || (!message && !state.attachment)) return;
    const payload = state.attachment ? { mediaId: state.attachment.id, text: message } : { text: message };
    if (await send(payload)) {
      text.value = '';
      text.style.height = 'auto';
      clearAttachment();
    }
    text.focus();
  });
  $('#composerImage')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      showAttachment(await IbotApi.uploadMedia(file, 'image'), file.name);
    } catch (error) {
      toast(error.message);
    }
  });
  $('#composerAttachment')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-detach]')) clearAttachment();
  });
  $('#composerSticker')?.addEventListener('click', (event) => {
    StickerPicker.open(event.currentTarget, {
      onPick: async (sticker) => {
        if (await send({ stickerId: sticker.id })) toast('Sticker enviado');
      },
    });
  });

  // ─── Mensajes: ampliar imágenes, guardar stickers, anteriores ────────
  $('#messages').addEventListener('click', async (event) => {
    const older = event.target.closest('#loadOlder');
    if (older) return loadOlder(older);
    const zoom = event.target.closest('[data-zoom]');
    if (zoom) {
      $('#lightbox img').src = zoom.src;
      $('#lightbox').classList.add('open');
      return;
    }
    const save = event.target.closest('[data-save-sticker]');
    if (!save) return;
    const name = await IbotDialog.prompt({
      title: 'Guardar sticker',
      text: 'Dale un nombre: así lo encuentras y la IA sabe cuándo usarlo.',
      label: 'Nombre',
      placeholder: 'Ej.: risa, gracias, ok',
      confirmText: 'Guardar',
    });
    if (name === null) return;
    try {
      await IbotApi.saveSticker(save.dataset.saveSticker, name);
      StickerPicker.invalidate();
      toast('Sticker guardado en tu biblioteca');
    } catch (error) {
      toast(error.message);
    }
  });
  $('#lightbox').addEventListener('click', () => $('#lightbox').classList.remove('open'));

  // ─── Grupo, programar y ajustes del chat ─────────────────────────────
  $('#chatGroupBtn')?.addEventListener('click', async () => {
    const chat = state.active;
    if (!chat || !isGroup(chat)) return;
    const onSaved = async () => {
      chat.configured = true;
      await loadChats();
      state.active = state.chats.find((row) => row.groupId === chat.groupId) || chat;
      renderHead();
    };
    if (chat.configured) {
      try {
        const group = await IbotApi.request(IbotApi.api(`/grupos/${encodeURIComponent(chat.groupId)}`));
        GroupForm.open({ group, onSaved });
      } catch (error) {
        toast(error.message);
      }
      return;
    }
    GroupForm.open({ preset: { groupId: chat.groupId, nombre: chat.subject, grupo: 'detectados' }, title: 'Agregar grupo', onSaved });
  });

  $('#chatSchedule')?.addEventListener('click', () => {
    if (!state.active) return;
    ScheduleDialog.open({
      type: isGroup(state.active) ? 'group' : 'user',
      jid: state.active.groupId,
      name: state.active.subject || state.active.groupId,
    });
  });

  const settingsModal = $('#chatSettingsModal');

  function aiHint(chat, config) {
    if (chat.isSelf) return 'Tu chat personal usa el asistente (Ajustes → IA → Asistente personal).';
    const ia = config?.ia || {};
    if (isGroup(chat)) {
      const scope = { all: 'responde en todos los grupos', configured: 'responde solo en grupos activos en Grupos', selected: 'solo responde en los grupos que permitas aquí', none: 'no responde en grupos' };
      return `En general la IA ${scope[ia.groupScope] || ''}.`;
    }
    const scope = { all: 'responde en todos los chats privados', selected: 'solo responde en los chats privados que permitas aquí', none: 'no responde en chats privados' };
    return `En general la IA ${scope[ia.privateScope] || ''}.`;
  }

  $('#chatSettings').addEventListener('click', async () => {
    const chat = state.active;
    if (!chat) return;
    $('#csTitle').textContent = chat.isSelf ? 'Tu chat personal' : chat.subject || chat.groupId;
    $('#csSub').textContent = isGroup(chat) ? 'Grupo' : `Contacto · +${chat.groupId.split('@')[0]}`;
    if ($('#csAiAccess')) {
      $('#csAiAccess').value = chat.ai?.access || 'inherit';
      $('#csAiAccess').disabled = !!chat.isSelf;
      try {
        const [templates, config] = await Promise.all([
          state.templates || IbotApi.iaTemplates(),
          IbotApi.config(),
        ]);
        state.templates = templates;
        const general = templates.templates.find((template) => template.id === templates.defaultTemplateId);
        $('#csAiTemplate').innerHTML = `<option value="">General${general ? ` (${escapeHtml(general.name)})` : ''}</option>`
          + templates.templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join('');
        $('#csAiTemplate').value = chat.ai?.templateId || '';
        $('#csAiHint').textContent = aiHint(chat, config);
      } catch (error) {
        toast(error.message);
      }
    }
    settingsModal.classList.add('open');
  });

  settingsModal.addEventListener('click', (event) => {
    if (event.target === settingsModal || event.target.closest('[data-close]')) settingsModal.classList.remove('open');
  });

  $('#csSave')?.addEventListener('click', async () => {
    const chat = state.active;
    try {
      const rule = await IbotApi.setIaRule(chat.groupId, {
        access: $('#csAiAccess').value,
        templateId: $('#csAiTemplate').value || null,
        name: chat.subject,
      });
      chat.ai = { access: rule.access, templateId: rule.templateId };
      renderList();
      settingsModal.classList.remove('open');
      toast('Ajustes del chat guardados');
    } catch (error) {
      toast(error.message);
    }
  });

  $('#csCopyId').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.active.groupId);
      toast('Id copiado');
    } catch {
      toast(state.active.groupId);
    }
  });

  $('#csClear').addEventListener('click', async () => {
    const chat = state.active;
    const ok = await IbotDialog.confirm({
      title: '¿Vaciar este chat?',
      text: 'Se borran del panel sus mensajes, imágenes y stickers guardados. En WhatsApp no se borra nada.',
      confirmText: 'Vaciar',
      danger: true,
    });
    if (!ok) return;
    try {
      await IbotApi.clearChat(chat.groupId);
      settingsModal.classList.remove('open');
      chat.lastMessagePreview = '';
      state.messages = [];
      state.hasOlder = false;
      renderMessages();
      renderList();
      toast('Chat vaciado');
    } catch (error) {
      toast(error.message);
    }
  });

  // ─── Lista: eventos ──────────────────────────────────────────────────
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
  $('#chatBack').addEventListener('click', closeChat);
  // Una notificación puede abrir otro chat con la página ya abierta.
  window.addEventListener('hashchange', () => {
    const chatId = decodeURIComponent(location.hash.slice(1));
    if (chatId && chatId !== state.active?.groupId) openChat(chatId);
  });

  loadUserBot().catch(() => null);
  loadChats().then(() => {
    connectLive();
    // Abrir un chat desde una notificación (/chats.html#<id>).
    const fromHash = decodeURIComponent(location.hash.slice(1));
    if (fromHash) openChat(fromHash);
  });
})();
