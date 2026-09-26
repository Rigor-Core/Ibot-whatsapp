// Ajustes: navegación entre secciones (una pantalla por sección, con regreso
// al menú) y las secciones generales. Cada módulo settings-*.js agrega las suyas.
const IbotSettings = (() => {
  const root = $('#settings');
  const configListeners = [];
  let config = null;
  let depth = 0;

  const screenEl = (id) => (id ? document.querySelector(`.settings-screen[data-screen="${CSS.escape(id)}"]`) : null);
  const isWide = () => window.matchMedia('(min-width: 1025px)').matches;
  const topLevel = (id) => {
    let screen = screenEl(id);
    while (screen?.dataset.parent) screen = screenEl(screen.dataset.parent);
    return screen?.dataset.screen || null;
  };

  // Encabezado de cada pantalla: botón de regreso, sección padre y título.
  function decorate() {
    for (const screen of document.querySelectorAll('.settings-screen')) {
      const parentTitle = screenEl(screen.dataset.parent)?.dataset.title || 'Ajustes';
      screen.insertAdjacentHTML('afterbegin', `
        <div class="screen-head">
          <button class="btn ghost icon" type="button" data-back aria-label="Regresar" title="Regresar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div><div class="crumb">${escapeHtml(parentTitle)}</div><h2 data-screen-title>${escapeHtml(screen.dataset.title || '')}</h2></div>
        </div>`);
    }
  }

  function syncBackButtons() {
    for (const screen of document.querySelectorAll('.settings-screen')) {
      // En PC el menú siempre está visible: las secciones principales no necesitan "regresar".
      screen.querySelector('.screen-head [data-back]').hidden = isWide() && !screen.dataset.parent;
    }
  }

  function render(id, { back = false } = {}) {
    const target = screenEl(id) ? id : null;
    for (const screen of document.querySelectorAll('.settings-screen')) {
      const active = screen.dataset.screen === target;
      screen.classList.toggle('active', active);
      screen.classList.toggle('back', active && back);
    }
    root.classList.toggle('has-screen', !!target);
    const top = topLevel(target);
    document.querySelectorAll('.settings-menu .settings-item[data-go]').forEach((item) => item.classList.toggle('active', item.dataset.go === top));
    syncBackButtons();
    if (!isWide() || back) window.scrollTo({ top: 0 });
    document.dispatchEvent(new CustomEvent('settings:show', { detail: target }));
  }

  function go(id) {
    if (!screenEl(id)) return;
    history.pushState({ screen: id }, '', `#${id}`);
    depth += 1;
    render(id);
  }

  function back() {
    if (depth > 0) {
      history.back();
      return;
    }
    // Se llegó directo a una sección (por ejemplo, desde un enlace): se sube un nivel.
    const parent = screenEl(location.hash.slice(1))?.dataset.parent || null;
    history.replaceState(null, '', parent ? `#${parent}` : location.pathname);
    render(parent, { back: true });
  }

  window.addEventListener('popstate', () => {
    depth = Math.max(0, depth - 1);
    render(location.hash.slice(1), { back: true });
  });
  window.addEventListener('resize', syncBackButtons);
  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-go]');
    if (link) {
      event.preventDefault();
      go(link.dataset.go);
      return;
    }
    if (event.target.closest('[data-back]')) back();
  });

  // Guarda cambios de la configuración y avisa a las secciones.
  async function save(patch, button, message = 'Cambios guardados') {
    const label = button?.textContent;
    if (button) { button.disabled = true; button.textContent = 'Guardando…'; }
    try {
      config = await IbotApi.saveConfig(patch);
      configListeners.forEach((listener) => listener(config));
      if (message) toast(`✅ ${message}`);
      return config;
    } catch (error) {
      toast(error.message);
      throw error;
    } finally {
      if (button) { button.disabled = false; button.textContent = label; }
    }
  }

  function onConfig(listener) {
    configListeners.push(listener);
    if (config) listener(config);
  }

  const ready = (async () => {
    decorate();
    const bot = await loadUserBot();
    config = await IbotApi.config();
    configListeners.forEach((listener) => listener(config));
    render(location.hash.slice(1));
    return { bot, config };
  })();
  ready.catch((error) => toast(error.message));

  // Selector de chats reutilizable (almacenamiento, reglas de IA).
  async function pickChats({ title = 'Elegir chats', selected = [], multiple = true } = {}) {
    const modal = $('#chatPicker');
    const chosen = new Set(selected);
    const chats = await IbotApi.chatGroups();
    $('#cpTitle').textContent = title;
    $('#cpSearch').value = '';
    const draw = () => {
      const q = $('#cpSearch').value.trim().toLowerCase();
      const rows = chats.filter((chat) => !q || `${chat.subject} ${chat.groupId}`.toLowerCase().includes(q));
      $('#cpList').innerHTML = rows.map((chat) => `
        <label class="cp-item">
          <input type="${multiple ? 'checkbox' : 'radio'}" name="cpPick" value="${escapeHtml(chat.groupId)}" ${chosen.has(chat.groupId) ? 'checked' : ''}>
          <div class="main"><div class="name">${escapeHtml(chat.isSelf ? 'Tú (chat personal)' : chat.subject || chat.groupId)}</div><div class="hint">${chat.type === 'group' ? 'Grupo' : `+${escapeHtml(chat.groupId.split('@')[0])}`}</div></div>
        </label>`).join('') || '<div class="empty">Sin chats</div>';
    };
    draw();
    modal.classList.add('open');
    return new Promise((resolve) => {
      const finish = (value) => {
        modal.classList.remove('open');
        modal.removeEventListener('click', onClick);
        $('#cpSearch').removeEventListener('input', draw);
        $('#cpList').removeEventListener('change', onChange);
        resolve(value);
      };
      const onChange = (event) => {
        if (!multiple) chosen.clear();
        if (event.target.checked) chosen.add(event.target.value);
        else chosen.delete(event.target.value);
      };
      const onClick = (event) => {
        if (event.target === modal || event.target.closest('[data-close]')) finish(null);
        if (event.target.closest('#cpDone')) {
          finish([...chosen].map((id) => {
            const chat = chats.find((row) => row.groupId === id);
            return { id, name: chat?.subject || id };
          }));
        }
      };
      $('#cpSearch').addEventListener('input', draw);
      $('#cpList').addEventListener('change', onChange);
      modal.addEventListener('click', onClick);
    });
  }

  return { ready, save, onConfig, go, back, pickChats, config: () => config };
})();

/* ══════════════════════════════════════════════
   MODO DEL BOT (compacto)
══════════════════════════════════════════════ */
(() => {
  const chips = $('#modeChips');
  const MODE_NAMES = { repartidor: 'Repartidor', normal: 'Normal', watch: 'Watch', ia: 'IA' };

  function paint(config) {
    chips.querySelectorAll('[data-mode]').forEach((chip) => chip.setAttribute('aria-checked', String(chip.dataset.mode === config.modo)));
    $('#ignoreOwn').checked = config.ignoreOwnMessages !== false;
  }

  IbotSettings.ready.then(({ bot }) => {
    // Los modos que el administrador no permite no aparecen.
    chips.querySelectorAll('[data-mode]').forEach((chip) => { if (!bot.allowedModes?.includes(chip.dataset.mode)) chip.remove(); });
    chips.style.gridTemplateColumns = `repeat(${chips.children.length}, minmax(0, 1fr))`;
  });
  IbotSettings.onConfig(paint);

  chips.addEventListener('click', async (event) => {
    const chip = event.target.closest('[data-mode]');
    if (!chip || chip.getAttribute('aria-checked') === 'true') return;
    const buttons = [...chips.children];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await IbotSettings.save({ modo: chip.dataset.mode }, null, `Modo ${MODE_NAMES[chip.dataset.mode]} activado`);
    } catch { /* el error ya se mostró */ } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  });

  $('#ignoreOwn').addEventListener('change', async (event) => {
    try {
      await IbotSettings.save({ ignoreOwnMessages: event.target.checked }, null, event.target.checked ? 'El bot ignorará tus mensajes' : 'El bot también reaccionará a tus mensajes');
    } catch {
      event.target.checked = !event.target.checked;
    }
  });
})();

/* ══════════════════════════════════════════════
   REPARTIDOR, AVISO AL CONECTAR Y ZONA HORARIA
══════════════════════════════════════════════ */
IbotSettings.onConfig((config) => {
  $('#globalLimit').value = config.repartidor?.globalLimit ?? 1;
  $('#filterEnabled').checked = config.repartidor?.filterEnabled !== false;
  $('#timezone').value = config.timezone || 'America/Hermosillo';
  $('#sumZone').textContent = config.timezone || 'America/Hermosillo';
  const connNotify = config.connectionNotification || {};
  $('#connNotifyEnabled').checked = !!connNotify.enabled;
  $('#connNotifyMessage').value = connNotify.message || '';
  if ($('#connNotifyGroup').options.length > 1) $('#connNotifyGroup').value = connNotify.groupId || '';
});

$('#saveRepartidor').addEventListener('click', (event) => IbotSettings.save({
  repartidor: { globalLimit: Number($('#globalLimit').value || 0), filterEnabled: $('#filterEnabled').checked },
}, event.currentTarget).catch(() => null));

$('#saveZone').addEventListener('click', (event) => IbotSettings.save({ timezone: $('#timezone').value }, event.currentTarget).catch(() => null));

$('#saveConnNotify').addEventListener('click', (event) => IbotSettings.save({
  connectionNotification: {
    enabled: $('#connNotifyEnabled').checked,
    groupId: $('#connNotifyGroup').value,
    message: $('#connNotifyMessage').value.trim(),
  },
}, event.currentTarget).catch(() => null));

$('#testConnNotify').addEventListener('click', async () => {
  const groupId = $('#connNotifyGroup').value;
  const message = $('#connNotifyMessage').value.trim();
  if (!groupId) return toast('⚠️ Selecciona un grupo destinatario primero.');
  if (!message) return toast('⚠️ Escribe un mensaje de prueba.');
  try {
    toast('Enviando mensaje de prueba...');
    await IbotApi.testConnNotification({ groupId, message });
    toast('✅ Mensaje de prueba enviado con éxito');
  } catch (e) {
    toast('❌ Error: ' + e.message);
  }
});

// Grupos configurados (para el aviso al conectar y el orden de grupos).
const configuredGroups = IbotSettings.ready.then(() => IbotApi.groups()).catch(() => []);
configuredGroups.then((groups) => {
  $('#connNotifyGroup').innerHTML = '<option value="">Selecciona un grupo...</option>'
    + groups.map(g => `<option value="${escapeHtml(g.groupId)}">${escapeHtml(g.nombre || g.groupId)}</option>`).join('');
  $('#connNotifyGroup').value = IbotSettings.config()?.connectionNotification?.groupId || '';
});

/* ══════════════════════════════════════════════
   APARIENCIA Y CUENTA
══════════════════════════════════════════════ */
(() => {
  const LABELS = { light: 'Tema claro', dark: 'Tema oscuro', auto: 'Automático (como tu dispositivo)' };
  function paint() {
    const preference = window.IbotTheme.preference();
    $('#themeOptions').querySelectorAll('[data-theme-choice]').forEach((button) => button.setAttribute('aria-checked', String(button.dataset.themeChoice === preference)));
    $('#sumTheme').textContent = LABELS[preference];
  }
  $('#themeOptions').addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-choice]');
    if (!button) return;
    window.IbotTheme.set(button.dataset.themeChoice);
    paint();
  });
  paint();

  document.addEventListener('ibot:user', (event) => {
    $('#sumAccount').textContent = `Sesión de ${event.detail}`;
    $('#accountLine').textContent = `Cuenta: ${event.detail}`;
  });

  $('#logoutBtn').addEventListener('click', async () => {
    const ok = await IbotDialog.confirm({
      title: '¿Cerrar sesión?',
      text: 'Saldrás del panel en este dispositivo. Tu bot sigue funcionando.',
      confirmText: 'Cerrar sesión',
      danger: true,
    });
    if (!ok) return;
    await IbotApi.logoutPanel().catch(() => null);
    location.href = '/login.html';
  });
})();

/* ══════════════════════════════════════════════
   GRUPOS: VISTA Y ORDEN (dos niveles: categorías + grupos)
══════════════════════════════════════════════ */
(() => {
  const VIEW_LABELS = { classic: 'Ventana clásica', modern: 'Ventana moderna' };
  const viewBox = $('#groupsView');
  if (!viewBox) return;

  function paintView(view) {
    viewBox.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-checked', String(button.dataset.view === view)));
    $('#sumGroups').textContent = `${VIEW_LABELS[view]} · orden`;
  }

  viewBox.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    try {
      const preferences = await IbotApi.savePreferences({ groupsView: button.dataset.view });
      paintView(preferences.groupsView);
      toast(`✅ Grupos se abrirá con la ${VIEW_LABELS[preferences.groupsView].toLowerCase()}`);
    } catch (error) {
      toast(error.message);
    }
  });

  /* ---- Estado del editor de orden ---- */
  // _catData = [ { name, groups: [grupo,...] }, ... ]
  let _catData = [];
  let current = null;

  function buildCatData(groups) {
    const catMap = new Map();
    for (const g of groups) {
      const cat = g.grupo || 'otros';
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat).push(g);
    }
    // Ordenar grupos dentro de cada categoría según el orden guardado
    const groupOrder = current?.groupOrder || [];
    for (const [cat, arr] of catMap.entries()) {
      if (!groupOrder.length) continue;
      const gmap = new Map(arr.map(g => [g.groupId, g]));
      const sorted = [];
      for (const id of groupOrder) { if (gmap.has(id)) { sorted.push(gmap.get(id)); gmap.delete(id); } }
      for (const g of gmap.values()) sorted.push(g);
      catMap.set(cat, sorted);
    }
    // Ordenar categorías
    const catOrder = current?.categoryOrder || [];
    const orderedCats = [];
    const catMapCopy = new Map(catMap);
    for (const c of catOrder) { if (catMapCopy.has(c)) { orderedCats.push(c); catMapCopy.delete(c); } }
    for (const c of catMapCopy.keys()) orderedCats.push(c);
    return orderedCats.map(name => ({ name, groups: catMap.get(name) || [] }));
  }

  /* ---- Drag state compartido entre niveles ---- */
  let _dragType = null; // 'cat' | 'group'
  let _dragCatIdx = null;
  let _dragGroupIdx = null;

  function renderOrderList() {
    const listEl = $('#orderList');
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

  $('#saveOrder').addEventListener('click', async () => {
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

  $('#resetOrder').addEventListener('click', async () => {
    try {
      await IbotApi.saveOrder({ categoryOrder: [], groupOrder: [] });
      if (current) {
        current.categoryOrder = [];
        current.groupOrder = [];
      }
      _catData = buildCatData(await IbotApi.groups().catch(() => []));
      renderOrderList();
      toast('🔄 Orden restablecido en la base de datos');
    } catch (e) {
      toast('❌ Error al restablecer orden: ' + e.message);
    }
  });

  IbotSettings.ready.then(async ({ bot, config }) => {
    current = config;
    paintView(bot.preferences?.groupsView || 'classic');
    _catData = buildCatData(await configuredGroups);
    renderOrderList();
  });
})();
