function $(s, root = document) { return root.querySelector(s); }
async function authRequest(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}
async function authStatus() {
  const res = await fetch('/api/auth/status');
  return res.json();
}
function showMsg(message, danger = false) {
  const el = $('#authMsg');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = danger ? 'var(--danger)' : 'var(--muted)';
}
function initPasswordToggles() {
  document.querySelectorAll('.toggle-password-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      const eye = btn.querySelector('.icon-eye');
      const eyeOff = btn.querySelector('.icon-eye-off');
      if (input && input.type === 'password') {
        input.type = 'text';
        if (eye) eye.style.display = 'none';
        if (eyeOff) eyeOff.style.display = 'block';
      } else if (input) {
        input.type = 'password';
        if (eye) eye.style.display = 'block';
        if (eyeOff) eyeOff.style.display = 'none';
      }
    });
  });
}
async function initLogin() {
  initPasswordToggles();
  setTimeout(() => {
    if ($('#username')) $('#username').value = '';
    if ($('#password')) $('#password').value = '';
  }, 60);
  const st = await authStatus().catch(() => null);
  if (st?.authenticated) location.href = '/admin.html';
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn');
    btn.disabled = true;
    showMsg('Iniciando sesión...');
    try {
      await authRequest('/api/auth/login', { username: $('#username').value, password: $('#password').value });
      location.href = '/admin.html';
    } catch (err) {
      showMsg(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}
async function initRegister() {
  initPasswordToggles();
  setTimeout(() => {
    if ($('#username')) $('#username').value = '';
    if ($('#password')) $('#password').value = '';
    if ($('#confirm')) $('#confirm').value = '';
  }, 60);
  const st = await authStatus().catch(() => null);
  if (st?.authenticated && !st?.needsSetup) { location.href = '/admin.html'; return; }
  $('#registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('#password').value;
    const confirm = $('#confirm').value;
    if (password !== confirm) return showMsg('Las contraseñas no coinciden.', true);
    const btn = $('#registerBtn');
    btn.disabled = true;
    showMsg('Creando usuario...');
    try {
      await authRequest('/api/auth/register', { username: $('#username').value, password });
      location.href = '/admin.html';
    } catch (err) {
      showMsg(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}
document.addEventListener('DOMContentLoaded', () => {
  if ($('#loginForm')) initLogin();
  if ($('#registerForm')) initRegister();
});
