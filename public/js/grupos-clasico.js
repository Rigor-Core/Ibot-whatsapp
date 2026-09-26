/* ===== GRUPOS-CLASICO.JS — vista clásica de la ventana de grupos =====
   Dibuja la tabla original; la lógica está en grupos.js. */
(() => {
  const categoriesEl = document.getElementById('categories');

  function setAnswers(isOn) {
    const btn = document.getElementById('btn-toggle-nonind');
    if (!btn) return;
    btn.classList.toggle('resp-on', isOn);
    btn.classList.toggle('resp-off', !isOn);
    btn.setAttribute('aria-pressed', String(isOn));
    btn.textContent = isOn ? 'Respuestas: ON' : 'Respuestas: OFF';
  }

  function showEmpty(msg) {
    categoriesEl.innerHTML = `<div class="empty-state">${msg}</div>`;
  }

  function render({ groups, config: currentConfig, canManage, actions }) {
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
        btnToggle.addEventListener('click', () => actions.toggleResponder(g.groupId));
        if (canManage) respCol.appendChild(btnToggle);

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
        btnCommands.addEventListener('click', () => actions.toggleGroupCommands(g.groupId));
        actionsCol.appendChild(btnCommands);

        const btnEdit = document.createElement('button');
        btnEdit.type = 'button';
        btnEdit.className = 'btn-icon edit';
        btnEdit.title = 'Editar';
        btnEdit.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
        btnEdit.addEventListener('click', () => actions.edit(g));
        actionsCol.appendChild(btnEdit);

        if (g.independiente) {
          const resetBtn = document.createElement('button');
          resetBtn.type = 'button';
          resetBtn.className = 'btn-icon reset';
          resetBtn.title = 'Reiniciar contador';
          resetBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>`;
          resetBtn.addEventListener('click', () => actions.reset(g.groupId));
          actionsCol.appendChild(resetBtn);
        }

        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn-icon del';
        btnDel.title = 'Eliminar grupo';
        btnDel.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
        btnDel.addEventListener('click', () => actions.remove(g.groupId));
        actionsCol.appendChild(btnDel);

        if (!canManage) actionsCol.replaceChildren();
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
      addBar.addEventListener('click', () => actions.add(cat));
      if (canManage) rightArea.appendChild(addBar);

      catCard.appendChild(leftCol);
      catCard.appendChild(rightArea);
      categoriesEl.appendChild(catCard);
    }
  }

  window.GroupsView = {
    render,
    showEmpty,
    setAnswers,
    confirmDelete: (groupId) => confirm(`¿Borrar el grupo "${groupId}"?`),
  };
})();
