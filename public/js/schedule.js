// Ventana para programar un mensaje a un grupo o contacto (Chats y Contactos).
// eslint-disable-next-line no-unused-vars
const ScheduleDialog = (() => {
  let timeZone = null;
  let target = null;
  let onDone = null;
  let modal = null;
  // Adjunto opcional: { type: 'image' | 'sticker', mediaId, name }
  let attachment = null;
  const ATTACH_ICONS = {
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    sticker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/></svg>',
  };

  const REPEAT_LABELS = { none: 'Una sola vez', daily: 'Todos los días', weekdays: 'Lunes a viernes', weekly: 'Cada semana' };

  function localParts(date) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  }

  function setWhen(date, time) {
    modal.querySelector('#sdDate').value = date;
    modal.querySelector('#sdTime').value = time;
  }

  // Atajos calculados en la zona horaria de la cuenta.
  const PRESETS = {
    hour() {
      const p = localParts(new Date(Date.now() + 60 * 60 * 1000));
      setWhen(`${p.year}-${p.month}-${p.day}`, `${p.hour}:${p.minute}`);
    },
    tonight() {
      const p = localParts(new Date());
      const later = Number(p.hour) >= 20 ? localParts(new Date(Date.now() + 24 * 60 * 60 * 1000)) : p;
      setWhen(`${later.year}-${later.month}-${later.day}`, '20:00');
    },
    tomorrow() {
      const p = localParts(new Date(Date.now() + 24 * 60 * 60 * 1000));
      setWhen(`${p.year}-${p.month}-${p.day}`, '09:00');
    },
  };

  function build() {
    modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <form class="modal-card" role="dialog" aria-modal="true" aria-labelledby="sdTitle">
        <div class="modal-title" id="sdTitle">Programar mensaje</div>
        <div class="modal-sub" id="sdTarget"></div>
        <div class="form-grid">
          <label class="field col-12">Mensaje
            <textarea id="sdMessage" maxlength="4000" placeholder="Escribe el mensaje que se enviará…"></textarea>
          </label>
          <div class="col-12" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <label class="btn sm" title="Adjuntar una imagen">${ATTACH_ICONS.image}<span>Imagen</span><input type="file" id="sdImage" accept="image/*" hidden></label>
            <button class="btn sm" type="button" id="sdSticker" title="Elegir un sticker">${ATTACH_ICONS.sticker}<span>Sticker</span></button>
            <div id="sdAttachment"></div>
          </div>
          <div class="col-12">
            <div class="section-label">Cuándo</div>
            <div class="segmented" id="sdPresets">
              <button type="button" data-preset="hour">En 1 hora</button>
              <button type="button" data-preset="tonight">Hoy 20:00</button>
              <button type="button" data-preset="tomorrow">Mañana 9:00</button>
            </div>
          </div>
          <label class="field col-6">Día<input id="sdDate" type="date" required></label>
          <label class="field col-6">Hora<input id="sdTime" type="time" step="60" required></label>
          <label class="field col-12">Repetir
            <select id="sdRepeat">${Object.entries(REPEAT_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>
          </label>
          <div class="col-12 hint" id="sdZone"></div>
        </div>
        <div class="form-actions">
          <button class="btn ghost" type="button" data-close>Cancelar</button>
          <button class="btn primary" type="submit" id="sdSave">Programar</button>
        </div>
      </form>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('[data-close]')) close();
      const preset = event.target.closest('[data-preset]');
      if (preset) PRESETS[preset.dataset.preset]();
      if (event.target.closest('[data-detach]')) setAttachment(null);
    });
    modal.querySelector('#sdImage').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const media = await IbotApi.uploadMedia(file, 'image');
        setAttachment({ type: 'image', mediaId: media.id, name: file.name });
      } catch (error) {
        toast(error.message);
      }
    });
    modal.querySelector('#sdSticker').addEventListener('click', (event) => {
      StickerPicker.open(event.currentTarget, {
        onPick: (sticker) => setAttachment({ type: 'sticker', mediaId: sticker.mediaId, name: sticker.name }),
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.classList.contains('open')) close();
    });
    modal.querySelector('form').addEventListener('submit', submit);
  }

  function setAttachment(next) {
    attachment = next;
    const box = modal.querySelector('#sdAttachment');
    box.innerHTML = attachment ? `
      <span class="attach-chip ${attachment.type}">
        <img src="${IbotApi.mediaUrl(attachment.mediaId)}" alt="">
        <span class="name">${escapeHtml(attachment.type === 'sticker' ? `Sticker: ${attachment.name}` : attachment.name)}</span>
        <button class="btn ghost sm icon" type="button" data-detach aria-label="Quitar adjunto">✕</button>
      </span>` : '';
    modal.querySelector('#sdMessage').placeholder = attachment?.type === 'image'
      ? 'Texto de la imagen (opcional)…'
      : attachment ? 'Texto que se enviará después del sticker (opcional)…' : 'Escribe el mensaje que se enviará…';
  }

  function close() {
    modal.classList.remove('open');
    StickerPicker.close();
    target = null;
  }

  async function submit(event) {
    event.preventDefault();
    const button = modal.querySelector('#sdSave');
    button.disabled = true;
    try {
      const message = modal.querySelector('#sdMessage').value.trim();
      if (!message && !attachment) throw new Error('Escribe un mensaje o adjunta una imagen o un sticker');
      const scheduled = await IbotApi.scheduleMessage({
        target,
        message,
        media: attachment ? { type: attachment.type, mediaId: attachment.mediaId } : null,
        localDate: modal.querySelector('#sdDate').value,
        localTime: modal.querySelector('#sdTime').value,
        repeat: modal.querySelector('#sdRepeat').value,
      });
      close();
      toast('✅ Mensaje programado');
      onDone?.(scheduled);
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function open(nextTarget, { onScheduled } = {}) {
    if (!modal) build();
    if (!timeZone) timeZone = (await IbotApi.config().catch(() => null))?.timezone || 'America/Hermosillo';
    target = nextTarget;
    onDone = onScheduled;
    modal.querySelector('#sdTarget').textContent = `${nextTarget.type === 'group' ? 'Grupo' : 'Contacto'}: ${nextTarget.name}`;
    modal.querySelector('#sdZone').textContent = `Hora de ${timeZone}.`;
    modal.querySelector('#sdMessage').value = '';
    setAttachment(null);
    modal.querySelector('#sdRepeat').value = 'none';
    const today = localParts(new Date());
    modal.querySelector('#sdDate').min = `${today.year}-${today.month}-${today.day}`;
    PRESETS.hour();
    modal.classList.add('open');
    setTimeout(() => modal.querySelector('#sdMessage').focus(), 30);
  }

  return { open, REPEAT_LABELS };
})();
