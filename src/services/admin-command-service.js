const VALID_ROLES = new Set(['user', 'admin', 'owner']);

export const ADMIN_COMMAND_CATALOG = Object.freeze([
  { name: 'help', description: 'Muestra la ayuda y los comandos disponibles.' },
  { name: 'status', description: 'Muestra el estado actual del bot.' },
  { name: 'ban', description: 'Expulsa a un usuario del grupo.' },
  { name: 'demote', description: 'Quita permisos de administrador a un usuario.' },
  { name: 'group', description: 'Muestra la información principal del grupo.' },
  { name: 'promote', description: 'Proporciona permisos de administrador.' },
]);

const DEFAULT_ROLES = Object.freeze({
  help: ['user', 'admin', 'owner'],
  status: ['admin', 'owner'],
  ban: ['admin', 'owner'],
  demote: ['owner'],
  group: ['admin', 'owner'],
  promote: ['owner'],
});

function normalizedRoles(value, fallback) {
  const roles = Array.isArray(value)
    ? [...new Set(value.map((role) => String(role).trim().toLowerCase()).filter((role) => VALID_ROLES.has(role)))]
    : [];
  return roles.length ? roles : [...fallback];
}

export function normalizeAdminCommandsConfig(value = {}) {
  const definitions = {};
  for (const command of ADMIN_COMMAND_CATALOG) {
    const raw = value?.definitions?.[command.name] || {};
    definitions[command.name] = {
      enabled: raw.enabled !== false,
      roles: normalizedRoles(raw.roles, DEFAULT_ROLES[command.name]),
    };
  }
  return {
    enabled: value.enabled === true,
    definitions,
  };
}

export function normalizeGroupCommandSettings(value = {}) {
  const prefix = String(value.prefix || '!').trim();
  return {
    enabled: value.enabled === true,
    prefix: prefix && prefix.length <= 4 && !/\s/.test(prefix) ? prefix : '!',
    welcomeMessage: String(
      value.welcomeMessage
      || '¡Bienvenido/a {user} a {group}!',
    ).slice(0, 2000),
    farewellMessage: String(
      value.farewellMessage
      || '{user} ha salido de {group}.',
    ).slice(0, 2000),
  };
}

function normalizedJid(value) {
  const raw = String(value || '').trim().split('/')[0];
  if (!raw) return '';
  const atIndex = raw.indexOf('@');
  if (atIndex === -1) {
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15 ? `${digits}@s.whatsapp.net` : '';
  }
  const user = raw.slice(0, atIndex).split(':')[0];
  const server = raw.slice(atIndex + 1);
  return user && server ? `${user}@${server}` : '';
}

function sameParticipant(left, right) {
  const a = normalizedJid(left);
  const b = normalizedJid(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.split('@')[0] === b.split('@')[0];
}

function participantRole(metadata, senderId) {
  const participant = metadata?.participants?.find((item) => (
    sameParticipant(item.id, senderId)
    || sameParticipant(item.phoneNumber, senderId)
    || sameParticipant(item.lid, senderId)
  ));
  if (sameParticipant(metadata?.owner, senderId) || participant?.admin === 'superadmin' || participant?.isSuperAdmin) {
    return 'owner';
  }
  if (participant?.admin === 'admin' || participant?.isAdmin) return 'admin';
  return 'user';
}

function commandTarget(extracted) {
  const candidates = [
    ...(extracted.mentionedJids || []),
    extracted.quotedParticipant,
  ].filter(Boolean);
  if (candidates.length) return normalizedJid(candidates[0]);
  const firstArgument = String(extracted.text || '').trim().split(/\s+/).slice(1)[0] || '';
  return normalizedJid(firstArgument);
}

function mentionLabel(jid) {
  const user = normalizedJid(jid).split('@')[0];
  return user ? `@${user}` : 'el usuario';
}

async function reply(ctx, extracted, text, mentions = []) {
  return ctx.socket.sendMessage(
    extracted.groupId,
    { text, ...(mentions.length ? { mentions } : {}) },
    { quoted: extracted.raw },
  );
}

function availableHelp(config, role, prefix) {
  return ADMIN_COMMAND_CATALOG
    .filter((command) => {
      const definition = config.definitions[command.name];
      return definition?.enabled && definition.roles.includes(role);
    })
    .map((command) => `${prefix}${command.name} — ${command.description}`)
    .join('\n');
}

export async function handleAdminCommand(extracted, ctx) {
  if (!extracted.isGroup || extracted.fromMe || !extracted.text) return false;
  const globalConfig = normalizeAdminCommandsConfig(ctx.config?.adminCommands);
  const group = ctx.groupsById.get(extracted.groupId);
  const groupConfig = normalizeGroupCommandSettings(group?.commandSettings);
  if (!globalConfig.enabled || !groupConfig.enabled) return false;

  const prefix = groupConfig.prefix;
  if (!extracted.text.startsWith(prefix)) return false;
  const commandName = extracted.text.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase();
  if (!commandName) return false;

  const catalogEntry = ADMIN_COMMAND_CATALOG.find((command) => command.name === commandName);
  if (!catalogEntry) return false;
  const definition = globalConfig.definitions[commandName];
  if (!definition?.enabled) return true;

  const metadata = await ctx.getGroupMetadata(extracted.groupId);
  const role = participantRole(metadata, extracted.senderId);
  if (!definition.roles.includes(role)) {
    await reply(ctx, extracted, 'No tienes permiso para usar este comando.');
    return true;
  }

  if (commandName === 'help') {
    const help = availableHelp(globalConfig, role, prefix);
    await reply(ctx, extracted, help || 'No tienes comandos disponibles en este grupo.');
    return true;
  }

  if (commandName === 'status') {
    const active = ctx.runtimeStatus === 'connected';
    await reply(
      ctx,
      extracted,
      `Estado del bot: ${active ? 'conectado' : ctx.runtimeStatus || 'desconocido'}\n`
      + `Modo principal: ${ctx.config?.modo || 'normal'}\n`
      + `Respuestas principales: ${ctx.config?.respuestas ? 'activadas' : 'desactivadas'}\n`
      + 'Comandos del grupo: activados',
    );
    return true;
  }

  if (commandName === 'group') {
    const participants = Array.isArray(metadata?.participants) ? metadata.participants.length : 0;
    const admins = Array.isArray(metadata?.participants)
      ? metadata.participants.filter((participant) => participant.admin || participant.isAdmin || participant.isSuperAdmin).length
      : 0;
    await reply(
      ctx,
      extracted,
      `Grupo: ${metadata?.subject || group?.nombre || extracted.groupId}\n`
      + `Participantes: ${participants}\n`
      + `Administradores: ${admins}\n`
      + `ID: ${extracted.groupId}`,
    );
    return true;
  }

  const target = commandTarget(extracted);
  if (!target) {
    await reply(ctx, extracted, `Uso: ${prefix}${commandName} @usuario`);
    return true;
  }
  if (sameParticipant(target, extracted.senderId)) {
    await reply(ctx, extracted, 'No puedes aplicar ese comando sobre ti mismo.');
    return true;
  }

  const action = commandName === 'ban' ? 'remove' : commandName;
  try {
    if (commandName === 'ban') ctx.markBanned(extracted.groupId, target);
    await ctx.socket.groupParticipantsUpdate(extracted.groupId, [target], action);
    const messages = {
      ban: `${mentionLabel(target)} fue expulsado del grupo.`,
      promote: `${mentionLabel(target)} ahora es administrador.`,
      demote: `${mentionLabel(target)} dejó de ser administrador.`,
    };
    await reply(ctx, extracted, messages[commandName], [target]);
  } catch (error) {
    if (commandName === 'ban') ctx.unmarkBanned(extracted.groupId, target);
    ctx.logger.warn('commands', 'No se pudo ejecutar un comando administrativo', {
      command: commandName,
      groupId: extracted.groupId,
      target,
      error: error.message,
    });
    await reply(ctx, extracted, `No se pudo ejecutar ${prefix}${commandName}. Verifica que el bot sea administrador.`);
  }
  return true;
}

export function renderGroupEventMessage(template, { userJid, groupName }) {
  const mention = mentionLabel(userJid);
  return String(template || '')
    .replaceAll('{user}', mention)
    .replaceAll('{group}', String(groupName || 'el grupo'))
    .trim();
}
