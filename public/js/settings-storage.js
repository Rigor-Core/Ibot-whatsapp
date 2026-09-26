// Ajustes → Almacenamiento (qué se guarda, borrado automático y vaciado) y
// Stickers (biblioteca).
(() => {
  const RETENTION_LABELS = { 0: 'sin borrado automático', 1: 'borra tras 1 día', 3: 'borra tras 3 días', 7: 'borra tras 7 días', 15: 'borra tras 15 días', 30: 'borra tras 30 días', 90: 'borra tras 90 días', 180: 'borra tras 6 meses', 365: 'borra tras 1 año' };
  const numberFormat = new Intl.NumberFormat('es');
  const chatNames = new Map();
  let excluded = [];
  let retentionChats = [];

  const size = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);

  function renderUsage(usage) {
    $('#storageUsage').innerHTML = [
      ['Mensajes', numberFormat.format(usage.messages), `${numberFormat.format(usage.groupMessages)} de grupos`],
      ['Chats', numberFormat.format(usage.chats), 'grupos y contactos'],
      ['Imágenes', numberFormat.format(usage.images.count), size(usage.images.bytes)],
      ['Stickers', numberFormat.format(usage.stickers.count), `${usage.library} en tu biblioteca`],
    ].map(([label, value, hint]) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="hint">${hint}</div></div>`).join('');
  }

  function renderChips(target, ids, onRemove, onAdd) {
    target.innerHTML = ids.map((id) => `<span class="chip" data-id="${escapeHtml(id)}"><span>${escapeHtml(chatNames.get(id) || id)}</span><button type="button" aria-label="Quitar">✕</button></span>`).join('')
      + '<button class="chip add" type="button">+ Agregar chat</button>';
    target.onclick = async (event) => {
      const remove = event.target.closest('.chip[data-id] button');
      if (remove) return onRemove(remove.closest('.chip').dataset.id);
      if (!event.target.closest('.chip.add')) return;
      const picked = await IbotSettings.pickChats({ title: 'Elegir chats', selected: ids }).catch((error) => { toast(error.message); return null; });
      if (!picked) return;
      picked.forEach((chat) => chatNames.set(chat.id, chat.name));
      onAdd(picked.map((chat) => chat.id));
    };
  }

  function paintChips() {
    renderChips($('#stExcluded'), excluded, (id) => { excluded = excluded.filter((item) => item !== id); paintChips(); }, (ids) => { excluded = ids; paintChips(); });
    renderChips($('#stRetentionChats'), retentionChats, (id) => { retentionChats = retentionChats.filter((item) => item !== id); paintChips(); }, (ids) => { retentionChats = ids; paintChips(); });
  }

  function syncRetentionFields() {
    const off = $('#stRetention').value === '0';
    $('#stRetentionScope').disabled = off;
    $('#stRetentionChatsField').hidden = off || $('#stRetentionScope').value !== 'selected';
  }

  function fill(storage) {
    $('#stSaveText').checked = storage.saveText;
    $('#stSaveImages').checked = storage.saveImages;
    $('#stSaveStickers').checked = storage.saveStickers;
    $('#stRetention').value = String(storage.retentionDays);
    $('#stRetentionScope').value = storage.retentionScope;
    excluded = [...storage.excludedChats];
    retentionChats = [...storage.retentionChats];
    syncRetentionFields();
    paintChips();
    const saving = [storage.saveText && 'textos', storage.saveImages && 'imágenes', storage.saveStickers && 'stickers'].filter(Boolean);
    $('#sumStorage').textContent = `${saving.length ? `Guarda ${saving.join(', ')}` : 'No guarda mensajes'} · ${RETENTION_LABELS[storage.retentionDays]}`;
  }

  $('#stRetention').addEventListener('change', syncRetentionFields);
  $('#stRetentionScope').addEventListener('change', syncRetentionFields);

  $('#stSave').addEventListener('click', (event) => {
    if ($('#stRetentionScope').value === 'selected' && $('#stRetention').value !== '0' && !retentionChats.length) {
      toast('Elige al menos un chat para el borrado automático');
      return;
    }
    IbotSettings.save({
      storage: {
        saveText: $('#stSaveText').checked,
        saveImages: $('#stSaveImages').checked,
        saveStickers: $('#stSaveStickers').checked,
        excludedChats: excluded,
        retentionDays: Number($('#stRetention').value),
        retentionScope: $('#stRetentionScope').value,
        retentionChats,
      },
    }, event.currentTarget, 'Almacenamiento guardado').catch(() => null);
  });

  $('#clRun').addEventListener('click', async () => {
    const scope = $('#clScope').value;
    const age = Number($('#clAge').value);
    const mediaOnly = $('#clWhat').value === 'media';
    const scopes = { all: 'todos los chats', groups: 'los grupos', contacts: 'los contactos' };
    const ok = await IbotDialog.confirm({
      title: mediaOnly ? '¿Borrar imágenes y stickers?' : '¿Vaciar los chats?',
      text: `Se borrará${mediaOnly ? 'n las imágenes y stickers' : 'n los mensajes'} de ${scopes[scope]}${age ? ` con más de ${age} días` : ''}. No se puede deshacer.`,
      confirmText: 'Vaciar',
      danger: true,
    });
    if (!ok) return;
    try {
      const result = await IbotApi.clearStorage({ scope, olderThanDays: age, mediaOnly });
      renderUsage(result.usage);
      toast(mediaOnly ? `Se borraron ${result.media} archivo(s)` : `Se borraron ${numberFormat.format(result.messages)} mensaje(s)`);
    } catch (error) {
      toast(error.message);
    }
  });

  // ─── Stickers ────────────────────────────────────────────────────────
  async function loadLibrary() {
    const box = $('#stickerLibrary');
    try {
      const stickers = await IbotApi.stickers();
      box.innerHTML = stickers.length ? stickers.map((sticker) => `
        <div class="sticker-card" data-id="${escapeHtml(sticker.id)}">
          <img src="${IbotApi.mediaUrl(sticker.mediaId)}" alt="${escapeHtml(sticker.name)}" loading="lazy">
          <div class="name" title="${escapeHtml(sticker.name)}">${escapeHtml(sticker.name)}</div>
          <div class="actions">
            <button class="btn sm ghost" type="button" data-rename>Renombrar</button>
            <button class="btn sm ghost icon" type="button" data-remove title="Borrar" aria-label="Borrar">✕</button>
          </div>
        </div>`).join('') : '<div class="empty" style="grid-column:1/-1"><strong>Tu biblioteca está vacía</strong>Guarda stickers desde Chats o súbelos aquí.</div>';
    } catch (error) {
      box.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  }

  $('#stickerLibrary').addEventListener('click', async (event) => {
    const cardEl = event.target.closest('.sticker-card');
    if (!cardEl) return;
    const id = cardEl.dataset.id;
    const current = cardEl.querySelector('.name').textContent;
    try {
      if (event.target.closest('[data-rename]')) {
        const name = await IbotDialog.prompt({ title: 'Renombrar sticker', label: 'Nombre', value: current, confirmText: 'Guardar' });
        if (!name) return;
        await IbotApi.renameSticker(id, name);
        cardEl.querySelector('.name').textContent = name;
        toast('Sticker renombrado');
      }
      if (event.target.closest('[data-remove]')) {
        const ok = await IbotDialog.confirm({ title: `¿Borrar «${current}»?`, text: 'Se quita de tu biblioteca.', confirmText: 'Borrar', danger: true });
        if (!ok) return;
        await IbotApi.deleteSticker(id);
        await loadLibrary();
        toast('Sticker borrado');
      }
    } catch (error) {
      toast(error.message);
    }
  });

  $('#stickerUpload').addEventListener('change', async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    let saved = 0;
    for (const file of files) {
      try {
        await IbotApi.uploadSticker(file, file.name.replace(/\.[^.]+$/, ''));
        saved += 1;
      } catch (error) {
        toast(`${file.name}: ${error.message}`);
      }
    }
    if (saved) {
      toast(`${saved} sticker(s) guardado(s)`);
      loadLibrary();
    }
  });

  // Los datos se piden al abrir cada sección, no al cargar Ajustes.
  document.addEventListener('settings:show', async (event) => {
    if (event.detail === 'stickers') loadLibrary();
    if (event.detail === 'almacenamiento') {
      try {
        const [data, chats] = await Promise.all([IbotApi.storage(), IbotApi.chatGroups().catch(() => [])]);
        chats.forEach((chat) => chatNames.set(chat.groupId, chat.subject || chat.groupId));
        renderUsage(data.usage);
        fill(data.config);
      } catch (error) {
        toast(error.message);
      }
    }
  });

  IbotSettings.onConfig((config) => fill(config.storage));
})();
