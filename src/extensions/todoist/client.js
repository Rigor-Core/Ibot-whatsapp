// Cliente mínimo de la API v1 de Todoist (https://api.todoist.com/api/v1/).
// Las rutas y parámetros siguen al SDK oficial @doist/todoist-sdk.
const BASE_URL = 'https://api.todoist.com/api/v1/';
const MAX_PAGES = 10;

export class TodoistError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function errorMessage(status, data) {
  if (status === 401) return 'El token de Todoist no es válido o fue revocado.';
  if (status === 403) return 'Todoist no permite esta acción con tu cuenta.';
  if (status === 404) return 'No se encontró en Todoist (quizá se borró o el id es incorrecto).';
  if (status === 429) return 'Todoist recibió demasiadas solicitudes; intenta en un minuto.';
  const detail = data?.error || data?.error_tag || (typeof data === 'string' ? data : '');
  return `Todoist respondió ${status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`;
}

export class TodoistClient {
  constructor(token, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    if (!token) throw new TodoistError('Falta el token de Todoist', 400);
    this.token = token;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(method, path, { query, body } = {}) {
    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
    }
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new TodoistError(error?.name === 'TimeoutError' ? 'Todoist tardó demasiado en responder.' : `No se pudo conectar con Todoist: ${error.message}`, 0);
    }
    if (response.status === 204) return true;
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) throw new TodoistError(errorMessage(response.status, data), response.status);
    return data ?? true;
  }

  // Recorre las páginas (cursor) de un listado hasta `max` elementos.
  async paginate(path, query = {}, { key = 'results', max = 200 } = {}) {
    const items = [];
    let cursor = null;
    for (let page = 0; page < MAX_PAGES && items.length < max; page += 1) {
      const data = await this.request('GET', path, { query: { ...query, cursor, limit: Math.min(200, max - items.length) } });
      items.push(...(data?.[key] || []));
      cursor = data?.next_cursor;
      if (!cursor) break;
    }
    return items.slice(0, max);
  }

  user() { return this.request('GET', 'user'); }

  // Tareas activas
  tasks(query = {}, max) { return this.paginate('tasks', query, { max }); }
  filterTasks(filter, lang, max) { return this.paginate('tasks/filter', { query: filter, lang }, { max }); }
  task(id) { return this.request('GET', `tasks/${encodeURIComponent(id)}`); }
  addTask(body) { return this.request('POST', 'tasks', { body }); }
  quickAdd(text) { return this.request('POST', 'tasks/quick', { body: { text, meta: true } }); }
  updateTask(id, body) { return this.request('POST', `tasks/${encodeURIComponent(id)}`, { body }); }
  closeTask(id) { return this.request('POST', `tasks/${encodeURIComponent(id)}/close`); }
  reopenTask(id) { return this.request('POST', `tasks/${encodeURIComponent(id)}/reopen`); }
  moveTask(id, body) { return this.request('POST', `tasks/${encodeURIComponent(id)}/move`, { body }); }
  deleteTask(id) { return this.request('DELETE', `tasks/${encodeURIComponent(id)}`); }
  completedTasks(query, max) { return this.paginate('tasks/completed/by_completion_date', query, { key: 'items', max }); }

  // Proyectos, secciones, etiquetas y comentarios
  projects() { return this.paginate('projects', {}, { max: 500 }); }
  addProject(body) { return this.request('POST', 'projects', { body }); }
  updateProject(id, body) { return this.request('POST', `projects/${encodeURIComponent(id)}`, { body }); }
  archiveProject(id) { return this.request('POST', `projects/${encodeURIComponent(id)}/archive`); }
  deleteProject(id) { return this.request('DELETE', `projects/${encodeURIComponent(id)}`); }
  sections(projectId) { return this.paginate('sections', { project_id: projectId }, { max: 500 }); }
  addSection(body) { return this.request('POST', 'sections', { body }); }
  updateSection(id, body) { return this.request('POST', `sections/${encodeURIComponent(id)}`, { body }); }
  deleteSection(id) { return this.request('DELETE', `sections/${encodeURIComponent(id)}`); }
  labels() { return this.paginate('labels', {}, { max: 500 }); }
  addLabel(body) { return this.request('POST', 'labels', { body }); }
  deleteLabel(id) { return this.request('DELETE', `labels/${encodeURIComponent(id)}`); }
  comments(query) { return this.paginate('comments', query, { max: 50 }); }
  addComment(body) { return this.request('POST', 'comments', { body }); }
}
