import crypto from 'crypto';
import { decryptSecret, encryptSecret } from '../../core/secrets.js';
import { TodoistClient } from './client.js';

// Extensión Todoist: la IA puede consultar y gestionar tareas, proyectos,
// secciones, etiquetas y comentarios de la cuenta de Todoist del usuario.
const LANGS = ['es', 'en', 'pt', 'fr', 'de', 'it'];
const MAX_TASKS = 150;
const CACHE_TTL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// En la API la prioridad 4 es la más urgente (p1 en la aplicación).
const toApiPriority = (value) => {
  const level = Number(String(value || '').replace(/\D/g, ''));
  return level >= 1 && level <= 4 ? 5 - level : undefined;
};
const toLabel = (priority) => `p${5 - Number(priority || 1)}`;

// Proyectos y secciones cambian poco: se guardan un minuto por cuenta de Todoist.
const lookups = new Map();
function cacheFor(token) {
  const key = crypto.createHash('sha256').update(token).digest('hex');
  let entry = lookups.get(key);
  if (!entry || Date.now() - entry.at > CACHE_TTL_MS) {
    entry = { at: Date.now(), projects: null, sections: new Map() };
    lookups.set(key, entry);
    if (lookups.size > 200) lookups.delete(lookups.keys().next().value);
  }
  return entry;
}

const plain = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function compactTask(task, projectNames) {
  return {
    id: task.id,
    content: task.content,
    ...(task.description ? { description: String(task.description).slice(0, 400) } : {}),
    project: projectNames.get(task.project_id) || task.project_id,
    ...(task.section_id ? { section_id: task.section_id } : {}),
    ...(task.parent_id ? { parent_id: task.parent_id } : {}),
    priority: toLabel(task.priority),
    ...(task.labels?.length ? { labels: task.labels } : {}),
    ...(task.due ? {
      due: {
        date: task.due.date,
        ...(task.due.datetime ? { datetime: task.due.datetime } : {}),
        text: task.due.string,
        recurring: !!task.due.is_recurring,
      },
    } : {}),
    ...(task.deadline?.date ? { deadline: task.deadline.date } : {}),
    ...(task.duration ? { duration: `${task.duration.amount} ${task.duration.unit}` } : {}),
    ...(task.completed_at ? { completed_at: task.completed_at } : {}),
  };
}

// ─── Configuración ─────────────────────────────────────────────────────────
function normalizeConfig(raw = {}) {
  return {
    enabled: raw?.enabled === true,
    apiToken: typeof raw?.apiToken === 'string' ? raw.apiToken : '',
    defaultProject: String(raw?.defaultProject || '').trim().slice(0, 120),
    lang: LANGS.includes(raw?.lang) ? raw.lang : 'es',
    allowDelete: raw?.allowDelete === true,
  };
}

function publicConfig(config) {
  const { apiToken, ...rest } = normalizeConfig(config);
  return { ...rest, tokenSet: !!apiToken };
}

// El token solo cambia si se escribe uno nuevo (se guarda cifrado) o se pide borrarlo.
function mergeUpdate(current, body = {}) {
  const next = normalizeConfig({ ...normalizeConfig(current), ...body, apiToken: normalizeConfig(current).apiToken });
  const token = String(body.apiToken || '').trim();
  if (body.clearApiToken === true) next.apiToken = '';
  else if (token && !token.includes('•')) next.apiToken = encryptSecret(token);
  if (!next.apiToken) next.enabled = false;
  return next;
}

const isConfigured = (config) => !!decryptSecret(config?.apiToken);
const clientFor = (config) => new TodoistClient(decryptSecret(config.apiToken));

// ─── Búsquedas de proyectos y secciones por nombre o id ─────────────────────
async function projectList(client, config) {
  const cache = cacheFor(decryptSecret(config.apiToken));
  if (!cache.projects) cache.projects = await client.projects();
  return cache.projects;
}

async function resolveProject(client, config, value) {
  const wanted = String(value || '').trim();
  if (!wanted) return null;
  const projects = await projectList(client, config);
  const found = projects.find((project) => project.id === wanted)
    || projects.find((project) => plain(project.name) === plain(wanted))
    || (['inbox', 'bandeja de entrada', 'entrada'].includes(plain(wanted)) ? projects.find((project) => project.inbox_project) : null)
    || projects.find((project) => plain(project.name).includes(plain(wanted)));
  if (!found) throw new Error(`No existe el proyecto "${wanted}" en Todoist`);
  return found;
}

async function resolveSection(client, config, value, projectId) {
  const wanted = String(value || '').trim();
  if (!wanted) return null;
  const cache = cacheFor(decryptSecret(config.apiToken));
  const key = projectId || '*';
  if (!cache.sections.has(key)) cache.sections.set(key, await client.sections(projectId));
  const sections = cache.sections.get(key);
  const found = sections.find((section) => section.id === wanted)
    || sections.find((section) => plain(section.name) === plain(wanted))
    || sections.find((section) => plain(section.name).includes(plain(wanted)));
  if (!found) throw new Error(`No existe la sección "${wanted}"`);
  return found;
}

async function projectNames(client, config) {
  const projects = await projectList(client, config);
  return new Map(projects.map((project) => [project.id, project.name]));
}

function dueFields(args) {
  if (args.clear_due) return { due_string: 'no date' };
  if (args.due_datetime) return { due_datetime: String(args.due_datetime) };
  if (args.due_date) return { due_date: String(args.due_date) };
  if (args.due_string) return { due_string: String(args.due_string) };
  return {};
}

function isoDay(value, fallback) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : fallback;
}

// ─── Herramientas para la IA ───────────────────────────────────────────────
const str = (description) => ({ type: 'string', description });
const TOOLS = [
  {
    name: 'todoist_list_tasks',
    description: 'Lista tareas activas (pendientes) de Todoist. Usa "filter" con la sintaxis de filtros de Todoist: "today", "overdue", "today | overdue", "tomorrow", "7 days", "no date", "p1", "#Proyecto", "@etiqueta", "search: palabra", "assigned to: me". Sin filtro devuelve todas.',
    parameters: {
      type: 'object',
      properties: {
        filter: str('Filtro de Todoist, por ejemplo "today | overdue"'),
        project: str('Nombre o id del proyecto (opcional)'),
        label: str('Nombre de la etiqueta (opcional)'),
        limit: { type: 'integer', description: 'Máximo de tareas (por defecto 60)' },
      },
    },
  },
  {
    name: 'todoist_get_task',
    description: 'Muestra el detalle de una tarea y sus comentarios.',
    parameters: { type: 'object', properties: { task_id: str('Id de la tarea') }, required: ['task_id'] },
  },
  {
    name: 'todoist_create_task',
    description: 'Crea una tarea. Para fechas usa due_string en lenguaje natural ("mañana 5pm", "cada lunes") o due_date AAAA-MM-DD.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        content: str('Título de la tarea'),
        description: str('Descripción (opcional)'),
        due_string: str('Fecha en lenguaje natural'),
        due_date: str('Fecha AAAA-MM-DD'),
        due_datetime: str('Fecha y hora RFC3339'),
        priority: str('p1 (urgente) a p4 (normal)'),
        labels: { type: 'array', items: { type: 'string' }, description: 'Etiquetas' },
        project: str('Proyecto (nombre o id)'),
        section: str('Sección (nombre o id)'),
        parent_task_id: str('Id de la tarea padre para crear una subtarea'),
        deadline_date: str('Fecha límite AAAA-MM-DD'),
        duration_minutes: { type: 'integer', description: 'Duración estimada en minutos' },
      },
      required: ['content'],
    },
  },
  {
    name: 'todoist_quick_add',
    description: 'Crea una tarea con el texto rápido de Todoist, que entiende fechas, #proyecto, @etiqueta y p1-p4. Ej.: "Pagar luz el viernes #Casa p2".',
    write: true,
    parameters: { type: 'object', properties: { text: str('Texto de la tarea') }, required: ['text'] },
  },
  {
    name: 'todoist_update_task',
    description: 'Edita una tarea: título, descripción, fecha, prioridad, etiquetas o fecha límite. clear_due=true quita la fecha.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        task_id: str('Id de la tarea'),
        content: str('Nuevo título'),
        description: str('Nueva descripción'),
        due_string: str('Nueva fecha en lenguaje natural'),
        due_date: str('Nueva fecha AAAA-MM-DD'),
        due_datetime: str('Nueva fecha y hora RFC3339'),
        clear_due: { type: 'boolean', description: 'Quitar la fecha' },
        priority: str('p1 a p4'),
        labels: { type: 'array', items: { type: 'string' }, description: 'Etiquetas (reemplaza las actuales)' },
        deadline_date: str('Fecha límite AAAA-MM-DD'),
      },
      required: ['task_id'],
    },
  },
  {
    name: 'todoist_complete_task',
    description: 'Marca una tarea como completada (si es recurrente pasa a su siguiente fecha).',
    write: true,
    parameters: { type: 'object', properties: { task_id: str('Id de la tarea') }, required: ['task_id'] },
  },
  {
    name: 'todoist_reopen_task',
    description: 'Vuelve a abrir una tarea completada.',
    write: true,
    parameters: { type: 'object', properties: { task_id: str('Id de la tarea') }, required: ['task_id'] },
  },
  {
    name: 'todoist_move_task',
    description: 'Mueve una tarea a otro proyecto, sección o tarea padre.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        task_id: str('Id de la tarea'),
        project: str('Proyecto destino (nombre o id)'),
        section: str('Sección destino (nombre o id)'),
        parent_task_id: str('Tarea padre destino'),
      },
      required: ['task_id'],
    },
  },
  {
    name: 'todoist_delete_task',
    description: 'Borra una tarea definitivamente. Úsalo solo si el usuario lo pide de forma explícita.',
    write: true,
    destructive: true,
    parameters: { type: 'object', properties: { task_id: str('Id de la tarea') }, required: ['task_id'] },
  },
  {
    name: 'todoist_completed_tasks',
    description: 'Tareas completadas entre dos fechas (máximo 90 días). Por defecto, los últimos 7 días.',
    parameters: {
      type: 'object',
      properties: {
        since: str('Desde AAAA-MM-DD'),
        until: str('Hasta AAAA-MM-DD'),
        project: str('Proyecto (opcional)'),
      },
    },
  },
  {
    name: 'todoist_list_projects',
    description: 'Lista los proyectos (y opcionalmente sus secciones) y las etiquetas.',
    parameters: { type: 'object', properties: { include_sections: { type: 'boolean', description: 'Incluir secciones' } } },
  },
  {
    name: 'todoist_create_project',
    description: 'Crea un proyecto (opcionalmente dentro de otro).',
    write: true,
    parameters: {
      type: 'object',
      properties: { name: str('Nombre'), parent: str('Proyecto padre (nombre o id)'), favorite: { type: 'boolean' } },
      required: ['name'],
    },
  },
  {
    name: 'todoist_update_project',
    description: 'Renombra un proyecto o lo marca como favorito.',
    write: true,
    parameters: {
      type: 'object',
      properties: { project: str('Proyecto (nombre o id)'), name: str('Nuevo nombre'), favorite: { type: 'boolean' } },
      required: ['project'],
    },
  },
  {
    name: 'todoist_archive_project',
    description: 'Archiva un proyecto.',
    write: true,
    parameters: { type: 'object', properties: { project: str('Proyecto (nombre o id)') }, required: ['project'] },
  },
  {
    name: 'todoist_delete_project',
    description: 'Borra un proyecto con todas sus tareas. Solo si el usuario lo pide de forma explícita.',
    write: true,
    destructive: true,
    parameters: { type: 'object', properties: { project: str('Proyecto (nombre o id)') }, required: ['project'] },
  },
  {
    name: 'todoist_create_section',
    description: 'Crea una sección dentro de un proyecto.',
    write: true,
    parameters: { type: 'object', properties: { project: str('Proyecto'), name: str('Nombre de la sección') }, required: ['project', 'name'] },
  },
  {
    name: 'todoist_create_label',
    description: 'Crea una etiqueta personal.',
    write: true,
    parameters: { type: 'object', properties: { name: str('Nombre de la etiqueta') }, required: ['name'] },
  },
  {
    name: 'todoist_add_comment',
    description: 'Agrega un comentario a una tarea.',
    write: true,
    parameters: { type: 'object', properties: { task_id: str('Id de la tarea'), content: str('Comentario') }, required: ['task_id', 'content'] },
  },
];

function tools(config) {
  return TOOLS.filter((tool) => !tool.destructive || normalizeConfig(config).allowDelete);
}

async function listTasks(client, config, args, names) {
  const limit = Math.min(Math.max(Number(args.limit) || 60, 1), MAX_TASKS);
  let tasks;
  if (args.filter) {
    tasks = await client.filterTasks(String(args.filter), config.lang, limit);
  } else {
    const project = args.project ? await resolveProject(client, config, args.project) : null;
    tasks = await client.tasks({ project_id: project?.id, label: args.label }, limit);
  }
  return { total: tasks.length, tasks: tasks.map((task) => compactTask(task, names)) };
}

async function execute(name, args = {}, { config }) {
  const cfg = normalizeConfig(config);
  const client = clientFor(cfg);
  const names = await projectNames(client, cfg);
  const forget = () => lookups.delete(crypto.createHash('sha256').update(decryptSecret(cfg.apiToken)).digest('hex'));

  switch (name) {
    case 'todoist_list_tasks':
      return listTasks(client, cfg, args, names);
    case 'todoist_get_task': {
      const [task, comments] = await Promise.all([
        client.task(args.task_id),
        client.comments({ task_id: args.task_id }).catch(() => []),
      ]);
      return { task: compactTask(task, names), comments: comments.map((comment) => ({ content: comment.content, posted_at: comment.posted_at })) };
    }
    case 'todoist_create_task': {
      const project = await resolveProject(client, cfg, args.project || cfg.defaultProject).catch((error) => {
        if (args.project) throw error;
        return null;
      });
      const section = args.section ? await resolveSection(client, cfg, args.section, project?.id) : null;
      const duration = Number(args.duration_minutes) > 0 ? { duration: Math.round(Number(args.duration_minutes)), duration_unit: 'minute' } : {};
      const task = await client.addTask({
        content: String(args.content),
        ...(args.description ? { description: String(args.description) } : {}),
        ...(project ? { project_id: project.id } : {}),
        ...(section ? { section_id: section.id } : {}),
        ...(args.parent_task_id ? { parent_id: String(args.parent_task_id) } : {}),
        ...(Array.isArray(args.labels) ? { labels: args.labels.map(String) } : {}),
        ...(toApiPriority(args.priority) ? { priority: toApiPriority(args.priority) } : {}),
        ...(args.deadline_date ? { deadline_date: String(args.deadline_date) } : {}),
        ...dueFields(args),
        due_lang: cfg.lang,
        ...duration,
      });
      return { created: compactTask(task, names) };
    }
    case 'todoist_quick_add':
      return { created: compactTask(await client.quickAdd(String(args.text)), names) };
    case 'todoist_update_task': {
      const task = await client.updateTask(args.task_id, {
        ...(args.content ? { content: String(args.content) } : {}),
        ...(args.description !== undefined ? { description: String(args.description) } : {}),
        ...(Array.isArray(args.labels) ? { labels: args.labels.map(String) } : {}),
        ...(toApiPriority(args.priority) ? { priority: toApiPriority(args.priority) } : {}),
        ...(args.deadline_date ? { deadline_date: String(args.deadline_date) } : {}),
        ...dueFields(args),
        ...(args.due_string ? { due_lang: cfg.lang } : {}),
      });
      return { updated: compactTask(task, names) };
    }
    case 'todoist_complete_task':
      await client.closeTask(args.task_id);
      return { completed: args.task_id };
    case 'todoist_reopen_task':
      await client.reopenTask(args.task_id);
      return { reopened: args.task_id };
    case 'todoist_move_task': {
      const project = args.project ? await resolveProject(client, cfg, args.project) : null;
      const section = args.section ? await resolveSection(client, cfg, args.section, project?.id) : null;
      const body = section ? { section_id: section.id } : project ? { project_id: project.id } : args.parent_task_id ? { parent_id: String(args.parent_task_id) } : null;
      if (!body) throw new Error('Indica el proyecto, la sección o la tarea padre de destino');
      return { moved: compactTask(await client.moveTask(args.task_id, body), names) };
    }
    case 'todoist_delete_task':
      if (!cfg.allowDelete) throw new Error('El usuario no permite borrar desde la IA');
      await client.deleteTask(args.task_id);
      return { deleted: args.task_id };
    case 'todoist_completed_tasks': {
      const today = new Date().toISOString().slice(0, 10);
      const until = isoDay(args.until, today);
      let since = isoDay(args.since, new Date(Date.now() - 7 * DAY_MS).toISOString().slice(0, 10));
      if (Date.parse(until) - Date.parse(since) > 90 * DAY_MS) since = new Date(Date.parse(until) - 90 * DAY_MS).toISOString().slice(0, 10);
      const project = args.project ? await resolveProject(client, cfg, args.project) : null;
      const items = await client.completedTasks({
        since: `${since}T00:00:00Z`,
        until: `${until}T23:59:59Z`,
        project_id: project?.id,
      }, MAX_TASKS);
      return { since, until, total: items.length, tasks: items.map((task) => compactTask(task, names)) };
    }
    case 'todoist_list_projects': {
      const [projects, labels] = await Promise.all([projectList(client, cfg), client.labels().catch(() => [])]);
      const sections = args.include_sections ? await client.sections() : [];
      return {
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          ...(project.parent_id ? { parent: names.get(project.parent_id) || project.parent_id } : {}),
          ...(project.inbox_project ? { inbox: true } : {}),
          ...(project.is_favorite ? { favorite: true } : {}),
          ...(args.include_sections ? { sections: sections.filter((section) => section.project_id === project.id).map((section) => ({ id: section.id, name: section.name })) } : {}),
        })),
        labels: labels.map((label) => label.name),
      };
    }
    case 'todoist_create_project': {
      const parent = args.parent ? await resolveProject(client, cfg, args.parent) : null;
      const project = await client.addProject({ name: String(args.name), ...(parent ? { parent_id: parent.id } : {}), ...(args.favorite ? { is_favorite: true } : {}) });
      forget();
      return { created: { id: project.id, name: project.name } };
    }
    case 'todoist_update_project': {
      const project = await resolveProject(client, cfg, args.project);
      const updated = await client.updateProject(project.id, {
        ...(args.name ? { name: String(args.name) } : {}),
        ...(typeof args.favorite === 'boolean' ? { is_favorite: args.favorite } : {}),
      });
      forget();
      return { updated: { id: updated.id, name: updated.name } };
    }
    case 'todoist_archive_project': {
      const project = await resolveProject(client, cfg, args.project);
      await client.archiveProject(project.id);
      forget();
      return { archived: project.name };
    }
    case 'todoist_delete_project': {
      if (!cfg.allowDelete) throw new Error('El usuario no permite borrar desde la IA');
      const project = await resolveProject(client, cfg, args.project);
      await client.deleteProject(project.id);
      forget();
      return { deleted: project.name };
    }
    case 'todoist_create_section': {
      const project = await resolveProject(client, cfg, args.project);
      const section = await client.addSection({ name: String(args.name), project_id: project.id });
      forget();
      return { created: { id: section.id, name: section.name, project: project.name } };
    }
    case 'todoist_create_label': {
      const label = await client.addLabel({ name: String(args.name) });
      return { created: label.name };
    }
    case 'todoist_add_comment': {
      const comment = await client.addComment({ task_id: String(args.task_id), content: String(args.content) });
      return { created: { id: comment.id, content: comment.content } };
    }
    default:
      throw new Error(`Herramienta de Todoist desconocida: ${name}`);
  }
}

// Comprueba el token mostrando a quién pertenece.
async function test(config) {
  const user = await clientFor(normalizeConfig(config)).user();
  return { ok: true, detail: `Conectado como ${user.full_name || user.email || 'tu cuenta'}` };
}

// Describe la acción para la notificación "La IA usó una extensión".
function describe(name, args, result) {
  const labels = {
    todoist_create_task: () => `Creó la tarea «${result?.created?.content || args.content}»`,
    todoist_quick_add: () => `Creó la tarea «${result?.created?.content || args.text}»`,
    todoist_update_task: () => `Editó la tarea «${result?.updated?.content || args.task_id}»`,
    todoist_complete_task: () => 'Completó una tarea',
    todoist_reopen_task: () => 'Reabrió una tarea',
    todoist_move_task: () => `Movió la tarea «${result?.moved?.content || args.task_id}»`,
    todoist_delete_task: () => 'Borró una tarea',
    todoist_create_project: () => `Creó el proyecto «${args.name}»`,
    todoist_update_project: () => `Editó el proyecto «${args.project}»`,
    todoist_archive_project: () => `Archivó el proyecto «${args.project}»`,
    todoist_delete_project: () => `Borró el proyecto «${args.project}»`,
    todoist_create_section: () => `Creó la sección «${args.name}»`,
    todoist_create_label: () => `Creó la etiqueta «${args.name}»`,
    todoist_add_comment: () => 'Agregó un comentario a una tarea',
  };
  return labels[name]?.() || name;
}

export default Object.freeze({
  id: 'todoist',
  name: 'Todoist',
  description: 'La IA consulta y gestiona tus tareas: qué tienes para hoy, crear, editar, completar, mover o comentar tareas y organizar proyectos.',
  fields: [
    { key: 'apiToken', label: 'Token de API de Todoist', type: 'secret', help: 'En Todoist: Configuración → Integraciones → Desarrollador → Token de API.' },
    { key: 'defaultProject', label: 'Proyecto para tareas nuevas', type: 'text', placeholder: 'Vacío = Bandeja de entrada' },
    { key: 'lang', label: 'Idioma de las fechas', type: 'select', options: [['es', 'Español'], ['en', 'English'], ['pt', 'Português'], ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano']] },
    { key: 'allowDelete', label: 'Permitir que la IA borre tareas y proyectos', type: 'toggle' },
  ],
  examples: ['¿Qué tengo pendiente hoy en Todoist?', 'Marca como completada la tarea de pagar la luz', 'Crea una tarea: llamar a Juan mañana a las 10'],
  normalizeConfig,
  publicConfig,
  mergeUpdate,
  isConfigured,
  tools,
  isWrite: (name) => !!TOOLS.find((tool) => tool.name === name)?.write,
  execute,
  test,
  describe,
});
