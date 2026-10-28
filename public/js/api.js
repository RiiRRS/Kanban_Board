// Tutte le chiamate al server. Nessun altro file usa fetch (né EventSource).

import {
  getCache,
  setCache,
  removeCache,
  clearUserCache,
  tasksKey,
  boardKey,
  boardsKey,
  commentsKey,
  rememberCommentsTask,
} from './cache.js';

export class ApiError extends Error {
  constructor(message, status = 0, field = null, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
    this.details = details;
  }

  // 'time_conflict', 'wip_limit', 'column_not_empty': richieste da confermare
  get code() {
    return this.details?.code ?? null;
  }
}

// ---------------------------------------------------------------------------
// Richieste
// ---------------------------------------------------------------------------

async function request(method, path, body, extraHeaders = {}) {
  const raw = body instanceof Blob;
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      // X-Requested-With: il server lo pretende nelle richieste che modificano dati (CSRF)
      headers: {
        'X-Requested-With': 'kanban',
        ...(body && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      body: body ? (raw ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new ApiError('Impossibile contattare il server. Controlla la connessione.', 0);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      data?.error || 'Errore del server, riprova',
      res.status,
      data?.field ?? null,
      data,
    );
  }
  return data;
}

// rotte protette: su 401 svuota la cache e manda al login
async function authed(method, path, body, extraHeaders) {
  try {
    return await request(method, path, body, extraHeaders);
  } catch (err) {
    if (err.status === 401) {
      clearUserCache();
      location.replace('login.html');
    }
    throw err;
  }
}

// id dell'utente loggato, preso dalla cache di getMe/login (serve per le chiavi della cache)
const cachedUserId = () => getCache('me')?.id ?? null;

// legge dalla cache (se c'è) e poi dal server, salvando il risultato
async function cachedGet(key, path, onCache) {
  if (key && typeof onCache === 'function') {
    const cached = getCache(key);
    if (Array.isArray(cached?.items) || cached?.value) onCache(cached.items ?? cached.value);
  }
  return authed('GET', path);
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export async function register(username, password) {
  const user = await request('POST', '/api/register', { username, password });
  setCache('me', user);
  return user;
}

export async function login(username, password) {
  const user = await request('POST', '/api/login', { username, password });
  setCache('me', user);
  return user;
}

export async function logout() {
  try {
    await request('POST', '/api/logout');
  } catch {
    // senza rete si esce lo stesso: la sessione scade da sola
  }
  clearUserCache();
}

export async function getMe() {
  try {
    const user = await request('GET', '/api/me');
    setCache('me', user);
    return user;
  } catch (err) {
    if (err.status === 401) {
      removeCache('me');
      return null;
    }
    // offline: va bene l'utente in cache
    const cached = err.status === 0 ? getCache('me') : null;
    if (cached) return cached;
    throw err;
  }
}

export async function updateProfile(data) {
  const user = await authed('PATCH', '/api/me', data);
  setCache('me', user);
  return user;
}

export const changePassword = (currentPassword, newPassword) =>
  authed('POST', '/api/me/password', { currentPassword, newPassword });

export const getUsers = () => authed('GET', '/api/users');

// ---------------------------------------------------------------------------
// Board, colonne, etichette
// ---------------------------------------------------------------------------

export async function getBoards({ onCache } = {}) {
  const userId = cachedUserId();
  const key = userId == null ? null : boardsKey(userId);
  const boards = await cachedGet(key, '/api/boards', onCache);
  if (key) setCache(key, { savedAt: Date.now(), items: boards });
  return boards;
}

export async function getBoard(id, { onCache } = {}) {
  const userId = cachedUserId();
  const key = userId == null ? null : boardKey(userId, id);
  if (key && typeof onCache === 'function') {
    const cached = getCache(key);
    if (cached?.value) onCache(cached.value);
  }
  const board = await authed('GET', `/api/boards/${id}`);
  if (key) setCache(key, { savedAt: Date.now(), value: board });
  return board;
}

export const createBoard = (name) => authed('POST', '/api/boards', { name });
export const renameBoard = (id, name) => authed('PUT', `/api/boards/${id}`, { name });
export const deleteBoard = (id) => authed('DELETE', `/api/boards/${id}`);

export async function getBoardTasks(boardId, { archived = false, onCache } = {}) {
  const userId = cachedUserId();
  // l'archivio non si tiene in cache: si guarda raramente
  const key = userId == null || archived ? null : tasksKey(userId, boardId);
  const tasks = await cachedGet(
    key,
    `/api/boards/${boardId}/tasks${archived ? '?archived=1' : ''}`,
    onCache,
  );
  if (key) setCache(key, { savedAt: Date.now(), items: tasks });
  return tasks;
}

export const getBoardEvents = (boardId, { limit = 50, before } = {}) =>
  authed('GET', `/api/boards/${boardId}/events?limit=${limit}${before ? `&before=${before}` : ''}`);
export const getStats = (boardId) => authed('GET', `/api/boards/${boardId}/stats`);
export const archiveDone = (boardId) => authed('POST', `/api/boards/${boardId}/archive-done`);

export const createColumn = (boardId, data) =>
  authed('POST', `/api/boards/${boardId}/columns`, data);
export const updateColumn = (boardId, id, data) =>
  authed('PUT', `/api/boards/${boardId}/columns/${id}`, data);
export const reorderColumns = (boardId, ids) =>
  authed('PUT', `/api/boards/${boardId}/columns-order`, { ids });
export const deleteColumn = (boardId, id, moveTo) =>
  authed('DELETE', `/api/boards/${boardId}/columns/${id}${moveTo ? `?moveTo=${moveTo}` : ''}`);

export const createLabel = (boardId, data) => authed('POST', `/api/boards/${boardId}/labels`, data);
export const updateLabel = (boardId, id, data) =>
  authed('PUT', `/api/boards/${boardId}/labels/${id}`, data);
export const deleteLabel = (boardId, id) => authed('DELETE', `/api/boards/${boardId}/labels/${id}`);

// l'export è un normale download: basta un link (il cookie di sessione viaggia da solo)
export const exportUrl = (boardId, format = 'json') =>
  `/api/boards/${boardId}/export${format === 'csv' ? '?format=csv' : ''}`;
export const importBoard = (data) => authed('POST', '/api/boards/import', data);

// ---------------------------------------------------------------------------
// Attività
// ---------------------------------------------------------------------------

// `flags` = conferme dell'utente: { ignoreConflicts, force }
export const getTask = (id) => authed('GET', `/api/tasks/${id}`);
export const createTask = (input, flags = {}) =>
  authed('POST', '/api/tasks', { ...input, ...flags });
export const updateTask = (id, input, flags = {}) =>
  authed('PUT', `/api/tasks/${id}`, { ...input, ...flags });
export const moveTask = (id, columnId, position, flags = {}) =>
  authed('PATCH', `/api/tasks/${id}/move`, { columnId, position, ...flags });
export const deleteTask = (id) => authed('DELETE', `/api/tasks/${id}`);
export const archiveTask = (id, archived = true) =>
  authed('POST', `/api/tasks/${id}/archive`, { archived });
export const setSpentMinutes = (id, spentMin) =>
  authed('PATCH', `/api/tasks/${id}/time`, { spentMin });
export const getTaskEvents = (id) => authed('GET', `/api/tasks/${id}/events`);

export const addChecklistItem = (taskId, text) =>
  authed('POST', `/api/tasks/${taskId}/checklist`, { text });
export const updateChecklistItem = (taskId, itemId, patch) =>
  authed('PUT', `/api/tasks/${taskId}/checklist/${itemId}`, patch);
export const deleteChecklistItem = (taskId, itemId) =>
  authed('DELETE', `/api/tasks/${taskId}/checklist/${itemId}`);

export const addLink = (taskId, url, name) =>
  authed('POST', `/api/tasks/${taskId}/attachments`, { url, name });
// il tipo è sempre octet-stream: un file .json non deve passare per il parser JSON del server
export const uploadFile = (taskId, file) =>
  authed('POST', `/api/tasks/${taskId}/attachments`, file, {
    'Content-Type': 'application/octet-stream',
    'X-Filename': encodeURIComponent(file.name),
    'X-File-Type': file.type || 'application/octet-stream',
  });
export const deleteAttachment = (id) => authed('DELETE', `/api/attachments/${id}`);

// ---------------------------------------------------------------------------
// Commenti
// ---------------------------------------------------------------------------

export async function getComments(taskId, { onCache } = {}) {
  const userId = cachedUserId();
  const key = userId == null ? null : commentsKey(userId, taskId);
  const comments = await cachedGet(key, `/api/tasks/${taskId}/comments`, onCache);
  if (key) {
    setCache(key, { savedAt: Date.now(), items: comments });
    rememberCommentsTask(userId, taskId);
  }
  return comments;
}

// la cache dei commenti segue le modifiche: dopo ogni scrittura si tiene l'elenco aggiornato
function updateCommentsCache(taskId, change) {
  const userId = cachedUserId();
  if (userId == null) return;
  const key = commentsKey(userId, taskId);
  const cached = getCache(key);
  if (Array.isArray(cached?.items)) {
    setCache(key, { savedAt: Date.now(), items: change(cached.items) });
  }
}

export async function addComment(taskId, text) {
  const comment = await authed('POST', `/api/tasks/${taskId}/comments`, { text });
  updateCommentsCache(taskId, (items) => [...items, comment]);
  return comment;
}

export async function editComment(taskId, commentId, text) {
  const comment = await authed('PUT', `/api/tasks/${taskId}/comments/${commentId}`, { text });
  updateCommentsCache(taskId, (items) => items.map((c) => (c.id === commentId ? comment : c)));
  return comment;
}

export async function deleteComment(taskId, commentId) {
  await authed('DELETE', `/api/tasks/${taskId}/comments/${commentId}`);
  updateCommentsCache(taskId, (items) => items.filter((c) => c.id !== commentId));
}

// ---------------------------------------------------------------------------
// Notifiche e tempo reale
// ---------------------------------------------------------------------------

export const getNotifications = () => authed('GET', '/api/notifications');
export const markNotificationsRead = (arg) =>
  authed('POST', '/api/notifications/read', Array.isArray(arg) ? { ids: arg } : { all: true });

// Il server avvisa a ogni modifica; EventSource si ricollega da solo se la rete cade.
// Ritorna la funzione che chiude il collegamento.
export function connectRealtime({ onChange, onStatus } = {}) {
  const source = new EventSource('/api/stream');
  source.onmessage = () => onChange?.();
  source.onopen = () => onStatus?.(true);
  source.onerror = () => onStatus?.(false);
  return () => source.close();
}
