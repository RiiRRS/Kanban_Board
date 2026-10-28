// Tutte le chiamate al server. Nessun altro file usa fetch.

import {
  getCache,
  setCache,
  removeCache,
  clearUserCache,
  tasksKey,
  commentsKey,
  rememberCommentsTask,
} from './cache.js';

export class ApiError extends Error {
  constructor(message, status = 0, field = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
  }
}

export const register = (username, password) => real.register(username, password);
export const login = (username, password) => real.login(username, password);
export const logout = () => real.logout();
export const getMe = () => real.getMe();
export const getTasks = ({ onCache } = {}) => real.getTasks(onCache);
export const createTask = (input) => authed('POST', '/api/tasks', input);
export const updateTask = (id, input) => authed('PUT', `/api/tasks/${id}`, input);
export const moveTask = (id, status, position) =>
  authed('PATCH', `/api/tasks/${id}/move`, { status, position });
export const deleteTask = (id) => authed('DELETE', `/api/tasks/${id}`);
export const getComments = (taskId, { onCache } = {}) => real.getComments(taskId, onCache);
export const addComment = (taskId, text) => real.addComment(taskId, text);

// ---------------------------------------------------------------------------
// Server vero
// ---------------------------------------------------------------------------

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
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
    );
  }
  return data;
}

// rotte protette: su 401 svuota la cache e manda al login
async function authed(method, path, body) {
  try {
    return await request(method, path, body);
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

const real = {
  async register(username, password) {
    const user = await request('POST', '/api/register', { username, password });
    setCache('me', user);
    return user;
  },

  async login(username, password) {
    const user = await request('POST', '/api/login', { username, password });
    setCache('me', user);
    return user;
  },

  async logout() {
    try {
      await request('POST', '/api/logout');
    } catch {
      // senza rete si esce lo stesso: la sessione scade da sola
    }
    clearUserCache();
  },

  async getMe() {
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
  },

  async getTasks(onCache) {
    const userId = cachedUserId();
    const key = userId == null ? null : tasksKey(userId);
    if (key && typeof onCache === 'function') {
      const cached = getCache(key);
      if (Array.isArray(cached?.items)) onCache(cached.items);
    }
    const tasks = await authed('GET', '/api/tasks');
    if (key) setCache(key, { savedAt: Date.now(), items: tasks });
    return tasks;
  },

  async getComments(taskId, onCache) {
    const userId = cachedUserId();
    const key = userId == null ? null : commentsKey(userId, taskId);
    if (key && typeof onCache === 'function') {
      const cached = getCache(key);
      if (Array.isArray(cached?.items)) onCache(cached.items);
    }
    const comments = await authed('GET', `/api/tasks/${taskId}/comments`);
    if (key) {
      setCache(key, { savedAt: Date.now(), items: comments });
      rememberCommentsTask(userId, taskId);
    }
    return comments;
  },

  async addComment(taskId, text) {
    const comment = await authed('POST', `/api/tasks/${taskId}/comments`, { text });
    const userId = cachedUserId();
    if (userId != null) {
      const key = commentsKey(userId, taskId);
      const cached = getCache(key);
      if (Array.isArray(cached?.items)) {
        setCache(key, { savedAt: Date.now(), items: [...cached.items, comment] });
      }
    }
    return comment;
  },
};
