// Formulario para crear o editar un grupo configurado. Lo comparten Grupos
// (vista clásica y moderna) y Chats. En la vista clásica usa la ventana de
// components.js; en las demás crea una con el diseño del panel.
// eslint-disable-next-line no-unused-vars
const GroupForm = (() => {
  const DEFAULT_WELCOME = '¡Bienvenido/a {user} a {group}!';
  const DEFAULT_FAREWELL = '{user} ha salido de {group}.';
  let onSaved = null;
  let bound = false;

  const el = (id) => document.getElementById(id);
  const classic = () => !!el('modal');

  function buildModern() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'groupFormModal';
    modal.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle" style="max-width:640px">
        <div class="modal-title" id="modalTitle">Nuevo grupo</div>
        <div class="modal-sub">Cómo responde el bot en este grupo.</div>
        <form id="form">
          <input type="hidden" id="field-groupId">
          <div class="form-grid">
            <label class="field col-12">Id del grupo<input id="field-groupId-input" placeholder="120363…@g.us"></label>
            <label class="field col-6">Nombre<input id="field-nombre" placeholder="Nombre descriptivo"></label>
            <label class="field col-6">Categoría<input id="field-grupo" list="groupCategories" placeholder="otros"><datalist id="groupCategories"></datalist></label>
            <label class="field col-4">Tipo de mensaje
              <select id="field-tipo"><option value="texto">Texto</option><option value="imagen">Imagen</option><option value="ambas">Ambas</option></select>
            </label>
            <label class="field col-4">Responder
              <select id="field-responder"><option value="1">Sí</option><option value="0">No</option></select>
            </label>
            <label class="field col-4">Mensajes temporales
              <select id="field-duracion"><option value="0">Desactivado</option><option value="86400">24 horas</option><option value="604800">7 días</option><option value="7776000">90 días</option></select>
            </label>
            <label class="field col-12">Mensaje que envía el bot<textarea id="field-respuesta" placeholder="Escribe la respuesta…" style="min-height:80px"></textarea></label>
          </div>
          <details class="form-more">
            <summary class="section-label">Límites e independencia</summary>
            <div class="form-grid">
              <div class="col-12"><label class="toggle-row"><span class="text">Grupo independiente<small>Responde aunque las respuestas globales estén apagadas, hasta su límite.</small></span><span class="switch"><input type="checkbox" id="field-independiente"><span></span></span></label></div>
              <label class="field col-6">Límite de mensajes (vacío = sin límite)<input id="field-limite" type="number" min="0" placeholder="Ej: 3"></label>
              <label class="field col-6">Contador<input id="field-contador" type="number" min="0" value="0"></label>
            </div>
          </details>
          <details class="form-more">
            <summary class="section-label">Comandos, bienvenida y despedida</summary>
            <div class="form-grid">
              <div class="col-12"><label class="toggle-row"><span class="text">Activar comandos y eventos</span><span class="switch"><input type="checkbox" id="field-commands-enabled"><span></span></span></label></div>
              <div class="col-12 form-grid" id="group-command-fields">
                <label class="field col-4">Prefijo<input id="field-command-prefix" maxlength="4" placeholder="!"></label>
                <div class="col-8 hint" style="align-self:end;padding-bottom:10px">Ejemplo: <strong>!help</strong>. Variables: {user} y {group}.</div>
                <label class="field col-6">Bienvenida<textarea id="field-welcome-message" rows="3" style="min-height:70px"></textarea></label>
                <label class="field col-6">Despedida<textarea id="field-farewell-message" rows="3" style="min-height:70px"></textarea></label>
              </div>
            </div>
          </details>
          <div class="form-actions">
            <button type="button" id="btn-cancel" class="btn ghost">Cancelar</button>
            <button type="submit" id="btn-save" class="btn primary">Guardar</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  function modal() {
    return el('modal') || el('groupFormModal') || buildModern();
  }

  function syncCommandFields() {
    const enabled = !!el('field-commands-enabled').checked;
    const container = el('group-command-fields');
    container.classList.toggle('is-disabled', !enabled);
    for (const input of container.querySelectorAll('input, textarea')) input.disabled = !enabled;
  }

  function show() {
    const box = modal();
    if (classic()) box.style.display = 'flex';
    else box.classList.add('open');
    // Foco en el primer campo editable
    setTimeout(() => (el('field-groupId-input').disabled ? el('field-nombre') : el('field-groupId-input')).focus(), 50);
  }

  function close() {
    const box = modal();
    if (classic()) box.style.display = 'none';
    else box.classList.remove('open');
  }

  const isOpen = () => (classic() ? modal().style.display === 'flex' : modal().classList.contains('open'));

  function fill(group, preset = {}) {
    el('field-groupId').value = group?.groupId || '';
    el('field-groupId-input').value = group?.groupId || preset.groupId || '';
    el('field-groupId-input').disabled = !!(group || preset.groupId);
    el('field-nombre').value = group ? (group.nombre || '') : (preset.nombre || '');
    el('field-grupo').value = group ? (group.grupo || 'otros') : (preset.grupo || 'otros');
    el('field-tipo').value = group?.tipoMensaje || 'texto';
    el('field-responder').value = !group || group.responder ? '1' : '0';
    el('field-duracion').value = String(group?.duracion || 0);
    el('field-respuesta').value = group?.respuesta?.text || (typeof group?.respuesta === 'string' ? group.respuesta : '');
    el('field-independiente').checked = !!group?.independiente;
    el('field-limite').value = group?.limite ?? '';
    el('field-contador').value = group?.contador ?? 0;
    // El contador solo se envía en grupos nuevos o si el usuario lo cambió.
    if (group) el('field-contador').dataset.original = el('field-contador').value;
    else delete el('field-contador').dataset.original;
    el('field-commands-enabled').checked = !!group?.commandSettings?.enabled;
    el('field-command-prefix').value = group?.commandSettings?.prefix || '!';
    el('field-welcome-message').value = group?.commandSettings?.welcomeMessage || DEFAULT_WELCOME;
    el('field-farewell-message').value = group?.commandSettings?.farewellMessage || DEFAULT_FAREWELL;
    syncCommandFields();
  }

  function buildPayload() {
    const payload = {
      groupId: (el('field-groupId-input').value || el('field-groupId').value).trim(),
      nombre: el('field-nombre').value.trim() || 'Sin nombre',
      grupo: el('field-grupo').value.trim() || 'otros',
      tipoMensaje: el('field-tipo').value,
      responder: el('field-responder').value === '1',
      respuesta: { text: el('field-respuesta').value || '' },
      duracion: Number(el('field-duracion').value) || 0,
      independiente: !!el('field-independiente').checked,
      limite: el('field-limite').value === '' ? null : Number(el('field-limite').value),
      commandSettings: {
        enabled: !!el('field-commands-enabled').checked,
        prefix: el('field-command-prefix').value.trim() || '!',
        welcomeMessage: el('field-welcome-message').value.trim(),
        farewellMessage: el('field-farewell-message').value.trim(),
      },
    };
    const contador = el('field-contador');
    if (contador.dataset.original === undefined || contador.value !== contador.dataset.original) {
      payload.contador = Number(contador.value || 0);
    }
    return payload;
  }

  async function save(event) {
    event.preventDefault();
    const btn = el('btn-save');
    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      const body = buildPayload();
      if (!body.groupId) throw new Error('El GroupId es obligatorio');
      const editing = el('field-groupId').value;
      if (editing) await IbotApi.updateGroup(editing, body);
      else await IbotApi.createGroup(body);
      close();
      toast('✅ Grupo guardado correctamente');
      await onSaved?.(body);
    } catch (err) {
      toast('❌ ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = prevText;
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    const box = modal();
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });
    el('btn-cancel').addEventListener('click', close);
    el('form').addEventListener('submit', save);
    el('field-commands-enabled').addEventListener('change', syncCommandFields);
  }

  // group: grupo configurado a editar. preset: datos para uno nuevo
  // ({ groupId, nombre, grupo }); si trae groupId no se puede cambiar.
  async function open({ group = null, preset = {}, title, onSaved: callback } = {}) {
    bind();
    onSaved = callback;
    fill(group, preset);
    el('modalTitle').textContent = title || (group ? 'Editar grupo' : 'Nuevo grupo');
    show();
    const list = el('groupCategories');
    if (list && !list.options.length) {
      IbotApi.categories().then((cats) => { list.innerHTML = cats.map((cat) => `<option value="${escapeHtml(cat)}">`).join(''); }).catch(() => null);
    }
  }

  return { open, close };
})();
