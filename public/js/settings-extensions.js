// Ajustes → Extensiones: herramientas externas (Todoist, …) que el
// administrador te permite. Cada una declara sus campos de configuración.
(() => {
  const container = $('#extensionList');
  if (!container) return;
  let extensions = [];

  function field(extension, spec) {
    const value = extension.config[spec.key];
    const id = `ext-${extension.id}-${spec.key}`;
    if (spec.type === 'toggle') {
      return `<div class="col-12"><label class="toggle-row"><span class="text">${escapeHtml(spec.label)}</span><span class="switch"><input type="checkbox" id="${id}" data-key="${spec.key}" ${value ? 'checked' : ''}><span></span></span></label></div>`;
    }
    if (spec.type === 'select') {
      return `<label class="field col-6">${escapeHtml(spec.label)}<select id="${id}" data-key="${spec.key}">${spec.options.map(([option, label]) => `<option value="${escapeHtml(option)}"${option === value ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>`;
    }
    if (spec.type === 'secret') {
      const saved = extension.config.tokenSet;
      return `<label class="field col-12">${escapeHtml(spec.label)}
        <input type="password" id="${id}" data-key="${spec.key}" autocomplete="off" placeholder="${saved ? '•••••••• (guardado; escribe otro para cambiarlo)' : 'Pega aquí el token'}">
        ${spec.help ? `<span class="hint">${escapeHtml(spec.help)}</span>` : ''}
      </label>`;
    }
    return `<label class="field col-6">${escapeHtml(spec.label)}<input id="${id}" data-key="${spec.key}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(spec.placeholder || '')}"></label>`;
  }

  function card(extension) {
    const status = !extension.configured ? ['', 'Sin configurar'] : extension.config.enabled ? ['good', 'Activa'] : ['warn', 'Pausada'];
    return `
      <form class="card" data-ext="${escapeHtml(extension.id)}">
        <div class="card-head">
          <div><div class="card-title">${escapeHtml(extension.name)}</div><div class="card-sub">${escapeHtml(extension.description)}</div></div>
          <div class="spacer"></div>
          <span class="pill ${status[0]}">${status[1]}</span>
        </div>
        <label class="toggle-row" style="margin-bottom:14px"><span class="text">Permitir que la IA use ${escapeHtml(extension.name)}</span><span class="switch"><input type="checkbox" data-key="enabled" ${extension.config.enabled ? 'checked' : ''}><span></span></span></label>
        <div class="form-grid">${extension.fields.map((spec) => field(extension, spec)).join('')}</div>
        ${extension.examples.length ? `<div class="info-box" style="margin-top:14px"><strong>Prueba en tu chat personal:</strong><br>${extension.examples.map((example) => `«${escapeHtml(example)}»`).join('<br>')}</div>` : ''}
        <div class="form-actions">
          ${extension.config.tokenSet ? '<button class="btn ghost" type="button" data-ext-clear>Borrar token</button>' : ''}
          <button class="btn" type="button" data-ext-test ${extension.configured ? '' : 'disabled'}>Probar conexión</button>
          <button class="btn primary" type="submit">Guardar</button>
        </div>
      </form>`;
  }

  function render() {
    const item = $('#extensionsItem');
    if (item) item.hidden = !extensions.length;
    container.innerHTML = extensions.length
      ? extensions.map(card).join('')
      : '<div class="card empty"><strong>Sin extensiones</strong>El administrador todavía no te ha habilitado ninguna.</div>';
    const active = extensions.filter((extension) => extension.configured && extension.config.enabled).map((extension) => extension.name);
    $('#sumExt').textContent = active.length ? `Activas: ${active.join(', ')}` : 'Herramientas externas para la IA';
  }

  async function save(form, extra = {}) {
    const body = { ...extra };
    form.querySelectorAll('[data-key]').forEach((input) => {
      if (input.type === 'checkbox') body[input.dataset.key] = input.checked;
      else if (input.type === 'password') { if (input.value.trim()) body[input.dataset.key] = input.value.trim(); }
      else body[input.dataset.key] = input.value;
    });
    const updated = await IbotApi.saveExtension(form.dataset.ext, body);
    extensions = extensions.map((extension) => (extension.id === updated.id ? updated : extension));
    render();
    return { updated, wantedEnabled: body.enabled === true };
  }

  container.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target.closest('form[data-ext]');
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const { updated, wantedEnabled } = await save(form);
      if (wantedEnabled && !updated.config.enabled) toast('Escribe el token para poder activarla');
      else toast(updated.config.enabled ? `✅ ${updated.name} activada` : `✅ ${updated.name} guardada`);
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });

  container.addEventListener('click', async (event) => {
    const form = event.target.closest('form[data-ext]');
    if (!form) return;
    if (event.target.closest('[data-ext-test]')) {
      const button = event.target.closest('[data-ext-test]');
      button.disabled = true;
      try {
        const result = await IbotApi.testExtension(form.dataset.ext);
        toast(`✅ ${result.detail}`);
      } catch (error) {
        toast(`❌ ${error.message}`);
      } finally {
        button.disabled = false;
      }
    }
    if (event.target.closest('[data-ext-clear]')) {
      const ok = await IbotDialog.confirm({ title: '¿Borrar el token?', text: 'La IA dejará de poder usar esta extensión.', confirmText: 'Borrar', danger: true });
      if (!ok) return;
      try {
        await save(form, { clearApiToken: true, enabled: false });
        toast('Token borrado');
      } catch (error) {
        toast(error.message);
      }
    }
  });

  IbotSettings.ready.then(async () => {
    extensions = await IbotApi.extensions();
    render();
  }).catch(() => null);
})();
