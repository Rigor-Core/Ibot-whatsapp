/* ===== GRUPOS.JS — lógica de la ventana de grupos =====
   La comparten la vista clásica (grupos-clasico.js) y la moderna
   (grupos-moderno.js); cada vista define window.GroupsView. */
const view = window.GroupsView;

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

/* ---- Acciones que usa la vista ---- */
const actions = {
  toggleResponder: (groupId) => toggleResponder(groupId),
  toggleGroupCommands: (groupId) => toggleGroupCommands(groupId),
  edit: (g) => GroupForm.open({ group: g, onSaved: loadGroups }),
  add: (cat = 'otros') => GroupForm.open({ preset: { grupo: cat }, onSaved: loadGroups }),
  reset: (groupId) => resetGroupCounter(groupId),
  remove: (groupId) => deleteGroupConfirm(groupId),
};

function renderGroups() {
  // Sin permiso de gestionar grupos solo se ven, sin botones de acción.
  const canManage = userPermissions()?.features.manageGroups !== false;
  view.render({ groups, config: currentConfig, canManage, actions });
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
    view.setAnswers(!!currentConfig?.respuestas);
    renderGroups();
  } catch (err) {
    console.error('[grupos] loadGroups error:', err);
    view.showEmpty(`Error al cargar grupos: ${err.message}`);
    toast(err.message);
  }
}

/* ---- Eliminar grupo ---- */
async function deleteGroupConfirm(groupId) {
  if (!(await view.confirmDelete(groupId))) return;
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
    // Al reactivar un grupo independiente su contador se reinicia; en los demás
    // casos no se envía para no pisar el contador real con el de la pantalla.
    const body = { ...g, responder: newVal };
    if (g.independiente && newVal) body.contador = 0;
    else delete body.contador;
    await IbotApi.updateGroup(groupId, body);
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
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    await IbotApi.toggleIndependent();
    toast('✅ Grupos independientes actualizados');
    await loadGroups();
  } catch (err) {
    toast('❌ ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = label; }
  }
}

/* ---- Toggle respuestas globales ---- */
async function toggleGlobalResponses() {
  const wasOn = !!currentConfig?.respuestas;
  if (currentConfig) currentConfig.respuestas = !wasOn;
  view.setAnswers(!wasOn);
  try {
    await IbotApi.toggleRespuestas();
    await loadGroups();
  } catch (err) {
    if (currentConfig) currentConfig.respuestas = wasOn;
    view.setAnswers(wasOn);
    toast('❌ ' + err.message);
  }
}

/* ---- Bind de eventos ---- */
function bind() {
  bindPanelLogout();
  document.getElementById('btn-new')?.addEventListener('click', () => actions.add('otros'));
  document.getElementById('btn-refresh').addEventListener('click', () => loadGroups());
  document.getElementById('btn-toggle-ind')?.addEventListener('click', toggleIndependentGroups);
  document.getElementById('btn-toggle-nonind').addEventListener('click', toggleGlobalResponses);
}

/* ---- Cambios en vivo ---- */
const LIVE_FIELDS = ['nombre', 'grupo', 'tipoMensaje', 'responder', 'independiente', 'limite', 'contador', 'commandSettings'];

// Aplica contadores y estados que cambian mientras el bot trabaja, sin recargar la página.
function applyLiveGroups({ status, groups: liveGroups }) {
  if (currentConfig) {
    currentConfig.respuestas = !!status?.respuestas;
    view.setAnswers(currentConfig.respuestas);
  }
  if (!Array.isArray(liveGroups)) return;
  const byId = new Map(liveGroups.map((g) => [g.groupId, g]));
  if (byId.size !== groups.length || groups.some((g) => !byId.has(g.groupId))) {
    loadGroups();
    return;
  }
  let changed = false;
  for (const g of groups) {
    const live = byId.get(g.groupId);
    for (const field of LIVE_FIELDS) {
      if (JSON.stringify(g[field]) !== JSON.stringify(live[field])) {
        g[field] = live[field];
        changed = true;
      }
    }
  }
  if (changed) renderGroups();
}

/* ---- Arranque ---- */
bind();
loadGroups().then(() => subscribeLive(applyLiveGroups));
