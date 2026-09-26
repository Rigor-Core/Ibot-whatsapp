// Ventanas de confirmación y de texto con el estilo del panel (en lugar de
// confirm/prompt del navegador). Devuelven una promesa.
// eslint-disable-next-line no-unused-vars
const IbotDialog = (() => {
  let modal = null;
  let resolver = null;

  function build() {
    modal = document.createElement('div');
    modal.className = 'modal dialog-modal';
    modal.innerHTML = `
      <form class="modal-card" role="dialog" aria-modal="true" aria-labelledby="dlgTitle" style="max-width:420px">
        <div class="modal-title" id="dlgTitle"></div>
        <div class="modal-sub" id="dlgText"></div>
        <label class="field" id="dlgField" hidden><span id="dlgLabel"></span><input id="dlgInput" maxlength="120"></label>
        <div class="form-actions">
          <button class="btn ghost" type="button" data-dlg="cancel"></button>
          <button class="btn primary" type="submit" data-dlg="ok"></button>
        </div>
      </form>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('[data-dlg="cancel"]')) finish(null);
    });
    modal.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      finish(modal.querySelector('#dlgField').hidden ? true : modal.querySelector('#dlgInput').value.trim());
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.classList.contains('open')) finish(null);
    });
  }

  function finish(value) {
    modal.classList.remove('open');
    const resolve = resolver;
    resolver = null;
    resolve?.(value);
  }

  function open({ title, text = '', confirmText = 'Aceptar', cancelText = 'Cancelar', danger = false, input = null }) {
    if (!modal) build();
    if (resolver) finish(null);
    modal.querySelector('#dlgTitle').textContent = title;
    modal.querySelector('#dlgText').textContent = text;
    modal.querySelector('#dlgText').hidden = !text;
    modal.querySelector('[data-dlg="cancel"]').textContent = cancelText;
    const ok = modal.querySelector('[data-dlg="ok"]');
    ok.textContent = confirmText;
    ok.className = `btn ${danger ? 'danger' : 'primary'}`;
    const field = modal.querySelector('#dlgField');
    field.hidden = !input;
    if (input) {
      modal.querySelector('#dlgLabel').textContent = input.label || '';
      const inputEl = modal.querySelector('#dlgInput');
      inputEl.value = input.value || '';
      inputEl.placeholder = input.placeholder || '';
    }
    modal.classList.add('open');
    setTimeout(() => (input ? modal.querySelector('#dlgInput') : ok).focus(), 30);
    return new Promise((resolve) => { resolver = resolve; });
  }

  return {
    confirm: async (options) => (await open(options)) === true,
    prompt: async ({ label, value, placeholder, ...options }) => {
      const result = await open({ ...options, input: { label, value, placeholder } });
      return typeof result === 'string' ? result : null;
    },
  };
})();
