// Regole di validazione condivise da browser e server.
// Funzioni pure: niente document, window o localStorage, perché le importa anche il server.

import { STATUSES, PRIORITIES, LIMITS, DEFAULT_COLOR } from './constants.js';

const USERNAME_RE = /^[A-Za-z0-9_]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// → messaggio d'errore oppure null se va bene
export function validateUsername(username) {
  const value = typeof username === 'string' ? username.trim() : '';
  if (!value) return 'Inserisci uno username';
  if (
    value.length < LIMITS.usernameMin ||
    value.length > LIMITS.usernameMax ||
    !USERNAME_RE.test(value)
  ) {
    return 'Lo username deve avere 3-30 caratteri: lettere, numeri o _';
  }
  return null;
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < LIMITS.passwordMin) {
    return 'La password deve avere almeno 8 caratteri';
  }
  return null;
}

export function validateCommentText(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return 'Il commento non può essere vuoto';
  if (value.length > LIMITS.commentMax) return 'Il commento può avere al massimo 1000 caratteri';
  return null;
}

// accetta qualunque cosa (anche dati sporchi dal body HTTP) e ritorna un TaskInput pulito
export function normalizeTaskInput(raw = {}) {
  raw = raw && typeof raw === 'object' ? raw : {};
  return {
    title: typeof raw.title === 'string' ? raw.title.trim() : '',
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    status: raw.status ?? 'todo',
    date: raw.date ?? '',
    startTime: raw.startTime ?? '',
    endTime: raw.endTime ?? '',
    color: raw.color || DEFAULT_COLOR,
    priority: raw.priority ?? 'medium',
    parentId: raw.parentId === '' || raw.parentId == null ? null : Number(raw.parentId),
  };
}

// la data deve esistere davvero: '2026-02-30' non passa
function isValidDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  const d = new Date(date + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === date;
}

const isValidTime = (time) => typeof time === 'string' && TIME_RE.test(time);

// ritorna { campo: messaggio } — {} se va tutto bene.
// L'ordine dei campi conta: il server segnala il primo errore trovato.
export function validateTaskInput(input) {
  const errors = {};
  const { title, description, status, date, startTime, endTime, priority, color, parentId } =
    input ?? {};

  if (typeof title !== 'string' || !title.trim()) {
    errors.title = 'Il titolo è obbligatorio';
  } else if (title.length > LIMITS.titleMax) {
    errors.title = 'Il titolo può avere al massimo 100 caratteri';
  }

  if (typeof description !== 'string' || description.length > LIMITS.descriptionMax) {
    errors.description = 'La descrizione può avere al massimo 2000 caratteri';
  }

  if (!STATUSES.includes(status)) errors.status = 'Stato non valido';

  if (!isValidDate(date)) errors.date = 'Data non valida';

  if (!isValidTime(startTime)) errors.startTime = 'Ora di inizio non valida';

  if (!isValidTime(endTime)) {
    errors.endTime = 'Ora di fine non valida';
  } else if (isValidTime(startTime) && endTime <= startTime) {
    errors.endTime = "L'ora di fine deve essere dopo l'ora di inizio";
  }

  if (!PRIORITIES.includes(priority)) errors.priority = 'Priorità non valida';

  if (typeof color !== 'string' || !COLOR_RE.test(color)) errors.color = 'Colore non valido';

  if (parentId !== null && !(Number.isInteger(parentId) && parentId > 0)) {
    errors.parentId = 'Attività genitore non trovata';
  }

  return errors;
}

// un'altra attività (id diverso) con stessa data e stessa ora di inizio
export function findTimeConflict(tasks, { id = null, date, startTime }) {
  return tasks.find((t) => t.id !== id && t.date === date && t.startTime === startTime) ?? null;
}

// figli, nipoti, … (visita in ampiezza; il Set dei visitati protegge da dati sporchi con cicli)
export function getDescendantIds(tasks, id) {
  const descendants = new Set();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const t of tasks) {
      if (t.parentId === current && t.id !== id && !descendants.has(t.id)) {
        descendants.add(t.id);
        queue.push(t.id);
      }
    }
  }
  return descendants;
}

export function wouldCreateCycle(tasks, id, parentId) {
  if (parentId == null) return false;
  if (parentId === id) return true;
  return getDescendantIds(tasks, id).has(parentId);
}
