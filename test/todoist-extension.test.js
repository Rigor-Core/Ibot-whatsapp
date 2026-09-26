import test from 'node:test';
import assert from 'node:assert/strict';
import todoist from '../src/extensions/todoist/index.js';
import { extensionTools, publicExtensions, runExtensionTool } from '../src/extensions/index.js';
import { normalizePermissions } from '../src/services/permissions.js';

process.env.PANEL_SECRET = 'secreto-de-prueba';

// API de Todoist simulada: registra las peticiones y responde según la ruta.
function mockTodoist() {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const { pathname, searchParams } = new URL(url);
    calls.push({ method: options.method, path: pathname.replace('/api/v1/', ''), query: Object.fromEntries(searchParams), body: options.body ? JSON.parse(options.body) : null, auth: options.headers?.Authorization });
    const path = pathname.replace('/api/v1/', '');
    const json = (data) => new Response(JSON.stringify(data), { status: 200 });
    if (path === 'projects') return json({ results: [{ id: 'p1', name: 'Inbox', inbox_project: true }, { id: 'p2', name: 'Casa' }], next_cursor: null });
    if (path === 'tasks/filter') {
      return json({ results: [{ id: 't1', content: 'Pagar la luz', project_id: 'p2', priority: 4, labels: [], due: { date: '2026-09-26', string: 'hoy', is_recurring: false } }], next_cursor: null });
    }
    if (path === 'tasks' && options.method === 'POST') return json({ id: 't9', project_id: calls.at(-1).body.project_id, priority: calls.at(-1).body.priority, labels: [], ...calls.at(-1).body });
    if (/^tasks\/\w+\/close$/.test(path)) return new Response(null, { status: 204 });
    if (path === 'user') return json({ full_name: 'Ana Pérez' });
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  };
  return calls;
}

const configured = (extra = {}) => todoist.mergeUpdate({}, { apiToken: 'tok-123', enabled: true, ...extra });

test('el token se guarda cifrado y nunca se expone', () => {
  const config = configured();
  assert.match(config.apiToken, /^enc:v1:/);
  assert.equal(config.enabled, true);
  assert.deepEqual(todoist.publicConfig(config), { enabled: true, defaultProject: '', lang: 'es', allowDelete: false, tokenSet: true });
  // Sin token no se puede activar; y "borrar token" la apaga.
  assert.equal(todoist.mergeUpdate({}, { enabled: true }).enabled, false);
  assert.equal(todoist.mergeUpdate(config, { clearApiToken: true }).apiToken, '');
  // Guardar sin escribir otro token conserva el anterior.
  assert.equal(todoist.mergeUpdate(config, { lang: 'en' }).apiToken, config.apiToken);
});

test('lista las tareas de hoy con el filtro de Todoist', async () => {
  const calls = mockTodoist();
  const result = await todoist.execute('todoist_list_tasks', { filter: 'today | overdue' }, { config: configured() });
  const filter = calls.find((call) => call.path === 'tasks/filter');
  assert.deepEqual(filter.query, { query: 'today | overdue', lang: 'es', limit: '60' });
  assert.equal(filter.auth, 'Bearer tok-123');
  assert.deepEqual(result.tasks[0], {
    id: 't1', content: 'Pagar la luz', project: 'Casa', priority: 'p1', due: { date: '2026-09-26', text: 'hoy', recurring: false },
  });
});

test('crea tareas resolviendo el proyecto por nombre y completa tareas', async () => {
  const calls = mockTodoist();
  const config = configured();
  const created = await todoist.execute('todoist_create_task', { content: 'Comprar pan', project: 'casa', priority: 'p2', due_string: 'mañana 5pm' }, { config });
  const body = calls.find((call) => call.path === 'tasks' && call.method === 'POST').body;
  assert.deepEqual([body.project_id, body.priority, body.due_string, body.due_lang], ['p2', 3, 'mañana 5pm', 'es']);
  assert.equal(created.created.project, 'Casa');

  await todoist.execute('todoist_complete_task', { task_id: 't1' }, { config });
  assert.ok(calls.some((call) => call.method === 'POST' && call.path === 'tasks/t1/close'));
  await assert.rejects(todoist.execute('todoist_create_task', { content: 'x', project: 'No existe' }, { config }), /No existe el proyecto/);
});

test('borrar solo está disponible si el usuario lo permite', async () => {
  mockTodoist();
  assert.ok(!todoist.tools(configured()).some((tool) => tool.name === 'todoist_delete_task'));
  assert.ok(todoist.tools(configured({ allowDelete: true })).some((tool) => tool.name === 'todoist_delete_task'));
  await assert.rejects(todoist.execute('todoist_delete_task', { task_id: 't1' }, { config: configured() }), /no permite borrar/);
});

test('registro de extensiones: herramientas, acciones y permisos', async () => {
  mockTodoist();
  const extensions = { todoist: configured() };
  assert.ok(extensionTools(extensions).some((tool) => tool.function.name === 'todoist_list_tasks'));
  assert.deepEqual(extensionTools({ todoist: { ...configured(), enabled: false } }), []);

  const run = await runExtensionTool(extensions, 'todoist_complete_task', { task_id: 't1' });
  assert.equal(run.write, true);
  assert.equal(run.summary, 'Completó una tarea');
  assert.equal(await runExtensionTool(extensions, 'otra_herramienta', {}), null);

  // Las extensiones vienen apagadas hasta que el administrador las permite.
  assert.equal(normalizePermissions({}).extensions.todoist, false);
  assert.deepEqual(publicExtensions(extensions, normalizePermissions({})), []);
  const allowed = publicExtensions(extensions, normalizePermissions({ extensions: { todoist: true } }));
  assert.equal(allowed[0].configured, true);
  assert.equal(allowed[0].config.apiToken, undefined);

  assert.deepEqual(await todoist.test(configured()), { ok: true, detail: 'Conectado como Ana Pérez' });
});
