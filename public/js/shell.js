// Estructura común del panel de usuario: navegación (barra lateral en PC, riel en
// tablet, barra inferior en teléfono), cambio de tema y cierre de sesión.
(() => {
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
    grupos: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    chats: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    contactos: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2.5"/><path d="M5.5 16.5a3.5 3.5 0 0 1 7 0"/><path d="M15 9h3M15 13h3"/>',
    comandos: '<path d="M4 17l6-6-6-6"/><path d="M12 19h8"/>',
    configuracion: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  };
  const PAGES = [
    { id: 'home', href: '/', label: 'Inicio' },
    { id: 'grupos', href: '/grupos.html', label: 'Grupos' },
    { id: 'chats', href: '/chats.html', label: 'Chats' },
    { id: 'contactos', href: '/contactos.html', label: 'Contactos' },
    { id: 'comandos', href: '/comandos.html', label: 'Comandos' },
    { id: 'configuracion', href: '/configuracion.html', label: 'Ajustes' },
  ];
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  const current = document.body.dataset.page;
  const nav = document.getElementById('appNav');
  if (!nav) return;

  const themeIcon = () => icon(window.IbotTheme?.current() === 'dark' ? 'sun' : 'moon');
  const themeLabel = () => (window.IbotTheme?.current() === 'dark' ? 'Tema claro' : 'Tema oscuro');

  nav.innerHTML = `
    <div class="app-brand"><div class="app-logo">IB</div><div><div class="app-brand-name">Ibot</div><div class="app-brand-sub">Panel de control</div></div></div>
    ${PAGES.map((page) => `<a class="nav-link${page.id === current ? ' active' : ''}" href="${page.href}" title="${page.label}"${page.id === current ? ' aria-current="page"' : ''}>${icon(page.id)}<span>${page.label}</span></a>`).join('')}
    <div class="nav-footer">
      <div class="nav-user"><div class="avatar" id="shellAvatar">·</div><div><div class="nav-user-name" id="shellUser">…</div><div class="nav-user-sub">Mi cuenta</div></div></div>
      <button class="nav-link nav-button js-theme" type="button" title="${themeLabel()}">${themeIcon()}<span>${themeLabel()}</span></button>
      <button class="nav-link nav-button js-logout" type="button" title="Cerrar sesión">${icon('logout')}<span>Cerrar sesión</span></button>
    </div>`;

  const content = document.querySelector('.app-content');
  content?.insertAdjacentHTML('afterbegin', `
    <div class="mobile-head">
      <div class="app-logo">IB</div><strong>Ibot</strong><div class="spacer"></div>
      <button class="btn ghost icon js-theme" type="button" title="${themeLabel()}" aria-label="${themeLabel()}">${themeIcon()}</button>
      <button class="btn ghost icon js-logout" type="button" title="Cerrar sesión" aria-label="Cerrar sesión">${icon('logout')}</button>
    </div>`);

  document.querySelectorAll('.js-theme').forEach((button) => button.addEventListener('click', () => window.IbotTheme?.toggle()));
  document.addEventListener('themechange', () => {
    document.querySelectorAll('.js-theme').forEach((button) => {
      const label = button.querySelector('span');
      button.querySelector('svg').outerHTML = themeIcon();
      button.title = themeLabel();
      if (label) label.textContent = themeLabel();
      else button.setAttribute('aria-label', themeLabel());
    });
  });
  document.querySelectorAll('.js-logout').forEach((button) => button.addEventListener('click', async () => {
    await IbotApi.logoutPanel().catch(() => null);
    location.href = '/login.html';
  }));

  IbotApi.authStatus().then((status) => {
    const name = status?.user?.username || '';
    document.getElementById('shellUser').textContent = name;
    document.getElementById('shellAvatar').textContent = name.slice(0, 1).toUpperCase() || '·';
  }).catch(() => null);
})();
