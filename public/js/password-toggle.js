// Agrega un botón "ver/ocultar" a todos los campos de contraseña de la página,
// incluidos los que se creen después. Los del login y registro ya traen el suyo.
(() => {
  const EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  const style = document.createElement('style');
  style.textContent = `
    .pw-field { position: relative; display: block; width: 100%; }
    .pw-field > input { padding-right: 42px !important; width: 100%; }
    .pw-toggle { position: absolute; top: 50%; right: 8px; transform: translateY(-50%);
      display: grid; place-items: center; width: 30px; height: 30px; padding: 0;
      border: 0; border-radius: 8px; background: transparent; color: inherit; opacity: .6; cursor: pointer; }
    .pw-toggle:hover, .pw-toggle:focus-visible { opacity: 1; }`;
  document.head.appendChild(style);

  function enhance(input) {
    if (input.dataset.pwToggle || input.closest('.password-wrapper, .pw-field')) return;
    input.dataset.pwToggle = 'true';
    const wrapper = document.createElement('span');
    wrapper.className = 'pw-field';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pw-toggle';
    button.innerHTML = EYE;
    button.setAttribute('aria-label', 'Mostrar contraseña');
    button.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.innerHTML = show ? EYE_OFF : EYE;
      button.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });
    wrapper.appendChild(button);
    // Al limpiar el formulario la clave vuelve a quedar oculta.
    input.form?.addEventListener('reset', () => {
      input.type = 'password';
      button.innerHTML = EYE;
    });
  }

  const scan = (root = document) => root.querySelectorAll?.('input[type="password"]').forEach(enhance);
  scan();
  new MutationObserver((mutations) => {
    for (const mutation of mutations) mutation.addedNodes.forEach((node) => node.nodeType === 1 && scan(node));
  }).observe(document.body, { childList: true, subtree: true });
})();
