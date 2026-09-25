let current = null;

async function load() {
  bindPanelLogout();
  await loadUserBot();
  current = await IbotApi.config();
  $('#modo').value = current.modo || 'normal';
  
  const respEl = $('#respuestas');
  if (respEl) respEl.checked = !!current.respuestas;

  $('#globalLimit').value = current.normal?.globalLimit ?? 1;
  $('#filterEnabled').checked = current.normal?.filterEnabled !== false;
  $('#timezone').value = current.timezone || 'America/Hermosillo';
  
  const ia = current.ia || {};
  $('#iaEnabled').value = String(ia.enabled === true);
  $('#iaModel').value = String(ia.model || '').startsWith('glm-') ? 'deepseek-chat' : (ia.model || 'deepseek-chat');
  $('#iaBaseUrl').value = ia.baseUrl?.includes('api.z.ai') ? 'https://dipisik.rigorcore.com/v1' : (ia.baseUrl || 'https://dipisik.rigorcore.com/v1');
  $('#iaApiKey').value = '';
  $('#iaTemperature').value = ia.temperature ?? 0.6;
  $('#iaMaxTokens').value = ia.maxTokens ?? 500;
  $('#iaCommandMode').value = ia.commandMode || 'required';
  $('#iaCommands').value = (ia.commands || ['/chat', '/gpt']).join(',');
  $('#iaCooldown').value = ia.perGroupCooldownMs ?? 3000;
  $('#iaSystemPrompt').value = ia.systemPrompt || '';
  $('#iaFallback').value = ia.fallbackText || '';
  $('#iaOnlyConfigured').checked = ia.onlyConfiguredGroups !== false;
  $('#iaIgnoreMedia').checked = ia.ignoreMedia !== false;

  // Populate groups dropdown for connection notifications
  const userGroups = await IbotApi.groups().catch(() => []);
  const selectGroup = $('#connNotifyGroup');
  if (selectGroup) {
    selectGroup.innerHTML = '<option value="">Selecciona un grupo...</option>' + 
      userGroups.map(g => `<option value="${escapeHtml(g.groupId)}">${escapeHtml(g.nombre || g.groupId)}</option>`).join('');
  }

  const connNotify = current.connectionNotification || {};
  $('#connNotifyEnabled').checked = !!connNotify.enabled;
  $('#connNotifyGroup').value = connNotify.groupId || '';
  $('#connNotifyMessage').value = connNotify.message || '';

  // Cargar orden de grupos
  await loadGroupOrder(userGroups);
}

function payload() {
  const apiKey = $('#iaApiKey').value.trim();
  const ia = {
    enabled: $('#iaEnabled').value === 'true',
    provider: 'deepseek-compatible',
    model: $('#iaModel').value.trim() || 'deepseek-chat',
    baseUrl: $('#iaBaseUrl').value.trim() || 'https://dipisik.rigorcore.com/v1',
    temperature: Number($('#iaTemperature').value || 0.6),
    maxTokens: Number($('#iaMaxTokens').value || 500),
    commandMode: $('#iaCommandMode').value,
    commands: $('#iaCommands').value.split(',').map((s) => s.trim()).filter(Boolean),
    perGroupCooldownMs: Number($('#iaCooldown').value || 0),
    systemPrompt: $('#iaSystemPrompt').value,
    fallbackText: $('#iaFallback').value,
    onlyConfiguredGroups: $('#iaOnlyConfigured').checked,
    ignoreMedia: $('#iaIgnoreMedia').checked,
  };
  if (apiKey) ia.apiKey = apiKey;

  const respEl = $('#respuestas');
  const respuestasVal = respEl ? respEl.checked : (current ? !!current.respuestas : false);

  const connectionNotification = {
    enabled: $('#connNotifyEnabled').checked,
    groupId: $('#connNotifyGroup').value,
    message: $('#connNotifyMessage').value.trim()
  };

  return { 
    modo: $('#modo').value, 
    respuestas: respuestasVal, 
    normal: { 
      globalLimit: Number($('#globalLimit').value || 0), 
      filterEnabled: $('#filterEnabled').checked 
    }, 
    ia,
    connectionNotification,
    timezone: $('#timezone').value,
  };
}

async function save() {
  try { 
    await IbotApi.saveConfig(payload()); 
    toast('Configuración guardada'); 
    await load(); 
  } catch (e) { 
    toast(e.message); 
  }
}

const saveMain = $('#saveMain');
if (saveMain) saveMain.onclick = save;

const saveAll = $('#saveAll');
if (saveAll) saveAll.onclick = save;

const saveConnNotify = $('#saveConnNotify');
if (saveConnNotify) saveConnNotify.onclick = save;

const testConnNotify = $('#testConnNotify');
if (testConnNotify) {
  testConnNotify.onclick = async () => {
    const groupId = $('#connNotifyGroup').value;
    const message = $('#connNotifyMessage').value.trim();
    if (!groupId) {
      toast('⚠️ Selecciona un grupo destinatario primero.');
      return;
    }
    if (!message) {
      toast('⚠️ Escribe un mensaje de prueba.');
      return;
    }
    try {
      toast('Enviando mensaje de prueba...');
      const res = await IbotApi.testConnNotification({ groupId, message });
      if (res.ok) {
        toast('✅ Mensaje de prueba enviado con éxito');
      } else {
        toast('❌ Error: ' + (res.error || 'No se pudo enviar'));
      }
    } catch (e) {
      toast('❌ Error: ' + e.message);
    }
  };
}

const reloadBtn = $('#reloadBtn');
if (reloadBtn) reloadBtn.onclick = load;

/* ══════════════════════════════════════════════
   ORDEN DE GRUPOS — Dos niveles: categorías + grupos
══════════════════════════════════════════════ */

/* ---- Helpers de almacenamiento (ahora leen de la BD mediante la config del bot) ---- */
function getStoredGroupOrder() {
  return current?.groupOrder || [];
}
function getStoredCatOrder() {
  return current?.categoryOrder || [];
}

/* ---- Aplicar orden completo (categorías + grupos dentro) ---- */
function applyOrderToGroups(groups) {
  const catOrder   = getStoredCatOrder();
  const groupOrder = getStoredGroupOrder();

  // Agrupar por categoría
  const catMap = new Map();
  for (const g of groups) {
    const cat = g.grupo || 'otros';
    if (!catMap.has(cat)) catMap.set(cat, []);
    catMap.get(cat).push(g);
  }

  // Ordenar categorías
  const orderedCats = [];
  for (const c of catOrder) { if (catMap.has(c)) { orderedCats.push(c); catMap.delete(c); } }
  for (const c of catMap.keys()) orderedCats.push(c);

  // Ordenar grupos dentro de cada categoría y aplanar
  const result = [];
  for (const cat of orderedCats) {
    const arr = catMap.has(cat)
      ? catMap.get(cat)           // resto sin orden guardado
      : (() => {
          // reconstruir desde catMap original (ya borrado), lo tenemos en groups filtrado
          return groups.filter(g => (g.grupo || 'otros') === cat);
        })();

    if (!groupOrder.length) { result.push(...arr); continue; }
    const gmap = new Map(arr.map(g => [g.groupId, g]));
    for (const id of groupOrder) { if (gmap.has(id)) { result.push(gmap.get(id)); gmap.delete(id); } }
    for (const g of gmap.values()) result.push(g);
  }
  return result;
}

// Exponer para que grupos.js pueda usarlo
window.ibotGroupOrder = { getStoredGroupOrder, getStoredCatOrder, applyOrderToGroups };

/* ---- Estado del editor de orden ---- */
// _catData = [ { name, groups: [grupo,...] }, ... ]
let _catData = [];

async function loadGroupOrder(preloadedGroups) {
  const listEl = $('#orderList');
  if (!listEl) return;

  const groups = preloadedGroups || await IbotApi.groups().catch(() => []);

  // Construir mapa cat → grupos
  const catMap = new Map();
  for (const g of groups) {
    const cat = g.grupo || 'otros';
    if (!catMap.has(cat)) catMap.set(cat, []);
    catMap.get(cat).push(g);
  }

  // Ordenar grupos dentro de cada categoría según order guardado
  const groupOrder = getStoredGroupOrder();
  for (const [cat, arr] of catMap.entries()) {
    if (!groupOrder.length) continue;
    const gmap = new Map(arr.map(g => [g.groupId, g]));
    const sorted = [];
    for (const id of groupOrder) { if (gmap.has(id)) { sorted.push(gmap.get(id)); gmap.delete(id); } }
    for (const g of gmap.values()) sorted.push(g);
    catMap.set(cat, sorted);
  }

  // Ordenar categorías
  const catOrder = getStoredCatOrder();
  const orderedCats = [];
  const catMapCopy = new Map(catMap);
  for (const c of catOrder) { if (catMapCopy.has(c)) { orderedCats.push(c); catMapCopy.delete(c); } }
  for (const c of catMapCopy.keys()) orderedCats.push(c);

  _catData = orderedCats.map(name => ({ name, groups: catMap.get(name) || [] }));

  renderOrderList();
}

/* ---- Drag state compartido entre niveles ---- */
let _dragType = null; // 'cat' | 'group'
let _dragCatIdx = null;
let _dragGroupIdx = null;

function renderOrderList() {
  const listEl = $('#orderList');
  if (!listEl) return;

  if (!_catData.length) {
    listEl.innerHTML = '<div class="order-empty">No hay grupos configurados todavía.</div>';
    return;
  }

  listEl.innerHTML = '';

  _catData.forEach((catEntry, ci) => {
    const block = document.createElement('div');
    block.className = 'order-cat-block';
    block.dataset.ci = String(ci);

    /* ── Cabecera de categoría ── */
    const header = document.createElement('div');
    header.className = 'order-cat-header';
    header.draggable = true;
    header.innerHTML = `
      <span class="order-cat-handle">⠿</span>
      <span class="order-cat-num">${ci + 1}</span>
      <span class="order-cat-name">${escapeHtml(catEntry.name)}</span>
      <span class="order-cat-count">${catEntry.groups.length} grupo${catEntry.groups.length !== 1 ? 's' : ''}</span>
      <div class="order-cat-arrows">
        <button class="btn-arrow-cat" data-dir="up" title="Subir categoría">▲</button>
        <button class="btn-arrow-cat" data-dir="down" title="Bajar categoría">▼</button>
      </div>
    `;

    // Flechas de categoría
    header.querySelectorAll('.btn-arrow-cat').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const dir = btn.dataset.dir;
        if (dir === 'up' && ci > 0) {
          [_catData[ci - 1], _catData[ci]] = [_catData[ci], _catData[ci - 1]];
        } else if (dir === 'down' && ci < _catData.length - 1) {
          [_catData[ci], _catData[ci + 1]] = [_catData[ci + 1], _catData[ci]];
        }
        renderOrderList();
      });
    });

    // Drag categoría
    header.addEventListener('dragstart', e => {
      _dragType = 'cat'; _dragCatIdx = ci;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'cat:' + ci);
      setTimeout(() => header.classList.add('dragging'), 0);
    });
    header.addEventListener('dragend', () => {
      header.classList.remove('dragging');
      document.querySelectorAll('.order-cat-block').forEach(b => b.classList.remove('drag-over-cat'));
    });

    // Drop zona: bloque completo de la categoría destino
    block.addEventListener('dragover', e => {
      if (_dragType !== 'cat') return;
      e.preventDefault();
      block.classList.add('drag-over-cat');
    });
    block.addEventListener('dragleave', () => block.classList.remove('drag-over-cat'));
    block.addEventListener('drop', e => {
      if (_dragType !== 'cat') return;
      e.preventDefault();
      block.classList.remove('drag-over-cat');
      const toIdx = parseInt(block.dataset.ci, 10);
      const fromIdx = _dragCatIdx;
      if (fromIdx === toIdx) return;
      const moved = _catData.splice(fromIdx, 1)[0];
      _catData.splice(toIdx, 0, moved);
      renderOrderList();
    });

    /* ── Grupos dentro de la categoría ── */
    const groupsArea = document.createElement('div');
    groupsArea.className = 'order-cat-groups';

    if (!catEntry.groups.length) {
      groupsArea.innerHTML = '<div class="order-cat-groups-empty">Sin grupos</div>';
    } else {
      catEntry.groups.forEach((g, gi) => {
        const item = document.createElement('div');
        item.className = 'order-item';
        item.draggable = true;
        item.dataset.ci = String(ci);
        item.dataset.gi = String(gi);
        item.innerHTML = `
          <span class="order-handle">⠿</span>
          <span class="order-num">${gi + 1}</span>
          <span class="order-label">${escapeHtml(g.nombre || g.groupId)}</span>
          <div class="order-arrows">
            <button class="btn-arrow" data-dir="up" title="Subir">▲</button>
            <button class="btn-arrow" data-dir="down" title="Bajar">▼</button>
          </div>
        `;

        // Flechas de grupo
        item.querySelectorAll('.btn-arrow').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            const arr = _catData[ci].groups;
            const dir = btn.dataset.dir;
            if (dir === 'up' && gi > 0) {
              [arr[gi - 1], arr[gi]] = [arr[gi], arr[gi - 1]];
            } else if (dir === 'down' && gi < arr.length - 1) {
              [arr[gi], arr[gi + 1]] = [arr[gi + 1], arr[gi]];
            }
            renderOrderList();
          });
        });

        // Drag grupo
        item.addEventListener('dragstart', e => {
          _dragType = 'group'; _dragCatIdx = ci; _dragGroupIdx = gi;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', `group:${ci}:${gi}`);
          setTimeout(() => item.classList.add('dragging'), 0);
        });
        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          document.querySelectorAll('.order-item').forEach(i => i.classList.remove('drag-over'));
        });
        item.addEventListener('dragover', e => {
          if (_dragType !== 'group') return;
          e.preventDefault(); e.stopPropagation();
          item.classList.add('drag-over');
        });
        item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
        item.addEventListener('drop', e => {
          if (_dragType !== 'group') return;
          e.preventDefault(); e.stopPropagation();
          item.classList.remove('drag-over');
          const toCi = parseInt(item.dataset.ci, 10);
          const toGi = parseInt(item.dataset.gi, 10);
          const fromCi = _dragCatIdx;
          const fromGi = _dragGroupIdx;
          if (fromCi === toCi && fromGi === toGi) return;

          const moved = _catData[fromCi].groups.splice(fromGi, 1)[0];
          // Si el grupo se mueve a otra categoría, actualizar su campo grupo
          if (fromCi !== toCi) moved.grupo = _catData[toCi].name;
          _catData[toCi].groups.splice(toGi, 0, moved);
          renderOrderList();
        });

        groupsArea.appendChild(item);
      });
    }

    block.appendChild(header);
    block.appendChild(groupsArea);
    listEl.appendChild(block);
  });
}

/* ---- Guardar ---- */
const saveOrderBtn = $('#saveOrder');
if (saveOrderBtn) {
  saveOrderBtn.addEventListener('click', async () => {
    try {
      const categoryOrder = _catData.map(c => c.name);
      const groupOrder = _catData.flatMap(c => c.groups.map(g => g.groupId));
      await IbotApi.saveOrder({ categoryOrder, groupOrder });
      if (current) {
        current.categoryOrder = categoryOrder;
        current.groupOrder = groupOrder;
      }
      toast('✅ Orden guardado en la base de datos');
    } catch (e) {
      toast('❌ Error al guardar orden: ' + e.message);
    }
  });
}

/* ---- Restablecer ---- */
const resetOrderBtn = $('#resetOrder');
if (resetOrderBtn) {
  resetOrderBtn.addEventListener('click', async () => {
    try {
      await IbotApi.saveOrder({ categoryOrder: [], groupOrder: [] });
      if (current) {
        current.categoryOrder = [];
        current.groupOrder = [];
      }
      const groups = await IbotApi.groups().catch(() => []);
      // Reconstruir sin orden
      const catMap = new Map();
      for (const g of groups) {
        const cat = g.grupo || 'otros';
        if (!catMap.has(cat)) catMap.set(cat, []);
        catMap.get(cat).push(g);
      }
      _catData = [...catMap.entries()].map(([name, gs]) => ({ name, groups: gs }));
      renderOrderList();
      toast('🔄 Orden restablecido en la base de datos');
    } catch (e) {
      toast('❌ Error al restablecer orden: ' + e.message);
    }
  });
}

load();
