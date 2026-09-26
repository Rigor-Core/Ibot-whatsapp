// Ajustes → Comandos: comandos de grupo del modo Normal y quién puede usarlos.
const commandCatalog = [
  { name: 'help', description: 'Ayuda con los comandos disponibles.' },
  { name: 'status', description: 'Muestra el estado actual del bot.' },
  { name: 'ban', description: 'Saca a un usuario del grupo.' },
  { name: 'demote', description: 'Quita administrador a un usuario.' },
  { name: 'group', description: 'Muestra la información del grupo.' },
  { name: 'promote', description: 'Proporciona administrador a un usuario.' },
];

const defaultRoles = {
  help: ['user', 'admin', 'owner'],
  status: ['admin', 'owner'],
  ban: ['admin', 'owner'],
  demote: ['owner'],
  group: ['admin', 'owner'],
  promote: ['owner'],
};

let currentCommands = null;

function normalizedCommands(value = {}) {
  const definitions = {};
  for (const command of commandCatalog) {
    const raw = value.definitions?.[command.name] || {};
    definitions[command.name] = {
      enabled: raw.enabled !== false,
      roles: Array.isArray(raw.roles) && raw.roles.length ? raw.roles : defaultRoles[command.name],
    };
  }
  return { enabled: value.enabled === true, definitions };
}

function updateGlobalLabel() {
  const enabled = $('#commandsEnabled').checked;
  $('#commandsEnabledLabel').textContent = enabled ? 'Sistema activado' : 'Sistema desactivado';
}

function roleChip(commandName, role, label) {
  const chip = document.createElement('label');
  chip.className = 'role-chip';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.dataset.command = commandName;
  checkbox.dataset.role = role;
  checkbox.checked = currentCommands.definitions[commandName].roles.includes(role);
  const text = document.createElement('span');
  text.textContent = label;
  chip.append(checkbox, text);
  return chip;
}

function renderCommands() {
  const fragment = document.createDocumentFragment();
  for (const command of commandCatalog) {
    const definition = currentCommands.definitions[command.name];
    const row = document.createElement('div');
    row.className = 'command-row';

    const name = document.createElement('div');
    name.className = 'command-name';
    const token = document.createElement('span');
    token.className = 'command-token';
    token.textContent = command.name;
    name.appendChild(token);

    const description = document.createElement('div');
    description.className = 'command-description';
    description.textContent = command.description;

    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'command-enabled';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.dataset.enabledCommand = command.name;
    enabled.checked = definition.enabled;
    const enabledText = document.createElement('span');
    enabledText.textContent = definition.enabled ? 'Activo' : 'Inactivo';
    enabled.addEventListener('change', () => {
      enabledText.textContent = enabled.checked ? 'Activo' : 'Inactivo';
    });
    enabledLabel.append(enabled, enabledText);

    const roles = document.createElement('div');
    roles.className = 'role-options';
    roles.append(
      roleChip(command.name, 'user', 'User'),
      roleChip(command.name, 'admin', 'Admin'),
      roleChip(command.name, 'owner', 'Owner'),
    );
    row.append(name, description, enabledLabel, roles);
    fragment.appendChild(row);
  }
  $('#commandRows').replaceChildren(fragment);
}

function buildPayload() {
  const definitions = {};
  for (const command of commandCatalog) {
    const roles = [...document.querySelectorAll(`input[data-command="${command.name}"]:checked`)]
      .map((input) => input.dataset.role);
    if (!roles.length) throw new Error(`Selecciona al menos un nivel para ${command.name}`);
    definitions[command.name] = {
      enabled: document.querySelector(`input[data-enabled-command="${command.name}"]`).checked,
      roles,
    };
  }
  return {
    enabled: $('#commandsEnabled').checked,
    definitions,
  };
}

async function saveCommands() {
  let adminCommands;
  try {
    adminCommands = buildPayload();
  } catch (error) {
    toast(error.message);
    return;
  }
  await IbotSettings.save({ adminCommands }, $('#saveCommands'), 'Comandos guardados').catch(() => null);
}

function paintSummary() {
  const active = Object.values(currentCommands.definitions).filter((definition) => definition.enabled).length;
  $('#sumCommands').textContent = currentCommands.enabled ? `Activado · ${active} comando(s)` : 'Sistema desactivado';
}

// La sección no existe si el administrador no permite los comandos.
if ($('#commandRows')) {
  IbotSettings.onConfig((config) => {
    currentCommands = normalizedCommands(config.adminCommands);
    $('#commandsEnabled').checked = currentCommands.enabled;
    updateGlobalLabel();
    renderCommands();
    paintSummary();
  });
  $('#commandsEnabled').addEventListener('change', updateGlobalLabel);
  $('#saveCommands').addEventListener('click', saveCommands);
}
