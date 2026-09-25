
const _modalContainer = document.createElement('div');
_modalContainer.innerHTML = `<div id="modal" style="display: none;">
    <div class="modal-card" role="dialog" aria-modal="true" style="max-width: 650px;">
      <div
        style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 2px solid var(--accent); padding-bottom: 8px;">
        <div class="modal-title" id="modalTitle"
          style="font-size: 18px; color: var(--accent); text-shadow: 0 0 8px var(--accent-glow); margin-bottom: 0;">
          Nuevo grupo</div>
      </div>

      <form id="form">
        <input type="hidden" id="field-groupId">

        <!-- Sección 1: Identificación -->
        <div
          style="border: 1px solid rgba(0, 229, 255, 0.2); background: rgba(0, 229, 255, 0.02); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
          <div
            style="font-weight: 800; font-size: 12px; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; display: flex; align-items: center; gap: 6px; letter-spacing: 0.5px;">
            <span>🆔</span> Datos de Identificación
          </div>
          <div style="display: flex; gap: 12px; flex-wrap: wrap">
            <div style="flex: 1.2; min-width: 180px">
              <label class="small" style="font-weight: 700;">GroupId</label>
              <input id="field-groupId-input" type="text" placeholder="120363....@g.us"
                style="background: rgba(0,0,0,0.2); border-color: rgba(0,229,255,0.15);">
            </div>
            <div style="flex: 1; min-width: 150px">
              <label class="small" style="font-weight: 700;">Nombre</label>
              <input id="field-nombre" type="text" placeholder="Nombre descriptivo"
                style="background: rgba(0,0,0,0.2);">
            </div>
            <div style="flex: 0.8; min-width: 120px">
              <label class="small" style="font-weight: 700;">Categoría</label>
              <input id="field-grupo" type="text" placeholder="Dueño / categoría" style="background: rgba(0,0,0,0.2);">
            </div>
          </div>
        </div>

        <!-- Sección 2: Configuración de Respuesta -->
        <div
          style="border: 1px solid rgba(57, 255, 106, 0.2); background: rgba(57, 255, 106, 0.02); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
          <div
            style="font-weight: 800; font-size: 12px; text-transform: uppercase; color: #39ff6a; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; letter-spacing: 0.5px;">
            <span>⚙️</span> Configuración de Respuesta
          </div>
          <div style="display: flex; gap: 12px; flex-wrap: wrap">
            <div style="flex: 1; min-width: 140px">
              <label class="small" style="font-weight: 700;">Tipo de mensaje</label>
              <select id="field-tipo" style="background: rgba(0,0,0,0.2);">
                <option value="texto">Texto</option>
                <option value="imagen">Imagen</option>
                <option value="ambas">Ambas</option>
              </select>
            </div>
            <div style="width: 110px">
              <label class="small" style="font-weight: 700;">Responder</label>
              <select id="field-responder" style="background: rgba(0,0,0,0.2);">
                <option value="1">Sí</option>
                <option value="0">No</option>
              </select>
            </div>
            <div style="flex: 1; min-width: 140px">
              <label class="small" style="font-weight: 700;">Duración</label>
              <select id="field-duracion" style="background: rgba(0,0,0,0.2);">
                <option value="0">Desactivado</option>
                <option value="86400">24 horas</option>
                <option value="604800">7 días</option>
                <option value="7776000">90 días</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Sección 3: Límites e Independencia -->
        <div
          style="border: 1px solid rgba(255, 180, 0, 0.2); background: rgba(255, 180, 0, 0.02); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
          <div
            style="font-weight: 800; font-size: 12px; text-transform: uppercase; color: #ffb400; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; letter-spacing: 0.5px;">
            <span>📊</span> Límites e Independencia
          </div>
          <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap">
            <div style="min-width: 150px; display: flex; align-items: center; height: 38px; margin-top: 14px;">
              <label class="small"
                style="font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                <input id="field-independiente" type="checkbox"
                  style="width: 18px; height: 18px; cursor: pointer; margin: 0;">
                Independiente
              </label>
            </div>
            <div style="flex: 1.2; min-width: 150px">
              <label class="small" style="font-weight: 700;">Límite de mensajes (vacío = ∞)</label>
              <input id="field-limite" type="number" placeholder="Ej: 3"
                style="background: rgba(0,0,0,0.2); width: 100%">
            </div>
            <div style="flex: 0.8; min-width: 100px">
              <label class="small" style="font-weight: 700;">Contador</label>
              <input id="field-contador" type="number" min="0" value="0" style="background: rgba(0,0,0,0.2);">
            </div>
          </div>
        </div>

        <!-- Sección 4: Respuesta -->
        <div
          style="border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.01); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
          <div
            style="font-weight: 800; font-size: 12px; text-transform: uppercase; color: #f3f4f6; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; letter-spacing: 0.5px;">
            <span>💬</span> Mensaje a Enviar
          </div>
          <div>
            <textarea id="field-respuesta" placeholder="Escribe el texto que enviará el bot..."
              style="background: rgba(0,0,0,0.25); min-height: 80px; resize: vertical;"></textarea>
          </div>
        </div>

        <!-- Sección 5: Comandos, bienvenida y despedida -->
        <div class="group-command-section"
          style="border: 1px solid rgba(184, 98, 255, 0.25); background: rgba(184, 98, 255, 0.025); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
          <div
            style="font-weight: 800; font-size: 12px; text-transform: uppercase; color: #c889ff; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; letter-spacing: 0.5px;">
            <span>⌘</span> Comandos y eventos del grupo
          </div>
          <label class="small" style="font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
            <input id="field-commands-enabled" type="checkbox" style="width: 18px; height: 18px; margin: 0;">
            Activar comandos, bienvenida y despedida
          </label>
          <div id="group-command-fields">
            <div style="display: grid; grid-template-columns: minmax(110px, .35fr) 1fr; gap: 12px; margin-bottom: 12px;">
              <div>
                <label class="small" style="font-weight: 700;">Prefijo</label>
                <input id="field-command-prefix" type="text" maxlength="4" value="!" placeholder="!"
                  style="background: rgba(0,0,0,0.2);">
              </div>
              <div class="small" style="display:flex; align-items:flex-end; padding-bottom:10px;">
                Ejemplo: <strong style="margin-left:5px; color:#c889ff;">!help</strong>
              </div>
            </div>
            <div class="group-event-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <div>
                <label class="small" style="font-weight:700;">Mensaje de bienvenida</label>
                <textarea id="field-welcome-message" rows="3"
                  placeholder="¡Bienvenido/a {user} a {group}!"
                  style="background:rgba(0,0,0,.2); resize:vertical;"></textarea>
              </div>
              <div>
                <label class="small" style="font-weight:700;">Mensaje de despedida</label>
                <textarea id="field-farewell-message" rows="3"
                  placeholder="{user} ha salido de {group}."
                  style="background:rgba(0,0,0,.2); resize:vertical;"></textarea>
              </div>
            </div>
            <div class="small" style="margin-top:8px;">Variables disponibles: <strong>{user}</strong> y <strong>{group}</strong>. La despedida no se envía cuando se usa el comando ban.</div>
          </div>
        </div>

        <div class="modal-actions"
          style="border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px; margin-top: 0;">
          <button type="button" id="btn-cancel" class="btn danger"
            style="padding: 8px 16px; font-weight: 800; border-radius: 8px;">Cancelar</button>
          <button type="submit" id="btn-save" class="btn"
            style="padding: 8px 24px; font-weight: 800; border-radius: 8px; background: linear-gradient(135deg, var(--accent) 0%, #0088ff 100%); color: #000; box-shadow: 0 0 12px var(--accent-glow);">Guardar</button>
        </div>
      </form>
    </div>
  </div>`;
document.body.appendChild(_modalContainer.firstElementChild);
