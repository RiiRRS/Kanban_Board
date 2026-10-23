// Tutte le chiamate al server. Nessun altro file usa fetch.
//
// USE_STUBS = true  → dati finti salvati in localStorage ('kanban.stub.db' e 'kanban.stub.session'),
//                     con le stesse regole, gli stessi errori e gli stessi permessi del server vero.
// USE_STUBS = false → server vero.
//
// Utenti finti (password per tutti: password123): enrico (admin), riccardo, manuel (member).
// Dalla console del browser:
//   const api = await import('/js/api.js');
//   await api.login('enrico', 'password123');
//   await api.resetStubs();   // riporta i dati finti allo stato iniziale

import {
  validateUsername,
  validatePassword,
  validateCommentText,
  normalizeTaskInput,
  validateTaskInput,
  findTimeConflict,
  wouldCreateCycle,
} from './validation.js';
import { STATUSES } from './constants.js';

export const USE_STUBS = true;

export class ApiError extends Error {
  constructor(message, status = 0, field = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
  }
}

export async function register(username, password) {
  return USE_STUBS
    ? stub.register(username, password)
    : request('POST', '/api/register', { username, password });
}

export async function login(username, password) {
  return USE_STUBS
    ? stub.login(username, password)
    : request('POST', '/api/login', { username, password });
}

export async function logout() {
  return USE_STUBS ? stub.logout() : request('POST', '/api/logout');
}

export async function getMe() {
  return USE_STUBS ? stub.getMe() : request('GET', '/api/me');
}

export async function getTasks({ onCache } = {}) {
  return USE_STUBS ? stub.getTasks() : authed('GET', '/api/tasks');
}

export async function createTask(input) {
  return USE_STUBS ? stub.createTask(input) : authed('POST', '/api/tasks', input);
}

export async function updateTask(id, input) {
  return USE_STUBS ? stub.updateTask(id, input) : authed('PUT', `/api/tasks/${id}`, input);
}

export async function moveTask(id, status, position) {
  return USE_STUBS
    ? stub.moveTask(id, status, position)
    : authed('PATCH', `/api/tasks/${id}/move`, { status, position });
}

export async function deleteTask(id) {
  return USE_STUBS ? stub.deleteTask(id) : authed('DELETE', `/api/tasks/${id}`);
}

export async function getComments(taskId, { onCache } = {}) {
  return USE_STUBS ? stub.getComments(taskId) : authed('GET', `/api/tasks/${taskId}/comments`);
}

export async function addComment(taskId, text) {
  return USE_STUBS
    ? stub.addComment(taskId, text)
    : authed('POST', `/api/tasks/${taskId}/comments`, { text });
}

// solo debug: riporta i dati finti allo stato iniziale
export async function resetStubs() {
  stub.reset();
}

// ---------------------------------------------------------------------------
// Server vero (versione minima, la cache arriva dopo)
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

// rotte protette: su 401 manda al login
async function authed(method, path, body) {
  try {
    return await request(method, path, body);
  } catch (err) {
    if (err.status === 401) location.replace('login.html');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Stub: dati finti in localStorage, stesse regole del server
// ---------------------------------------------------------------------------

const STUB_DB_KEY = 'kanban.stub.db';
const STUB_SESSION_KEY = 'kanban.stub.session';

// ritardo casuale 150–400 ms, per simulare la rete
const delay = () => new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 250));

// timestamp ISO UTC senza millisecondi, come il server: '2026-10-23T10:00:00Z'
const isoNow = (offsetMs = 0) =>
  new Date(Date.now() + offsetMs).toISOString().replace(/\.\d{3}Z$/, 'Z');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// data locale di oggi + offset giorni → 'YYYY-MM-DD'
function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function initialData() {
  const users = [
    { id: 1, username: 'enrico', role: 'admin', password: 'password123' },
    { id: 2, username: 'riccardo', role: 'member', password: 'password123' },
    { id: 3, username: 'manuel', role: 'member', password: 'password123' },
  ];

  // [titolo, descrizione, stato, giorno (offset da oggi), inizio, fine, colore, priorità, genitore, autore]
  const rows = [
    [
      'Preparare presentazione',
      'Struttura: problema, demo, architettura, limiti noti.\nDurata massima: 10 minuti.',
      'todo',
      3,
      '10:00',
      '12:00',
      '#a855f7',
      'high',
      null,
      1,
    ],
    [
      'Scrivere le slide sulla parte tecnica',
      'Server, database, API e cache.',
      'doing',
      2,
      '14:00',
      '16:00',
      '#4f8cff',
      'medium',
      1,
      1,
    ],
    [
      "Raccogliere gli screenshot dell'interfaccia",
      '',
      'todo',
      2,
      '09:00',
      '10:00',
      '#14b8a6',
      'low',
      1,
      3,
    ],
    [
      'Correggere il layout delle card su mobile',
      'A 375px il titolo esce dalla card.',
      'doing',
      -1,
      '15:00',
      '17:00',
      '#ef4444',
      'high',
      null,
      2,
    ],
    ['Riunione di allineamento', '', 'doing', 0, '09:00', '09:30', '#f59e0b', 'medium', null, 2],
    [
      'Rivedere tutti i messaggi di errore del form di registrazione e confrontarli con le specifiche',
      '',
      'todo',
      4,
      '11:00',
      '12:30',
      '#ec4899',
      'low',
      null,
      3,
    ],
    [
      'Testare il drag-and-drop su telefono',
      'Provare sia Android sia iPhone.',
      'review',
      0,
      '16:00',
      '17:30',
      '#22c55e',
      'medium',
      null,
      1,
    ],
    [
      'Controllare i permessi delle API',
      'Un member non deve poter modificare le attività altrui.',
      'review',
      1,
      '10:00',
      '11:00',
      '#64748b',
      'high',
      null,
      1,
    ],
    ['Schema del database', '', 'done', 1, '14:00', '15:00', '#4f8cff', 'medium', null, 1],
    ['Mockup della pagina di login', '', 'done', 5, '09:00', '10:00', '#a855f7', 'low', null, 3],
  ];

  const positions = {};
  const tasks = rows.map(
    (
      [title, description, status, day, startTime, endTime, color, priority, parentId, createdById],
      i,
    ) => {
      positions[status] = (positions[status] ?? -1) + 1;
      const createdAt = isoNow(-(10 - i) * DAY);
      return {
        id: i + 1,
        title,
        description,
        status,
        date: localDate(day),
        startTime,
        endTime,
        color,
        priority,
        parentId,
        position: positions[status],
        createdById,
        createdAt,
        updatedAt: createdAt,
      };
    },
  );

  const comments = [
    {
      id: 1,
      taskId: 1,
      authorId: 2,
      text: 'Io posso preparare la parte sul layout.',
      createdAt: isoNow(-26 * HOUR),
    },
    {
      id: 2,
      taskId: 1,
      authorId: 3,
      text:
        'Per la demo propongo di partire dal login, creare un’attività, spostarla con il drag-and-drop ' +
        'e poi aprire il dettaglio per mostrare la gerarchia e i commenti. Così in pochi minuti si vedono ' +
        'tutte le funzionalità principali, compresi gli errori quando due attività iniziano alla stessa ora.',
      createdAt: isoNow(-25 * HOUR),
    },
    {
      id: 3,
      taskId: 4,
      authorId: 1,
      text: 'Succede anche nella colonna In revisione.',
      createdAt: isoNow(-5 * HOUR),
    },
    {
      id: 4,
      taskId: 4,
      authorId: 2,
      text: 'Ci guardo oggi pomeriggio.',
      createdAt: isoNow(-4 * HOUR),
    },
  ];

  return { users, tasks, comments, nextId: { users: 4, tasks: 11, comments: 5 } };
}

function loadDb() {
  try {
    const db = JSON.parse(localStorage.getItem(STUB_DB_KEY));
    if (db && Array.isArray(db.users) && Array.isArray(db.tasks) && Array.isArray(db.comments)) {
      return db;
    }
  } catch {
    // JSON rotto: si ricrea
  }
  const db = initialData();
  saveDb(db);
  return db;
}

function saveDb(db) {
  localStorage.setItem(STUB_DB_KEY, JSON.stringify(db));
}

function getSessionUser(db) {
  try {
    const session = JSON.parse(localStorage.getItem(STUB_SESSION_KEY));
    return db.users.find((u) => u.id === session?.userId) ?? null;
  } catch {
    return null;
  }
}

const toUser = (u) => ({ id: u.id, username: u.username, role: u.role });

// come rowToTask del server: aggiunge createdBy, commentCount e childCount
function toTask(db, t) {
  const author = db.users.find((u) => u.id === t.createdById);
  const { createdById, ...rest } = t;
  return structuredClone({
    ...rest,
    createdBy: { id: t.createdById, username: author?.username ?? '' },
    commentCount: db.comments.filter((c) => c.taskId === t.id).length,
    childCount: db.tasks.filter((ch) => ch.parentId === t.id).length,
  });
}

function toComment(db, c) {
  const author = db.users.find((u) => u.id === c.authorId);
  return structuredClone({
    id: c.id,
    taskId: c.taskId,
    author: { id: c.authorId, username: author?.username ?? '' },
    text: c.text,
    createdAt: c.createdAt,
  });
}

// come requireAuth del server: senza sessione → 401 e redirect al login
function requireUser(db) {
  const user = getSessionUser(db);
  if (!user) {
    location.replace('login.html');
    throw new ApiError('Devi effettuare il login', 401);
  }
  return user;
}

function findTask(db, id) {
  const taskId = Number(id);
  const task =
    Number.isInteger(taskId) && taskId > 0 ? db.tasks.find((t) => t.id === taskId) : null;
  if (!task) throw new ApiError('Attività non trovata', 404);
  return task;
}

const canEdit = (user, task) => user.role === 'admin' || task.createdById === user.id;

function checkTaskRules(db, input, id = null) {
  const errors = validateTaskInput(input);
  const [field] = Object.keys(errors);
  if (field) throw new ApiError(errors[field], 400, field);

  if (input.parentId != null) {
    if (!db.tasks.some((t) => t.id === input.parentId)) {
      throw new ApiError('Attività genitore non trovata', 400, 'parentId');
    }
    if (id != null && wouldCreateCycle(db.tasks, id, input.parentId)) {
      throw new ApiError('Gerarchia non valida: si creerebbe un ciclo', 400, 'parentId');
    }
  }
  if (findTimeConflict(db.tasks, { id, date: input.date, startTime: input.startTime })) {
    throw new ApiError(
      `Esiste già un'attività che inizia alle ${input.startTime} in questo giorno`,
      409,
      'startTime',
    );
  }
}

const columnTasks = (db, status, exceptId = null) =>
  db.tasks.filter((t) => t.status === status && t.id !== exceptId);

const nextPosition = (db, status, exceptId = null) =>
  columnTasks(db, status, exceptId).reduce((max, t) => Math.max(max, t.position + 1), 0);

// chiude il buco lasciato da una card che esce dalla colonna
function closeGap(db, status, position, exceptId) {
  for (const t of columnTasks(db, status, exceptId)) {
    if (t.position > position) t.position -= 1;
  }
}

// stesso ordine del server: ORDER BY t.status, t.position, t.id
const compareTasks = (a, b) =>
  (a.status < b.status ? -1 : a.status > b.status ? 1 : 0) ||
  a.position - b.position ||
  a.id - b.id;

const stub = {
  async register(username, password) {
    await delay();
    const db = loadDb();
    const name = String(username ?? '').trim();
    const usernameError = validateUsername(name);
    if (usernameError) throw new ApiError(usernameError, 400, 'username');
    const passwordError = validatePassword(password);
    if (passwordError) throw new ApiError(passwordError, 400, 'password');
    if (db.users.some((u) => u.username.toLowerCase() === name.toLowerCase())) {
      throw new ApiError('Username già in uso', 409, 'username');
    }
    const user = {
      id: db.nextId.users++,
      username: name,
      role: db.users.length === 0 ? 'admin' : 'member',
      password, // in chiaro SOLO qui: sono dati finti
    };
    db.users.push(user);
    saveDb(db);
    localStorage.setItem(STUB_SESSION_KEY, JSON.stringify({ userId: user.id }));
    return toUser(user);
  },

  async login(username, password) {
    await delay();
    const db = loadDb();
    const name = String(username ?? '').trim();
    if (!name || !password) throw new ApiError('Username o password non validi', 400);
    const user = db.users.find((u) => u.username.toLowerCase() === name.toLowerCase());
    if (!user || user.password !== password) {
      throw new ApiError('Username o password non validi', 401);
    }
    localStorage.setItem(STUB_SESSION_KEY, JSON.stringify({ userId: user.id }));
    return toUser(user);
  },

  async logout() {
    await delay();
    localStorage.removeItem(STUB_SESSION_KEY);
    return null;
  },

  async getMe() {
    await delay();
    const user = getSessionUser(loadDb());
    return user ? toUser(user) : null;
  },

  async getTasks() {
    await delay();
    const db = loadDb();
    requireUser(db);
    return [...db.tasks].sort(compareTasks).map((t) => toTask(db, t));
  },

  async createTask(raw) {
    await delay();
    const db = loadDb();
    const user = requireUser(db);
    const input = normalizeTaskInput(raw);
    checkTaskRules(db, input);
    const now = isoNow();
    const task = {
      id: db.nextId.tasks++,
      ...input,
      position: nextPosition(db, input.status),
      createdById: user.id,
      createdAt: now,
      updatedAt: now,
    };
    db.tasks.push(task);
    saveDb(db);
    return toTask(db, task);
  },

  async updateTask(id, raw) {
    await delay();
    const db = loadDb();
    const user = requireUser(db);
    const task = findTask(db, id);
    if (!canEdit(user, task)) throw new ApiError('Non hai i permessi per questa operazione', 403);
    const input = normalizeTaskInput(raw);
    checkTaskRules(db, input, task.id);
    if (input.status !== task.status) {
      closeGap(db, task.status, task.position, task.id);
      task.position = nextPosition(db, input.status, task.id);
    }
    Object.assign(task, input, { updatedAt: isoNow() });
    saveDb(db);
    return toTask(db, task);
  },

  // stesso algoritmo del server; spostare è permesso a tutti
  async moveTask(id, status, position) {
    await delay();
    const db = loadDb();
    requireUser(db);
    if (!STATUSES.includes(status)) throw new ApiError('Stato non valido', 400, 'status');
    if (!Number.isInteger(position) || position < 0) {
      throw new ApiError('Posizione non valida', 400, 'position');
    }
    const task = findTask(db, id);
    closeGap(db, task.status, task.position, task.id);
    const newPos = Math.min(position, columnTasks(db, status, task.id).length);
    for (const t of columnTasks(db, status, task.id)) {
      if (t.position >= newPos) t.position += 1;
    }
    Object.assign(task, { status, position: newPos, updatedAt: isoNow() });
    saveDb(db);
    return toTask(db, task);
  },

  async deleteTask(id) {
    await delay();
    const db = loadDb();
    const user = requireUser(db);
    const task = findTask(db, id);
    if (!canEdit(user, task)) throw new ApiError('Non hai i permessi per questa operazione', 403);
    db.tasks = db.tasks.filter((t) => t.id !== task.id);
    // come le foreign key: figli staccati, commenti eliminati
    for (const t of db.tasks) if (t.parentId === task.id) t.parentId = null;
    db.comments = db.comments.filter((c) => c.taskId !== task.id);
    closeGap(db, task.status, task.position, task.id);
    saveDb(db);
    return null;
  },

  async getComments(taskId) {
    await delay();
    const db = loadDb();
    requireUser(db);
    const task = findTask(db, taskId);
    return db.comments
      .filter((c) => c.taskId === task.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
      .map((c) => toComment(db, c));
  },

  async addComment(taskId, text) {
    await delay();
    const db = loadDb();
    const user = requireUser(db);
    const task = findTask(db, taskId);
    const error = validateCommentText(text);
    if (error) throw new ApiError(error, 400, 'text');
    const comment = {
      id: db.nextId.comments++,
      taskId: task.id,
      authorId: user.id,
      text: text.trim(),
      createdAt: isoNow(),
    };
    db.comments.push(comment);
    task.updatedAt = comment.createdAt;
    saveDb(db);
    return toComment(db, comment);
  },

  reset() {
    localStorage.removeItem(STUB_DB_KEY);
    localStorage.removeItem(STUB_SESSION_KEY);
    saveDb(initialData());
  },
};
