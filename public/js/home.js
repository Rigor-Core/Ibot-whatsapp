let currentBotStatus = 'stopped';

async function renderBot() {
  const bot = await loadUserBot();
  document.getElementById('homeContent').style.display = 'block';
  document.getElementById('activeBotName').textContent = bot.label || 'Mi Bot';
  return bot;
}

function setStatusUI(s) {
  const status = s?.status || 'stopped';
  currentBotStatus = status;
  const hasSession = !!s?.hasSession;

  const loadingOverlay = $('#loadingOverlay');
  if (loadingOverlay) {
    if (['starting', 'connecting', 'reconnecting'].includes(status)) {
      loadingOverlay.style.display = 'flex';
    } else {
      loadingOverlay.style.display = 'none';
    }
  }

  // 1. Neon State Box (Encendido/Apagado/Reconectando)
  const neonStateBox = $('#neonStateBox');
  const homeMainCard = $('#homeMainCard');
  if (status === 'connected') {
    neonStateBox.className = 'neon-state-box on';
    $('#estadoText').textContent = 'ENCENDIDO';
    homeMainCard.classList.add('bot-running');
    homeMainCard.classList.remove('bot-stopped');
  } else if (status === 'reconnecting') {
    neonStateBox.className = 'neon-state-box reconnecting';
    $('#estadoText').textContent = 'RECONECTANDO';
    homeMainCard.classList.remove('bot-running');
    homeMainCard.classList.add('bot-stopped');
  } else {
    neonStateBox.className = 'neon-state-box off';
    $('#estadoText').textContent = 'APAGADO';
    homeMainCard.classList.remove('bot-running');
    homeMainCard.classList.add('bot-stopped');
  }

  // Traducción de los estados de conexión en el panel
  const translations = {
    'connected': 'Conectado',
    'stopped': 'Apagado',
    'starting': 'Iniciando',
    'connecting': 'Conectando',
    'reconnecting': 'Reconectando',
    'qr': 'Esperando QR',
    'disconnected': 'Desconectado',
    'logged_out': 'Sesión Cerrada',
    'error': 'Error'
  };

  // 2. Runtime Status
  $('#runtimeText').textContent = translations[status] || status;

  // 3. Stats Panel Fields
  $('#groupsText').textContent = s?.gruposConfigurados ?? 0;
  $('#ordersMetric').textContent = s?.ordenesRecibidas ?? 0;
  
  const answersText = $('#answersText');
  if (answersText) {
    answersText.textContent = s?.respuestas ? 'ON' : 'OFF';
    answersText.style.color = s?.respuestas ? 'var(--success)' : 'var(--danger)';
  }

  // 4. Conditional Controls and QR Layout
  const qrWrapper = $('#qrWrapper');
  const controlGrid = $('#controlGrid');
  const loginBtnWrapper = $('#loginBtnWrapper');
  const logoutBtn = $('#logoutBtn');
  const runtimeStatusBox = $('.runtime-status-box');

  if (hasSession && status !== 'qr') {
    // Hay una sesión activa de WhatsApp (no requiere emparejamiento)
    neonStateBox.style.display = 'flex';
    if (runtimeStatusBox) runtimeStatusBox.style.display = 'flex';
    loginBtnWrapper.style.display = 'none';
    qrWrapper.style.display = 'none';
    controlGrid.style.display = 'grid';
    logoutBtn.style.display = 'block';

    const powerBtn = $('#powerBtn');
    const answersBtn = $('#answersBtn');

    if (status === 'connected') {
      powerBtn.textContent = 'Apagar bot';
      powerBtn.className = 'btn neon-btn-power btn-on';

      answersBtn.style.display = 'inline-flex';
      answersBtn.textContent = s?.respuestas ? 'Desactivar respuestas' : 'Activar respuestas';
      answersBtn.className = s?.respuestas ? 'btn neon-btn-answers btn-on' : 'btn neon-btn-answers btn-off';
    } else {
      powerBtn.textContent = 'Encender bot';
      powerBtn.className = 'btn neon-btn-power btn-stopped';

      // Ocultar botón de respuestas si el bot no está activo
      answersBtn.style.display = 'none';
    }
  } else {
    // No hay sesión activa o se está esperando código QR
    neonStateBox.style.display = 'none';
    if (runtimeStatusBox) runtimeStatusBox.style.display = 'none';
    controlGrid.style.display = 'none';
    logoutBtn.style.display = 'none';
    loginBtnWrapper.style.display = 'block';
    qrWrapper.style.display = 'block';

    // Manejo de renderizado de código QR
    const qrInstructions = $('#qrInstructions');
    const qrBox = $('#qrBox');
    
    if (s?.qr) {
      qrInstructions.style.display = 'none';
      qrBox.innerHTML = `<img src="${s.qr}" alt="QR WhatsApp"><div class="small" style="margin-top:8px;color:var(--muted)">Escanea el código QR con WhatsApp.</div>`;
    } else {
      qrInstructions.style.display = 'block';
      $('#qrPendingText').textContent = 'Sin QR pendiente.';
      qrBox.innerHTML = '';
    }
  }
}

async function loadHome() {
  try {
    await renderBot();
    const s = await IbotApi.status();
    setStatusUI(s);
  } catch (err) {
    if (err.message === 'Sesión requerida') return;
    toast(err.message);
  }
}

function bindHome() {
  bindPanelLogout();
  
  // Dynamic Start (Iniciar sesión)
  $('#startBtn').onclick = async () => { 
    try { 
      await IbotApi.start(); 
      toast('Iniciando servicio de bot...'); 
      await loadHome(); 
    } catch (e) { toast(e.message); } 
  };
  
  // Dynamic Power (Encender/Apagar bot)
  $('#powerBtn').onclick = async () => { 
    if (currentBotStatus === 'connected') {
      if (!confirm('¿Estás seguro de que deseas apagar el bot?')) return;
      try { 
        await IbotApi.stop(); 
        toast('Bot apagado'); 
        await loadHome(); 
      } catch (e) { toast(e.message); } 
    } else {
      try { 
        await IbotApi.start(); 
        toast('Iniciando servicio de bot...'); 
        await loadHome(); 
      } catch (e) { toast(e.message); } 
    }
  };
  
  // Close WhatsApp Session (Cerrar sesión)
  $('#logoutBtn').onclick = async () => {
    if (!confirm('¿Estás seguro de que deseas cerrar la sesión de WhatsApp? Se requerirá escanear el código QR de nuevo.')) return;
    try { 
      await IbotApi.logout(); 
      toast('Sesión de WhatsApp cerrada'); 
      await loadHome(); 
    } catch (e) { toast(e.message); }
  };
  
  // Toggle Answers (Activar/Desactivar respuestas)
  $('#answersBtn').onclick = async () => { 
    try { 
      await IbotApi.toggleRespuestas(); 
      await loadHome(); 
    } catch (e) { toast(e.message); } 
  };

  // Toggle View Panels: Control Panel vs Statistics Panel
  const mainPanelContent = $('#mainPanelContent');
  const statsPanelContent = $('#statsPanelContent');
  const bottomActionsRow = $('.bottom-actions-row');

  $('#statsBtn').onclick = () => {
    mainPanelContent.style.display = 'none';
    bottomActionsRow.style.display = 'none';
    statsPanelContent.style.display = 'block';
  };

  $('#backBtn').onclick = () => {
    statsPanelContent.style.display = 'none';
    mainPanelContent.style.display = 'block';
    bottomActionsRow.style.display = 'flex';
  };
}

// Poll only bot status to avoid exhausting the rate limit.
// At 30s interval: max 30 status requests per 15-min window (well within the 200-req limit).
async function pollStatus() {
  try {
    const s = await IbotApi.status();
    setStatusUI(s);
  } catch (err) {
    if (err.message === 'Sesión requerida') return;
    // Suppress toast on poll errors to avoid flooding the UI; errors are expected during reconnects
  }
}

bindHome();
loadHome();
setInterval(pollStatus, 30000);
