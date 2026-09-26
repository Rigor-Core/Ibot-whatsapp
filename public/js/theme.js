// Tema claro/oscuro del panel. Se carga en <head> para aplicarlo antes de pintar
// la página (sin parpadeo). Sin elección guardada se usa el tema del sistema.
(() => {
  const KEY = 'ibot-theme';
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const resolve = () => stored() || (media.matches ? 'dark' : 'light');
  const apply = () => {
    const theme = resolve();
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#07090d' : '#f5f6f8');
  };
  apply();
  media.addEventListener('change', () => { if (!stored()) apply(); });
  window.IbotTheme = {
    // Elección del usuario: light, dark o auto (según el sistema).
    preference: () => stored() || 'auto',
    set(preference) {
      try {
        if (preference === 'light' || preference === 'dark') localStorage.setItem(KEY, preference);
        else localStorage.removeItem(KEY);
      } catch { /* sin almacenamiento: solo esta visita */ }
      apply();
      document.dispatchEvent(new CustomEvent('themechange', { detail: root.dataset.theme }));
    },
  };
  document.addEventListener('DOMContentLoaded', apply);
})();
