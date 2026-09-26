// Vista moderna de la ventana de grupos. La lógica está en grupos.js.
(() => {
  const categoriesEl = document.getElementById('categories');
  const TYPES = { texto: 'Texto', imagen: 'Imagen', ambas: 'Texto e imagen' };
  const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    cmd: icon('<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 0-6z"/>'),
    edit: icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    reset: icon('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
    del: icon('<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
    plus: icon('<path d="M12 5v14M5 12h14"/>'),
  };
  let last = null;
  let query = '';

  function setAnswers(isOn) {
    const btn = document.getElementById('btn-toggle-nonind');
    btn.classList.toggle('on', isOn);
    btn.classList.toggle('off', !isOn);
    btn.setAttribute('aria-pressed', String(isOn));
    btn.querySelector('span:last-child').textContent = isOn ? 'Respuestas ON' : 'Respuestas OFF';
  }

  function showEmpty(msg) {
    categoriesEl.innerHTML = `<div class="empty">${escapeHtml(msg)}</div>`;
  }

  function row(g, config, canManage) {
    const commands = g.commandSettings?.enabled
      ? (config?.adminCommands?.enabled ? ['cmd-on', 'Comandos activos'] : ['cmd-standby', 'Grupo listo; comandos globales apagados'])
      : ['cmd-off', 'Comandos desactivados'];
    const counter = g.independiente
      ? `<span class="pill ${g.limite && g.contador >= g.limite ? 'warn' : 'accent'} plain">Independiente · ${Number(g.contador || 0)}/${g.limite || '∞'}</span>`
      : '';
    return `
      <div class="gm-row${g.responder ? ' on' : ''}" data-id="${escapeHtml(g.groupId)}">
        <span class="gm-state" title="${g.responder ? 'Responde' : 'Pausado'}"></span>
        <div style="min-width:0">
          <div class="gm-name">${escapeHtml(g.nombre || 'Sin nombre')}</div>
          <div class="gm-meta">
            <span class="pill plain">${TYPES[g.tipoMensaje] || 'Texto'}</span>
            ${counter}
            ${g.duracion ? '<span class="pill plain">Temporal</span>' : ''}
          </div>
        </div>
        ${canManage ? `<label class="switch" title="${g.responder ? 'Pausar' : 'Activar'}"><input type="checkbox" data-act="toggle" ${g.responder ? 'checked' : ''} aria-label="Responder en ${escapeHtml(g.nombre)}"><span></span></label>` : `<span class="pill ${g.responder ? 'good' : ''}">${g.responder ? 'Responde' : 'Pausado'}</span>`}
        ${canManage ? `
        <div class="gm-actions">
          <button class="btn ghost sm icon ${commands[0]}" type="button" data-act="commands" title="${commands[1]}" aria-label="${commands[1]}">${ICONS.cmd}</button>
          <button class="btn ghost sm icon" type="button" data-act="edit" title="Editar" aria-label="Editar">${ICONS.edit}</button>
          ${g.independiente ? `<button class="btn ghost sm icon" type="button" data-act="reset" title="Reiniciar contador" aria-label="Reiniciar contador">${ICONS.reset}</button>` : ''}
          <button class="btn ghost sm icon del" type="button" data-act="remove" title="Eliminar" aria-label="Eliminar">${ICONS.del}</button>
        </div>` : ''}
      </div>`;
  }

  function render(state) {
    last = state;
    const { groups, config, canManage } = state;
    $('#gmTotal').textContent = groups.length;
    $('#gmActive').textContent = groups.filter((g) => g.responder).length;
    $('#gmIndependent').textContent = groups.filter((g) => g.independiente).length;
    if (!groups.length) {
      categoriesEl.innerHTML = `<div class="empty"><strong>Sin grupos todavía</strong>${canManage ? 'Agrega uno con Nuevo o desde Chats, tocando un grupo detectado.' : ''}</div>`;
      return;
    }
    const q = query.toLowerCase();
    const visible = groups.filter((g) => !q || `${g.nombre} ${g.groupId} ${g.grupo}`.toLowerCase().includes(q));
    const byCategory = new Map();
    for (const g of visible) {
      const cat = g.grupo || 'otros';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(g);
    }
    categoriesEl.innerHTML = [...byCategory].map(([cat, list]) => `
      <div class="gm-cat">
        <div class="gm-cat-head"><span class="gm-cat-name">${escapeHtml(cat)}</span><span class="pill plain">${list.length}</span></div>
        ${list.map((g) => row(g, config, canManage)).join('')}
        ${canManage ? `<button class="btn sm gm-add" type="button" data-add="${escapeHtml(cat)}">${ICONS.plus}<span>Agregar en ${escapeHtml(cat)}</span></button>` : ''}
      </div>`).join('') || '<div class="empty">Ningún grupo coincide con la búsqueda.</div>';
  }

  categoriesEl.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add]');
    if (add) return last.actions.add(add.dataset.add);
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const id = button.closest('.gm-row').dataset.id;
    const group = last.groups.find((g) => g.groupId === id);
    if (button.dataset.act === 'commands') last.actions.toggleGroupCommands(id);
    if (button.dataset.act === 'edit' && group) last.actions.edit(group);
    if (button.dataset.act === 'reset') last.actions.reset(id);
    if (button.dataset.act === 'remove') last.actions.remove(id);
  });
  categoriesEl.addEventListener('change', (event) => {
    if (event.target.matches('input[data-act="toggle"]')) last.actions.toggleResponder(event.target.closest('.gm-row').dataset.id);
  });
  document.getElementById('gmSearch').addEventListener('input', (event) => {
    query = event.target.value.trim();
    if (last) render(last);
  });

  window.GroupsView = {
    render,
    showEmpty,
    setAnswers,
    confirmDelete: (groupId) => {
      const group = last?.groups.find((g) => g.groupId === groupId);
      return IbotDialog.confirm({
        title: `¿Eliminar «${group?.nombre || groupId}»?`,
        text: 'El bot dejará de responder en este grupo. Puedes volver a agregarlo desde Chats.',
        confirmText: 'Eliminar',
        danger: true,
      });
    },
  };
})();
