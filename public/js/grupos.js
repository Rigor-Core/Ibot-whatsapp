/* ===== GRUPOS.JS — lógica de la ventana de grupos ===== */

/* ---- Refs DOM ---- */
const categoriesEl = document.getElementById('categories');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');

/* Campos del formulario */
const fieldGroupIdHidden = document.getElementById('field-groupId');
const fieldGroupIdInput = document.getElementById('field-groupId-input');
const fieldNombre = document.getElementById('field-nombre');
const fieldGrupo = document.getElementById('field-grupo');
const fieldTipo = document.getElementById('field-tipo');
const fieldResponder = document.getElementById('field-responder');
const fieldDuracion = document.getElementById('field-duracion');
const fieldRespuesta = document.getElementById('field-respuesta');
const fieldIndependiente = document.getElementById('field-independiente');
const fieldLimite = document.getElementById('field-limite');
const fieldContador = document.getElementById('field-contador');
const fieldCommandsEnabled = document.getElementById('field-commands-enabled');
const fieldCommandPrefix = document.getElementById('field-command-prefix');
const fieldWelcomeMessage = document.getElementById('field-welcome-message');
const fieldFarewellMessage = document.getElementById('field-farewell-message');
const groupCommandFields = document.getElementById('group-command-fields');

/* Estado local */
let groups = [];
let currentConfig = null;

/* ---- Orden de grupos — dos niveles (categorías + grupos dentro) ---- */
function _getGroupOrder() {
  return currentConfig?.groupOrder || [];
}
function _getCatOrder() {
  return currentConfig?.categoryOrder || [];
}

function _applyGroupOrder(arr) {
  const catOrder   = _getCatOrder();
  const groupOrder = _getGroupOrder();

  // Agrupar por categoría
  const catMap = new Map();
  for (const g of arr) {
    const cat = g.grupo || 'otros';
    if (!catMap.has(cat)) catMap.set(cat, []);
    catMap.get(cat).push(g);
  }

  // Ordenar categorías según catOrder
  const orderedCats = [];
  const catMapCopy = new Map(catMap);
  for (const c of catOrder) { if (catMapCopy.has(c)) { orderedCats.push(c); catMapCopy.delete(c); } }
  for (const c of catMapCopy.keys()) orderedCats.push(c);

  // Aplanar respetando orden de grupos dentro de cada categoría
  const result = [];
  for (const cat of orderedCats) {
    const catGroups = catMap.get(cat) || [];
    if (!groupOrder.length) { result.push(...catGroups); continue; }
    const gmap = new Map(catGroups.map(g => [g.groupId, g]));
    for (const id of groupOrder) { if (gmap.has(id)) { result.push(gmap.get(id)); gmap.delete(id); } }
    for (const g of gmap.values()) result.push(g);
  }
  return result;
}

/* ---- Utilidades de UI ---- */
function setRespBtn(btn, isOn) {
  btn.classList.toggle('resp-on', isOn);
  btn.classList.toggle('resp-off', !isOn);
  btn.setAttribute('aria-pressed', String(isOn));
  btn.textContent = isOn ? 'Respuestas: ON' : 'Respuestas: OFF';
}

function showEmpty(msg) {
  categoriesEl.innerHTML = `<div class="empty-state">${msg}</div>`;
}

function syncCommandFields() {
  const enabled = !!fieldCommandsEnabled.checked;
  groupCommandFields.classList.toggle('is-disabled', !enabled);
  for (const input of groupCommandFields.querySelectorAll('input, textarea')) input.disabled = !enabled;
}

/* ---- Carga principal ---- */
async function loadGroups() {
  try {
    await loadUserBot();
    const [data, config] = await Promise.all([
      IbotApi.groups(),
      IbotApi.config().catch(() => null),
    ]);

    currentConfig = config;
    groups = Array.isArray(data) ? _applyGroupOrder(data) : [];

    const respBtn = document.getElementById('btn-toggle-nonind');
    if (respBtn) setRespBtn(respBtn, !!currentConfig?.respuestas);

    renderGroups();
  } catch (err) {
    console.error('[grupos] loadGroups error:', err);
    showEmpty(`Error al cargar grupos: ${err.message}`);
    toast(err.message);
  }
}

/* ---- Render de la tabla ---- */
function renderGroups() {
  categoriesEl.innerHTML = '';

  /* Cabecera global */
  const globalHeader = document.createElement('div');
  globalHeader.className = 'global-table-headers';
  globalHeader.innerHTML = `
    <div>Nombre</div>
    <div style="text-align:center">Tipo</div>
    <div style="text-align:center">Contador</div>
    <div style="text-align:center">Responder</div>
    <div style="text-align:right">Acciones</div>
  `;
  categoriesEl.appendChild(globalHeader);

  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No hay grupos configurados todavía. Usa ➕ Nuevo grupo para añadir uno.';
    categoriesEl.appendChild(empty);
    return;
  }

  /* Agrupar por categoría */
  const map = new Map();
  for (const g of groups) {
    const cat = g.grupo || 'otros';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(g);
  }

  for (const [cat, arr] of map.entries()) {
    const catCard = document.createElement('div');
    catCard.className = 'category-card';

    /* Columna lateral (categoría + conteo) */
    const leftCol = document.createElement('div');
    leftCol.className = 'category-left-col';
    const titleEl = document.createElement('div');
    titleEl.className = 'category-title-text';
    titleEl.textContent = cat;
    const countEl = document.createElement('div');
    countEl.className = 'category-count';
    countEl.textContent = String(arr.length);
    leftCol.appendChild(titleEl);
    leftCol.appendChild(countEl);

    /* Área de filas */
    const rightArea = document.createElement('div');
    rightArea.className = 'category-rows-area';

    for (const g of arr) {
      const row = document.createElement('div');
      row.className = 'group-row-table' + (g.responder ? ' active' : '');

      /* Col: nombre (sin groupId visible en tabla) */
      const nameCol = document.createElement('div');
      nameCol.className = 'col-name';
      const titleDiv = document.createElement('div');
      titleDiv.className = 'title';
      titleDiv.textContent = g.nombre || 'Sin nombre';
      nameCol.appendChild(titleDiv);

      /* Col: tipo */
      const tipoCol = document.createElement('div');
      tipoCol.className = 'col-center';
      tipoCol.textContent = g.tipoMensaje || 'texto';

      /* Col: contador/estado */
      const cntCol = document.createElement('div');
      cntCol.className = 'col-center';
      if (g.independiente) {
        const limite = parseInt(g.limite, 10) || 0;
        const contador = parseInt(g.contador, 10) || 0;
        const span = document.createElement('div');
        span.className = limite ? '' : 'muted small';
        span.textContent = `${contador}/${limite || '∞'}`;
        cntCol.appendChild(span);
      } else {
        const badge = document.createElement('div');
        badge.className = g.responder ? 'badge-on' : 'badge-off';
        badge.textContent = g.responder ? 'Global ON' : 'Global OFF';
        cntCol.appendChild(badge);
      }

      /* Col: botón toggle responder */
      const respCol = document.createElement('div');
      respCol.className = 'col-center';
      const btnToggle = document.createElement('button');
      btnToggle.type = 'button';
      btnToggle.className = 'btn shortss' + (g.responder ? ' active' : '') + (g.independiente ? ' ind' : '');
      btnToggle.textContent = g.responder ? 'Desactivar' : 'Activar';
      btnToggle.setAttribute('aria-pressed', g.responder ? 'true' : 'false');
      btnToggle.addEventListener('click', () => toggleResponder(g.groupId));
      respCol.appendChild(btnToggle);

      /* Col: acciones */
      const actionsCol = document.createElement('div');
      actionsCol.className = 'controls';

      const groupCommandsEnabled = !!g.commandSettings?.enabled;
      const globalCommandsEnabled = !!currentConfig?.adminCommands?.enabled;
      const btnCommands = document.createElement('button');
      btnCommands.type = 'button';
      btnCommands.className = `btn-icon command-state ${
        groupCommandsEnabled && globalCommandsEnabled
          ? 'commands-on'
          : (groupCommandsEnabled ? 'commands-standby' : 'commands-off')
      }`;
      btnCommands.title = groupCommandsEnabled
        ? (globalCommandsEnabled ? 'Comandos activos en este grupo' : 'Grupo habilitado; comandos globales apagados')
        : 'Comandos desactivados en este grupo';
      btnCommands.textContent = '⌘';
      btnCommands.setAttribute('aria-label', btnCommands.title);
      btnCommands.setAttribute('aria-pressed', String(groupCommandsEnabled));
      btnCommands.addEventListener('click', () => toggleGroupCommands(g.groupId));
      actionsCol.appendChild(btnCommands);

      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn-icon edit';
      btnEdit.title = 'Editar';
      btnEdit.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
      btnEdit.addEventListener('click', () => openEdit(g));
      actionsCol.appendChild(btnEdit);

      if (g.independiente) {
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'btn-icon reset';
        resetBtn.title = 'Reiniciar contador';
        resetBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>`;
        resetBtn.addEventListener('click', () => resetGroupCounter(g.groupId));
        actionsCol.appendChild(resetBtn);
      }

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'btn-icon del';
      btnDel.title = 'Eliminar grupo';
      btnDel.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
      btnDel.addEventListener('click', () => deleteGroupConfirm(g.groupId));
      actionsCol.appendChild(btnDel);

      row.appendChild(nameCol);
      row.appendChild(tipoCol);
      row.appendChild(cntCol);
      row.appendChild(respCol);
      row.appendChild(actionsCol);
      rightArea.appendChild(row);
    }

    /* Barra de añadir dentro de categoría */
    const addBar = document.createElement('div');
    addBar.className = 'add-row-bar';
    addBar.textContent = `+ Añadir en "${cat}"`;
    addBar.addEventListener('click', () => openNewForCategory(cat));
    rightArea.appendChild(addBar);

    catCard.appendChild(leftCol);
    catCard.appendChild(rightArea);
    categoriesEl.appendChild(catCard);
  }
}

/* ---- Modal ---- */
function openModal() {
  modal.style.display = 'flex';
  // Foco en el primer campo editable
  setTimeout(() => fieldGroupIdInput.focus(), 50);
}

function closeModal() {
  modal.style.display = 'none';
}

function openNewForCategory(cat = 'otros') {
  fieldGroupIdHidden.value = '';
  fieldGroupIdInput.value = '';
  fieldGroupIdInput.disabled = false;
  fieldNombre.value = '';
  fieldGrupo.value = cat;
  fieldTipo.value = 'texto';
  fieldResponder.value = '1';
  fieldDuracion.value = '0';
  fieldRespuesta.value = '';
  fieldIndependiente.checked = false;
  fieldLimite.value = '';
  fieldContador.value = '0';
  fieldCommandsEnabled.checked = false;
  fieldCommandPrefix.value = '!';
  fieldWelcomeMessage.value = '¡Bienvenido/a {user} a {group}!';
  fieldFarewellMessage.value = '{user} ha salido de {group}.';
  syncCommandFields();
  modalTitle.textContent = 'Nuevo grupo';
  openModal();
}

function openEdit(g) {
  fieldGroupIdHidden.value = g.groupId;
  fieldGroupIdInput.value = g.groupId;
  fieldGroupIdInput.disabled = true;
  fieldNombre.value = g.nombre || '';
  fieldGrupo.value = g.grupo || 'otros';
  fieldTipo.value = g.tipoMensaje || 'texto';
  fieldResponder.value = g.responder ? '1' : '0';
  fieldDuracion.value = String(g.duracion || 0);
  fieldRespuesta.value = g.respuesta?.text || (typeof g.respuesta === 'string' ? g.respuesta : '');
  fieldIndependiente.checked = !!g.independiente;
  fieldLimite.value = g.limite ?? '';
  fieldContador.value = g.contador ?? 0;
  fieldCommandsEnabled.checked = !!g.commandSettings?.enabled;
  fieldCommandPrefix.value = g.commandSettings?.prefix || '!';
  fieldWelcomeMessage.value = g.commandSettings?.welcomeMessage || '¡Bienvenido/a {user} a {group}!';
  fieldFarewellMessage.value = g.commandSettings?.farewellMessage || '{user} ha salido de {group}.';
  syncCommandFields();
  modalTitle.textContent = 'Editar grupo';
  openModal();
}

function buildPayload() {
  return {
    groupId: (fieldGroupIdInput.value || fieldGroupIdHidden.value).trim(),
    nombre: fieldNombre.value.trim() || 'Sin nombre',
    grupo: fieldGrupo.value.trim() || 'otros',
    tipoMensaje: fieldTipo.value,
    responder: fieldResponder.value === '1',
    respuesta: { text: fieldRespuesta.value || '' },
    duracion: Number(fieldDuracion.value) || 0,
    independiente: !!fieldIndependiente.checked,
    limite: fieldLimite.value === '' ? null : Number(fieldLimite.value),
    contador: Number(fieldContador.value || 0),
    commandSettings: {
      enabled: !!fieldCommandsEnabled.checked,
      prefix: fieldCommandPrefix.value.trim() || '!',
      welcomeMessage: fieldWelcomeMessage.value.trim(),
      farewellMessage: fieldFarewellMessage.value.trim(),
    },
  };
}

/* ---- Guardar formulario ---- */
async function saveForm(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save');
  const prevText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  try {
    const body = buildPayload();
    if (!body.groupId) throw new Error('El GroupId es obligatorio');
    if (fieldGroupIdHidden.value) {
      // Editar
      await IbotApi.updateGroup(fieldGroupIdHidden.value, body);
    } else {
      // Crear
      await IbotApi.createGroup(body);
    }
    closeModal();
    toast('✅ Grupo guardado correctamente');
    await loadGroups();
  } catch (err) {
    console.error('[grupos] saveForm error:', err);
    toast('❌ ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = prevText;
  }
}

/* ---- Eliminar grupo ---- */
async function deleteGroupConfirm(groupId) {
  if (!confirm(`¿Borrar el grupo "${groupId}"?`)) return;
  try {
    await IbotApi.deleteGroup(groupId);
    toast('🗑️ Grupo eliminado');
    await loadGroups();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

/* ---- Reiniciar contador ---- */
async function resetGroupCounter(groupId) {
  try {
    await IbotApi.resetGroup(groupId);
    toast('🔄 Contador reiniciado');
    await loadGroups();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

/* ---- Toggle responder (individual) ---- */
async function toggleResponder(groupId) {
  const g = groups.find((x) => x.groupId === groupId);
  if (!g) return;
  const newVal = !g.responder;
  // Optimistic UI
  g.responder = newVal;
  renderGroups();
  try {
    await IbotApi.updateGroup(groupId, {
      ...g,
      responder: newVal,
      contador: g.independiente && newVal ? 0 : g.contador,
    });
    await loadGroups();
  } catch (err) {
    g.responder = !newVal;
    renderGroups();
    toast('❌ ' + err.message);
  }
}

async function toggleGroupCommands(groupId) {
  try {
    await IbotApi.toggleGroupCommands(groupId);
    await loadGroups();
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

/* ---- Toggle grupos independientes ---- */
async function toggleIndependentGroups() {
  const btn = document.getElementById('btn-toggle-ind');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    await IbotApi.toggleIndependent();
    toast('✅ Grupos independientes actualizados');
    await loadGroups();
  } catch (err) {
    toast('❌ ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Independientes'; }
  }
}

/* ---- Toggle respuestas globales ---- */
async function toggleGlobalResponses() {
  const btn = document.getElementById('btn-toggle-nonind');
  if (!btn) return;
  const wasOn = btn.classList.contains('resp-on');
  setRespBtn(btn, !wasOn);
  try {
    await IbotApi.toggleRespuestas();
    await loadGroups();
  } catch (err) {
    setRespBtn(btn, wasOn);
    toast('❌ ' + err.message);
  }
}

/* ---- Cerrar modal al clicar fuera ---- */
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

/* ---- Tecla Escape cierra modal ---- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal.style.display === 'flex') closeModal();
});

/* ---- Bind de eventos ---- */
function bind() {
  bindPanelLogout();

  document.getElementById('btn-new').addEventListener('click', () => openNewForCategory('otros'));
  document.getElementById('btn-refresh').addEventListener('click', () => loadGroups());
  document.getElementById('btn-toggle-ind').addEventListener('click', toggleIndependentGroups);
  document.getElementById('btn-toggle-nonind').addEventListener('click', toggleGlobalResponses);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('form').addEventListener('submit', saveForm);
  fieldCommandsEnabled.addEventListener('change', syncCommandFields);
}

/* ---- Arranque ---- */
bind();
loadGroups();
