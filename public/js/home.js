// Inicio: estado del WhatsApp, vinculación por QR y controles principales.
(() => {
  const STATUS = {
    connected: { title: 'Conectado', tone: 'good' },
    starting: { title: 'Iniciando…', tone: 'warn' },
    connecting: { title: 'Conectando…', tone: 'warn' },
    reconnecting: { title: 'Reconectando…', tone: 'warn' },
    qr: { title: 'Escanea el código QR', tone: 'warn' },
    disconnected: { title: 'Desconectado', tone: 'danger' },
    error: { title: 'Error de conexión', tone: 'danger' },
    logged_out: { title: 'Sin WhatsApp vinculado', tone: '' },
    stopped: { title: 'Apagado', tone: '' },
  };
  const MODES = { repartidor: 'Repartidor', normal: 'Normal (comandos)', watch: 'Watch', ia: 'IA' };
  const BUSY = ['starting', 'connecting', 'reconnecting'];
  let current = null;

  function render(s) {
    if (!s) return;
    current = s;
    const info = STATUS[s.status] || { title: s.status, tone: '' };
    const linked = !!s.hasSession && s.status !== 'qr';
    const running = s.status === 'connected';

    $('#statusOrb').className = `status-orb ${info.tone}`;
    $('#statusTitle').textContent = linked || s.status === 'qr' || BUSY.includes(s.status) ? info.title : 'Sin WhatsApp vinculado';
    $('#statusMeta').textContent = running
      ? 'El bot está trabajando con tu WhatsApp.'
      : linked ? 'Tu WhatsApp está vinculado. Enciéndelo para que el bot trabaje.' : 'Vincula tu WhatsApp para empezar.';
    $('#connState').textContent = info.title.replace('…', '');
    $('#modeState').textContent = MODES[s.modo] || s.modo;
    $('#modeLine').textContent = `Modo ${MODES[s.modo] || s.modo}`;
    const answers = s.respuestas ? 'Activadas' : 'Desactivadas';
    $('#answersState').textContent = answers;
    $('#answersStat').textContent = s.respuestas ? 'ON' : 'OFF';
    $('#answersStat').style.color = s.respuestas ? 'var(--good)' : 'var(--muted)';
    $('#ordersStat').textContent = Number(s.ordenesRecibidas || 0).toLocaleString('es');
    $('#groupsStat').textContent = Number(s.gruposConfigurados || 0).toLocaleString('es');

    // Botones según el estado
    const unlink = $('#unlinkBtn');
    $('#linkBtn').hidden = linked || s.status === 'qr' || BUSY.includes(s.status);
    $('#linkSteps').hidden = linked;
    $('#powerBtn').hidden = !linked;
    $('#powerBtn').textContent = running || BUSY.includes(s.status) ? 'Apagar' : 'Encender';
    $('#powerBtn').className = running || BUSY.includes(s.status) ? 'btn' : 'btn primary';
    $('#answersBtn').hidden = !running;
    $('#answersBtn').textContent = s.respuestas ? 'Desactivar respuestas' : 'Activar respuestas';
    $('#answersBtn').className = s.respuestas ? 'btn' : 'btn success';
    if (unlink) unlink.hidden = !linked;

    // QR
    const showQr = s.status === 'qr' || (!linked && BUSY.includes(s.status));
    $('#qrPanel').hidden = !showQr;
    if (s.qr && s.status === 'qr') {
      $('#qrBox').innerHTML = `<img src="${s.qr}" alt="Código QR para vincular WhatsApp">`;
      $('#qrHint').textContent = 'Escanéalo desde WhatsApp → Dispositivos vinculados.';
    } else if (showQr) {
      $('#qrBox').innerHTML = '<div class="spinner"></div>';
      $('#qrHint').textContent = 'Generando el código QR…';
    }
  }

  async function refresh() {
    try {
      render(await IbotApi.status());
    } catch (err) {
      if (err.message !== 'Sesión requerida') toast(err.message);
    }
  }

  async function run(button, task, message) {
    button.disabled = true;
    try {
      await task();
      if (message) toast(message);
      await refresh();
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
    }
  }

  $('#linkBtn').addEventListener('click', (e) => run(e.currentTarget, () => IbotApi.start(), 'Preparando el código QR…'));
  $('#powerBtn').addEventListener('click', (e) => {
    const on = current?.status === 'connected' || BUSY.includes(current?.status);
    if (on && !confirm('¿Apagar el bot? Dejará de responder hasta que lo enciendas.')) return;
    run(e.currentTarget, () => (on ? IbotApi.stop() : IbotApi.start()), on ? 'Bot apagado' : 'Encendiendo…');
  });
  $('#answersBtn').addEventListener('click', (e) => run(e.currentTarget, () => IbotApi.toggleRespuestas()));
  $('#unlinkBtn')?.addEventListener('click', (e) => {
    if (!confirm('¿Desvincular tu WhatsApp? Para volver a usarlo tendrás que escanear un nuevo QR.')) return;
    run(e.currentTarget, () => IbotApi.logout(), 'WhatsApp desvinculado');
  });

  loadUserBot()
    .then((bot) => { $('#greeting').textContent = `Hola, ${bot.label || 'bienvenido'}`; })
    .catch(() => null);
  refresh();
  // Cambios en tiempo real; el sondeo queda solo de respaldo.
  subscribeLive(({ status }) => render(status));
  setInterval(refresh, 30000);
})();
