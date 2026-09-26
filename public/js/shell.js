// Estructura común del panel de usuario: navegación (barra lateral en PC, riel en
// tablet, barra inferior en teléfono). El tema y el cierre de sesión están en Ajustes.
(() => {
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
    grupos: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    chats: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    contactos: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2.5"/><path d="M5.5 16.5a3.5 3.5 0 0 1 7 0"/><path d="M15 9h3M15 13h3"/>',
    configuracion: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  };
  const PAGES = [
    { id: 'home', href: '/', label: 'Inicio' },
    { id: 'grupos', href: '/grupos.html', label: 'Grupos' },
    { id: 'chats', href: '/chats.html', label: 'Chats' },
    { id: 'contactos', href: '/contactos.html', label: 'Contactos' },
    { id: 'configuracion', href: '/configuracion.html', label: 'Ajustes' },
  ];
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  const current = document.body.dataset.page;
  const nav = document.getElementById('appNav');
  if (!nav) return;

  nav.innerHTML = `
    <div class="app-brand"><div class="app-logo">IB</div><div><div class="app-brand-name">Ibot</div><div class="app-brand-sub">Panel de control</div></div></div>
    ${PAGES.map((page) => `<a class="nav-link${page.id === current ? ' active' : ''}" href="${page.href}" title="${page.label}"${page.id === current ? ' aria-current="page"' : ''}>${icon(page.id)}<span>${page.label}</span></a>`).join('')}
    <div class="nav-footer">
      <a class="nav-user" href="/configuracion.html" title="Mi cuenta y ajustes"><div class="avatar" id="shellAvatar">·</div><div><div class="nav-user-name" id="shellUser">…</div><div class="nav-user-sub">Mi cuenta</div></div></a>
    </div>`;

  IbotApi.authStatus().then((status) => {
    const name = status?.user?.username || '';
    document.getElementById('shellUser').textContent = name;
    document.getElementById('shellAvatar').textContent = name.slice(0, 1).toUpperCase() || '·';
    document.dispatchEvent(new CustomEvent('ibot:user', { detail: name }));
  }).catch(() => null);
})();
