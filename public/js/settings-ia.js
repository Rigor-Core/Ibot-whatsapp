// Ajustes → Inteligencia artificial: proveedor, dónde y cuándo responde,
// plantillas de comportamiento, reglas por chat, contexto, estilo y prueba.
(() => {
  if (!$('#iaProvider')) return; // El administrador no permite configurar la IA.

  const STICKER_LABELS = { never: '', sometimes: 'Stickers a veces', often: 'Stickers seguido' };
  const ACCESS_LABELS = { inherit: 'Según lo general', allow: 'Permitir', block: 'Bloquear' };
  let providers = [];
  let ia = null;
  let templates = { templates: [], presets: [], defaultTemplateId: '' };
  let rules = [];
  let chats = [];
  let editingId = null;

  const selectedProvider = () => providers.find((provider) => provider.id === $('#iaProvider').value) || providers[0];
  const templateName = (id) => templates.templates.find((template) => template.id === id)?.name;

  // ─── Resumen y menú ──────────────────────────────────────────────────
  function paintSummary() {
    const provider = providers.find((item) => item.id === ia.provider);
    const config = IbotSettings.config();
    $('#iaSummaryTitle').textContent = `${provider?.name || ia.provider} · ${ia.model || 'sin modelo'}`;
    const defaultTemplate = templateName(templates.defaultTemplateId);
    $('#iaSummarySub').textContent = defaultTemplate ? `Plantilla general: ${defaultTemplate}` : 'Sin plantilla: usa las instrucciones generales';
    const active = config.modo === 'ia';
    const state = $('#iaSummaryState');
    state.className = `pill ${active ? 'good' : ''}`;
    state.textContent = active ? 'Modo IA activo' : 'Modo IA apagado';
    $('#sumIa').textContent = `${provider?.name || ia.provider} · ${ia.model}`;
    $('#sumTemplates').textContent = templates.templates.length ? `${templates.templates.length} plantilla(s)` : 'Asistente, vendedor, hazte pasar por mí…';
    $('#sumRules').textContent = rules.length ? `${rules.length} chat(s) con regla` : 'Permitir, bloquear o usar otra plantilla';
  }

  // ─── Proveedor ───────────────────────────────────────────────────────
  function syncProviderFields() {
    const provider = selectedProvider();
    if (!provider) return;
    $('#iaModelOptions').innerHTML = provider.models.map((model) => `<option value="${escapeHtml(model)}">`).join('');
    $('#iaBaseUrlField').style.display = provider.id === 'custom' ? '' : 'none';
    const keySet = !!ia?.apiKeysSet?.[provider.id];
    const keyInfo = keySet
      ? 'Tienes una clave guardada para este proveedor.'
      : provider.sharedKeyAvailable
        ? 'No necesitas clave: se usa la del sistema. Puedes escribir la tuya si prefieres.'
        : provider.id === 'custom' ? 'La clave es opcional si tu servicio no la pide.' : 'Necesitas escribir tu API key de este proveedor.';
    $('#iaProviderInfo').textContent = `${provider.description} ${keyInfo}`;
    $('#iaApiKey').placeholder = keySet ? '•••••••• (Dejar vacío para conservar)' : 'Pega aquí tu API key';
    $('#iaClearApiKey').checked = false;
    $('#iaClearKeyBox').hidden = !keySet;
  }

  $('#iaProvider').addEventListener('change', () => {
    const provider = selectedProvider();
    // Al cambiar de proveedor se propone su primer modelo.
    if (provider && !provider.models.includes($('#iaModel').value)) $('#iaModel').value = provider.models[0] || '';
    syncProviderFields();
  });

  // ─── Dónde y cuándo ──────────────────────────────────────────────────
  function syncWhenFields() {
    const mode = $('#iaTriggerMode').value;
    $('#iaCommandsField').style.display = mode === 'command' || $('#iaOwnerTrigger').value === 'command' ? '' : 'none';
    $('#iaKeywordsField').style.display = mode === 'keyword' ? '' : 'none';
    $('#iaOwnerTrigger').closest('.field').hidden = !$('#iaOwnerAssistant').checked;
  }
  ['#iaTriggerMode', '#iaOwnerTrigger', '#iaOwnerAssistant'].forEach((id) => $(id).addEventListener('change', syncWhenFields));

  // ─── Formularios ─────────────────────────────────────────────────────
  function fill() {
    $('#iaProvider').value = providers.some((provider) => provider.id === ia.provider) ? ia.provider : providers[0]?.id;
    $('#iaModel').value = ia.model || '';
    $('#iaBaseUrl').value = ia.baseUrl || '';
    $('#iaApiKey').value = '';
    $('#iaTemperature').value = ia.temperature;
    $('#iaMaxTokens').value = ia.maxTokens;
    $('#iaTimeout').value = Math.round(ia.timeoutMs / 1000);
    syncProviderFields();

    $('#iaOwnerAssistant').checked = ia.ownerAssistant;
    $('#iaOwnerTrigger').value = ia.ownerTrigger;
    $('#iaGroupScope').value = ia.groupScope;
    $('#iaTriggerMode').value = ia.triggerMode;
    $('#iaCommands').value = ia.commands.join(',');
    $('#iaKeywords').value = ia.keywords.join(',');
    $('#iaPrivateScope').value = ia.privateScope;
    $('#iaPrivateTrigger').value = ia.privateTrigger;
    $('#iaIgnoreMedia').checked = ia.ignoreMedia;
    $('#iaCooldown').value = ia.perGroupCooldownMs;
    syncWhenFields();

    $('#iaContextMessages').value = ia.contextMessages;
    $('#iaMaxToolSteps').value = ia.maxToolSteps;
    $('#iaHistoryTools').checked = ia.historyTools;

    $('#iaReplyQuoted').checked = ia.replyQuoted;
    $('#iaMentionSender').checked = ia.mentionSender;
    $('#iaShowTyping').checked = ia.showTyping;
    $('#iaIncludeSender').checked = ia.includeSenderName;
    $('#iaSystemPrompt').value = ia.systemPrompt || '';
    $('#iaFallback').value = ia.fallbackText || '';
    $('#iaMaxReplyChars').value = ia.maxReplyChars;
  }

  const list = (value) => value.split(',').map((item) => item.trim()).filter(Boolean);
  const PAYLOADS = {
    provider: () => {
      const provider = $('#iaProvider').value;
      const body = {
        provider,
        model: $('#iaModel').value.trim(),
        baseUrl: provider === 'custom' ? $('#iaBaseUrl').value.trim() : '',
        temperature: Number($('#iaTemperature').value || 0.6),
        maxTokens: Number($('#iaMaxTokens').value || 700),
        timeoutMs: Number($('#iaTimeout').value || 25) * 1000,
      };
      const apiKey = $('#iaApiKey').value.trim();
      if (apiKey) body.apiKey = apiKey;
      if ($('#iaClearApiKey').checked) body.clearApiKey = true;
      return body;
    },
    when: () => ({
      ownerAssistant: $('#iaOwnerAssistant').checked,
      ownerTrigger: $('#iaOwnerTrigger').value,
      groupScope: $('#iaGroupScope').value,
      triggerMode: $('#iaTriggerMode').value,
      commands: list($('#iaCommands').value),
      keywords: list($('#iaKeywords').value),
      privateScope: $('#iaPrivateScope').value,
      privateTrigger: $('#iaPrivateTrigger').value,
      ignoreMedia: $('#iaIgnoreMedia').checked,
      perGroupCooldownMs: Number($('#iaCooldown').value || 0),
    }),
    context: () => ({
      contextMessages: Number($('#iaContextMessages').value || 0),
      maxToolSteps: Number($('#iaMaxToolSteps').value || 4),
      historyTools: $('#iaHistoryTools').checked,
    }),
    style: () => ({
      replyQuoted: $('#iaReplyQuoted').checked,
      mentionSender: $('#iaMentionSender').checked,
      showTyping: $('#iaShowTyping').checked,
      includeSenderName: $('#iaIncludeSender').checked,
      systemPrompt: $('#iaSystemPrompt').value,
      fallbackText: $('#iaFallback').value,
      maxReplyChars: Number($('#iaMaxReplyChars').value || 0),
    }),
  };

  document.querySelectorAll('[data-save-ia]').forEach((button) => button.addEventListener('click', () => {
    IbotSettings.save({ ia: PAYLOADS[button.dataset.saveIa]() }, button, 'IA guardada').catch(() => null);
  }));

  $('#iaResetMemory').addEventListener('click', async () => {
    const ok = await IbotDialog.confirm({
      title: '¿Reiniciar la memoria de la IA?',
      text: 'Dejará de usar como contexto lo que se habló hasta ahora. Los mensajes guardados no se borran y aún puede buscarlos.',
      confirmText: 'Reiniciar',
    });
    if (!ok) return;
    try {
      await IbotApi.resetIaMemory();
      toast('Memoria de la IA reiniciada');
    } catch (error) {
      toast(error.message);
    }
  });

  // ─── Plantillas ──────────────────────────────────────────────────────
  function renderTemplates() {
    const usage = (id) => rules.filter((rule) => rule.templateId === id).length;
    const general = `
      <div class="template-card${!templates.defaultTemplateId ? ' default' : ''}">
        <div class="main">
          <div class="title">Instrucciones generales</div>
          <div class="hint">Las de Estilo de respuesta, sin plantilla.</div>
          ${!templates.defaultTemplateId ? '<div class="badges"><span class="pill accent plain">Predeterminada</span></div>' : ''}
        </div>
        <div class="actions">${templates.defaultTemplateId ? '<button class="btn sm" type="button" data-tpl-default="">Usar por defecto</button>' : ''}</div>
      </div>`;
    $('#templateList').innerHTML = general + templates.templates.map((template) => {
      const isDefault = template.id === templates.defaultTemplateId;
      const badges = [
        isDefault ? '<span class="pill accent plain">Predeterminada</span>' : '',
        template.learnFromMe || template.styleSamples ? '<span class="pill plain">Imita tu estilo</span>' : '',
        STICKER_LABELS[template.stickerMode] ? `<span class="pill plain">${STICKER_LABELS[template.stickerMode]}</span>` : '',
        usage(template.id) ? `<span class="pill plain">${usage(template.id)} chat(s)</span>` : '',
      ].join('');
      return `
        <div class="template-card${isDefault ? ' default' : ''}">
          <div class="main">
            <div class="title">${escapeHtml(template.name)}</div>
            ${template.description ? `<div class="hint">${escapeHtml(template.description)}</div>` : ''}
            <div class="badges">${badges}</div>
          </div>
          <div class="actions">
            ${isDefault ? '' : `<button class="btn sm" type="button" data-tpl-default="${escapeHtml(template.id)}">Usar por defecto</button>`}
            <button class="btn sm" type="button" data-tpl-edit="${escapeHtml(template.id)}">Editar</button>
            <button class="btn sm danger" type="button" data-tpl-delete="${escapeHtml(template.id)}">Borrar</button>
          </div>
        </div>`;
    }).join('');
    $('#presetGrid').innerHTML = `<button class="preset" type="button" data-preset=""><strong>Desde cero</strong><small>Una plantilla vacía.</small></button>`
      + templates.presets.map((preset) => `<button class="preset" type="button" data-preset="${escapeHtml(preset.key)}"><strong>${escapeHtml(preset.name)}</strong><small>${escapeHtml(preset.description)}</small></button>`).join('');
    const options = `<option value="">General${templateName(templates.defaultTemplateId) ? ` (${escapeHtml(templateName(templates.defaultTemplateId))})` : ''}</option>`
      + templates.templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join('');
    $('#iaTestTemplate').innerHTML = options;
  }

  function openEditor(template, title) {
    editingId = template?.id || null;
    $('#tplName').value = template?.name || '';
    $('#tplDescription').value = template?.description || '';
    $('#tplInstructions').value = template?.instructions || '';
    $('#tplStyle').value = template?.styleSamples || '';
    $('#tplLearn').checked = !!template?.learnFromMe;
    $('#tplStickers').value = template?.stickerMode || 'never';
    $('#tplStickerNotes').value = template?.stickerNotes || '';
    $('#tplTemperature').value = template?.temperature ?? '';
    $('#tplStickerNotesField').hidden = $('#tplStickers').value === 'never';
    document.querySelector('[data-screen="ia-template-edit"] [data-screen-title]').textContent = title;
    IbotSettings.go('ia-template-edit');
    setTimeout(() => $('#tplName').focus(), 60);
  }

  $('#tplStickers').addEventListener('change', () => { $('#tplStickerNotesField').hidden = $('#tplStickers').value === 'never'; });

  $('#templateList').addEventListener('click', async (event) => {
    const setDefault = event.target.closest('[data-tpl-default]');
    const edit = event.target.closest('[data-tpl-edit]');
    const remove = event.target.closest('[data-tpl-delete]');
    try {
      if (setDefault) {
        const { defaultTemplateId } = await IbotApi.setDefaultIaTemplate(setDefault.dataset.tplDefault);
        templates.defaultTemplateId = defaultTemplateId;
        renderTemplates();
        paintSummary();
        toast('Plantilla predeterminada actualizada');
      }
      if (edit) {
        const template = templates.templates.find((item) => item.id === edit.dataset.tplEdit);
        openEditor(template, 'Editar plantilla');
      }
      if (remove) {
        const template = templates.templates.find((item) => item.id === remove.dataset.tplDelete);
        const ok = await IbotDialog.confirm({
          title: `¿Borrar «${template.name}»?`,
          text: 'Los chats que la usaban volverán a la plantilla general.',
          confirmText: 'Borrar',
          danger: true,
        });
        if (!ok) return;
        await IbotApi.deleteIaTemplate(template.id);
        await loadTemplatesAndRules();
        toast('Plantilla borrada');
      }
    } catch (error) {
      toast(error.message);
    }
  });

  $('#presetGrid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-preset]');
    if (!button) return;
    const preset = templates.presets.find((item) => item.key === button.dataset.preset);
    openEditor(preset ? { ...preset, id: null } : null, preset ? `Nueva: ${preset.name}` : 'Nueva plantilla');
  });

  $('#templateForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
      name: $('#tplName').value.trim(),
      description: $('#tplDescription').value.trim(),
      instructions: $('#tplInstructions').value,
      styleSamples: $('#tplStyle').value,
      learnFromMe: $('#tplLearn').checked,
      stickerMode: $('#tplStickers').value,
      stickerNotes: $('#tplStickerNotes').value,
      temperature: $('#tplTemperature').value === '' ? null : Number($('#tplTemperature').value),
    };
    const button = $('#tplSave');
    button.disabled = true;
    try {
      if (editingId) await IbotApi.updateIaTemplate(editingId, body);
      else await IbotApi.createIaTemplate(body);
      await loadTemplatesAndRules();
      toast('✅ Plantilla guardada');
      IbotSettings.back();
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });

  // ─── Reglas por chat ─────────────────────────────────────────────────
  function renderRules() {
    const nameOf = (rule) => chats.find((chat) => chat.groupId === rule.chatId)?.subject || rule.name || rule.chatId;
    const templateOptions = (selected) => `<option value="">Plantilla general</option>`
      + templates.templates.map((template) => `<option value="${escapeHtml(template.id)}"${template.id === selected ? ' selected' : ''}>${escapeHtml(template.name)}</option>`).join('');
    $('#ruleList').innerHTML = rules.length ? rules.map((rule) => `
      <div class="list-item" data-rule="${escapeHtml(rule.chatId)}">
        <div class="avatar${rule.chatId.endsWith('@g.us') ? ' group' : ''}">${escapeHtml(String(nameOf(rule)).slice(0, 1).toUpperCase())}</div>
        <div class="main">
          <div class="title">${escapeHtml(nameOf(rule))}</div>
          <div class="meta">${rule.chatId.endsWith('@g.us') ? 'Grupo' : `+${escapeHtml(rule.chatId.split('@')[0])}`}</div>
        </div>
        <div class="actions" style="flex-wrap:wrap;justify-content:flex-end">
          <select class="input" data-rule-access style="width:auto;min-height:34px">${Object.entries(ACCESS_LABELS).map(([value, label]) => `<option value="${value}"${value === rule.access ? ' selected' : ''}>${label}</option>`).join('')}</select>
          <select class="input" data-rule-template style="width:auto;min-height:34px">${templateOptions(rule.templateId)}</select>
          <button class="btn sm ghost icon" type="button" data-rule-remove title="Quitar regla" aria-label="Quitar regla">✕</button>
        </div>
      </div>`).join('') : '<div class="empty"><strong>Sin reglas</strong>Todos los chats siguen la configuración general.</div>';
  }

  async function saveRule(chatId, rule) {
    const name = chats.find((chat) => chat.groupId === chatId)?.subject || rules.find((item) => item.chatId === chatId)?.name || '';
    const saved = await IbotApi.setIaRule(chatId, { ...rule, name });
    rules = rules.filter((item) => item.chatId !== chatId);
    if (saved.access !== 'inherit' || saved.templateId) rules.push(saved);
    renderRules();
    renderTemplates();
    paintSummary();
  }

  $('#ruleList').addEventListener('change', (event) => {
    const row = event.target.closest('[data-rule]');
    if (!row) return;
    saveRule(row.dataset.rule, {
      access: row.querySelector('[data-rule-access]').value,
      templateId: row.querySelector('[data-rule-template]').value || null,
    }).then(() => toast('Regla guardada')).catch((error) => toast(error.message));
  });

  $('#ruleList').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-rule-remove]');
    if (!remove) return;
    saveRule(remove.closest('[data-rule]').dataset.rule, { access: 'inherit', templateId: null })
      .then(() => toast('Regla quitada'))
      .catch((error) => toast(error.message));
  });

  $('#addRule').addEventListener('click', async () => {
    try {
      const picked = await IbotSettings.pickChats({ title: 'Elige un chat', multiple: false });
      if (!picked?.length) return;
      const [chat] = picked;
      if (rules.some((rule) => rule.chatId === chat.id)) return toast('Ese chat ya tiene una regla');
      await saveRule(chat.id, { access: 'allow', templateId: null });
      toast(`La IA ahora responde en ${chat.name}`);
    } catch (error) {
      toast(error.message);
    }
  });

  // ─── Prueba ──────────────────────────────────────────────────────────
  $('#iaTestForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#iaTestBtn');
    const answer = $('#iaTestAnswer');
    button.disabled = true;
    answer.hidden = false;
    answer.textContent = 'Pensando…';
    try {
      const result = await IbotApi.testIa({ text: $('#iaTestText').value, templateId: $('#iaTestTemplate').value || undefined });
      answer.textContent = `${result.answer}\n\n— ${(result.ms / 1000).toFixed(1)} s`;
    } catch (error) {
      answer.textContent = `⚠️ ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });

  // ─── Carga ───────────────────────────────────────────────────────────
  async function loadTemplatesAndRules() {
    [templates, rules] = await Promise.all([IbotApi.iaTemplates(), IbotApi.iaRules()]);
    renderTemplates();
    renderRules();
    paintSummary();
  }

  IbotSettings.ready.then(async () => {
    const catalog = await IbotApi.iaProviders();
    providers = catalog.providers;
    $('#iaProvider').innerHTML = providers.map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`).join('');
    IbotSettings.onConfig((config) => {
      ia = config.ia;
      fill();
      paintSummary();
    });
    await loadTemplatesAndRules();
    chats = await IbotApi.chatGroups().catch(() => []);
    renderRules();
  }).catch((error) => toast(error.message));
})();
