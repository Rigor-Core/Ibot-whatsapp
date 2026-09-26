// Selector de stickers de la biblioteca (Chats y mensajes programados).
// En PC aparece junto al botón; en teléfono, como hoja inferior.
// eslint-disable-next-line no-unused-vars
const StickerPicker = (() => {
  let panel = null;
  let stickers = null;
  let onPick = null;
  let anchor = null;

  function position() {
    if (!panel || !anchor || window.matchMedia('(max-width: 640px)').matches) {
      panel.style.cssText = '';
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    const bottom = window.innerHeight - rect.top + 8;
    panel.style.cssText = `left:${left}px;bottom:${bottom}px;width:${width}px`;
  }

  function render() {
    const grid = panel.querySelector('.sticker-grid');
    if (!stickers) {
      grid.innerHTML = '<div class="empty">Cargando…</div>';
      return;
    }
    const tiles = stickers.map((sticker) => `
      <button type="button" class="sticker-tile" data-id="${escapeHtml(sticker.id)}" title="${escapeHtml(sticker.name)}">
        <img src="${IbotApi.mediaUrl(sticker.mediaId)}" alt="${escapeHtml(sticker.name)}" loading="lazy">
      </button>`).join('');
    grid.innerHTML = `${tiles}
      <label class="sticker-tile add" title="Subir un sticker">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        <input type="file" accept="image/*" hidden>
      </label>`;
    panel.querySelector('.sticker-empty').hidden = stickers.length > 0;
  }

  function build() {
    panel = document.createElement('div');
    panel.className = 'sticker-picker';
    panel.innerHTML = `
      <div class="sticker-picker-head"><strong>Stickers</strong><a href="/configuracion.html#stickers" class="hint">Administrar</a></div>
      <div class="hint sticker-empty" hidden>Guarda stickers desde un chat (toca uno recibido) o sube una imagen con +.</div>
      <div class="sticker-grid"></div>`;
    document.body.appendChild(panel);
    panel.addEventListener('click', (event) => {
      const tile = event.target.closest('.sticker-tile[data-id]');
      if (!tile) return;
      const sticker = stickers.find((item) => item.id === tile.dataset.id);
      close();
      if (sticker) onPick?.(sticker);
    });
    panel.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const sticker = await IbotApi.uploadSticker(file, file.name.replace(/\.[^.]+$/, ''));
        stickers = [sticker, ...(stickers || []).filter((item) => item.id !== sticker.id)];
        render();
        toast('Sticker guardado');
      } catch (error) {
        toast(error.message);
      }
    });
    document.addEventListener('pointerdown', (event) => {
      if (panel.classList.contains('open') && !panel.contains(event.target) && !anchor?.contains(event.target)) close();
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    window.addEventListener('resize', position);
  }

  function close() {
    panel?.classList.remove('open');
  }

  async function open(anchorEl, options = {}) {
    if (!panel) build();
    if (panel.classList.contains('open') && anchor === anchorEl) {
      close();
      return;
    }
    anchor = anchorEl;
    onPick = options.onPick;
    position();
    panel.classList.add('open');
    render();
    try {
      stickers = await IbotApi.stickers();
      render();
    } catch (error) {
      panel.querySelector('.sticker-grid').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  }

  // Tras guardar o borrar stickers en otra parte del panel.
  function invalidate() {
    stickers = null;
  }

  return { open, close, invalidate };
})();
