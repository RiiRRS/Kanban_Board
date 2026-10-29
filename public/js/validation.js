// Regole di validazione condivise da browser e server.
// Funzioni pure: niente document, window o localStorage, perché le importa anche il server.

import { PRIORITIES, RECURRENCES, LIMITS, DEFAULT_COLOR } from './constants.js';

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
  if (new TextEncoder().encode(password).length > LIMITS.passwordMaxBytes) {
    return `La password può avere al massimo ${LIMITS.passwordMaxBytes} byte`;
  }
  return null;
}

export function validateCommentText(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return 'Il commento non può essere vuoto';
  if (value.length > LIMITS.commentMax) return 'Il commento può avere al massimo 1000 caratteri';
  return null;
}

export const isValidColor = (color) => typeof color === 'string' && COLOR_RE.test(color);

// nome di board, colonna, etichetta o voce di checklist: 1..max caratteri
export function validateName(value, max, what) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return `${what}: il nome è obbligatorio`;
  if (text.length > max) return `${what}: al massimo ${max} caratteri`;
  return null;
}

// numero intero o null → intero ≥ 0 (minuti); NaN se non valido
function toMinutes(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

const toIdList = (value) =>
  Array.isArray(value) ? [...new Set(value.map(Number))].filter((n) => n !== 0) : [];

// accetta qualunque cosa (anche dati sporchi dal body HTTP) e ritorna un TaskInput pulito
export function normalizeTaskInput(raw = {}) {
  raw = raw && typeof raw === 'object' ? raw : {};
  return {
    title: typeof raw.title === 'string' ? raw.title.trim() : '',
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    columnId: raw.columnId == null || raw.columnId === '' ? null : Number(raw.columnId),
    date: raw.date ?? '',
    startTime: raw.startTime ?? '',
    endTime: raw.endTime ?? '',
    color: raw.color || DEFAULT_COLOR,
    priority: raw.priority ?? 'medium',
    parentId: raw.parentId === '' || raw.parentId == null ? null : Number(raw.parentId),
    assigneeIds: toIdList(raw.assigneeIds),
    labelIds: toIdList(raw.labelIds),
    estimateMin: toMinutes(raw.estimateMin),
    spentMin: toMinutes(raw.spentMin) ?? 0,
    recurrence: raw.recurrence ?? 'none',
  };
}

// la data deve esistere davvero: '2026-02-30' non passa
export function isValidDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  const d = new Date(date + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === date;
}

const isValidTime = (time) => typeof time === 'string' && TIME_RE.test(time);

const isId = (n) => Number.isInteger(n) && n > 0;
const isMinutes = (n) => Number.isInteger(n) && n >= 0 && n <= LIMITS.minutesMax;

// ritorna { campo: messaggio } — {} se va tutto bene.
// L'ordine dei campi conta: il server segnala il primo errore trovato.
export function validateTaskInput(input) {
  const errors = {};
  const {
    title,
    description,
    columnId,
    date,
    startTime,
    endTime,
    priority,
    color,
    parentId,
    assigneeIds,
    labelIds,
    estimateMin,
    spentMin,
    recurrence,
  } = input ?? {};

  if (typeof title !== 'string' || !title.trim()) {
    errors.title = 'Il titolo è obbligatorio';
  } else if (title.length > LIMITS.titleMax) {
    errors.title = 'Il titolo può avere al massimo 100 caratteri';
  }

  if (typeof description !== 'string' || description.length > LIMITS.descriptionMax) {
    errors.description = `La descrizione può avere al massimo ${LIMITS.descriptionMax} caratteri`;
  }

  if (!isId(columnId)) errors.columnId = 'Colonna non valida';

  if (!isValidDate(date)) errors.date = 'Data non valida';

  if (!isValidTime(startTime)) errors.startTime = 'Ora di inizio non valida';

  if (!isValidTime(endTime)) {
    errors.endTime = 'Ora di fine non valida';
  } else if (isValidTime(startTime) && endTime <= startTime) {
    errors.endTime = "L'ora di fine deve essere dopo l'ora di inizio";
  }

  if (!PRIORITIES.includes(priority)) errors.priority = 'Priorità non valida';

  if (!isValidColor(color)) errors.color = 'Colore non valido';

  if (parentId !== null && !isId(parentId)) errors.parentId = 'Attività genitore non trovata';

  if (!Array.isArray(assigneeIds) || !assigneeIds.every(isId)) {
    errors.assigneeIds = 'Assegnatari non validi';
  } else if (assigneeIds.length > LIMITS.assigneesMax) {
    errors.assigneeIds = `Al massimo ${LIMITS.assigneesMax} assegnatari`;
  }

  if (!Array.isArray(labelIds) || !labelIds.every(isId)) {
    errors.labelIds = 'Etichette non valide';
  } else if (labelIds.length > LIMITS.labelsMax) {
    errors.labelIds = `Al massimo ${LIMITS.labelsMax} etichette`;
  }

  if (estimateMin !== null && !isMinutes(estimateMin)) errors.estimateMin = 'Stima non valida';
  if (!isMinutes(spentMin)) errors.spentMin = 'Tempo non valido';

  if (!RECURRENCES.includes(recurrence)) errors.recurrence = 'Ripetizione non valida';

  return errors;
}

// Attività che si sovrappongono a quella indicata: stesso giorno, orari che si incrociano e
// almeno un assegnatario in comune. Contano solo le attività ancora aperte (non fatte, non in
// archivio). Senza assegnatari nessuno risulta doppiamente impegnato, quindi non c'è conflitto.
export function findTimeConflicts(tasks, { id = null, date, startTime, endTime, assigneeIds }) {
  if (!assigneeIds?.length) return [];
  return tasks.filter(
    (t) =>
      t.id !== id &&
      t.date === date &&
      !t.isDone &&
      !t.archived &&
      t.startTime < endTime &&
      startTime < t.endTime &&
      t.assigneeIds.some((a) => assigneeIds.includes(a)),
  );
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

// '1h 30m' / '45m' / '2h'
export function formatMinutes(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}

// data della prossima occorrenza di un'attività ricorrente (il mese si ferma all'ultimo giorno)
export function nextOccurrence(date, recurrence) {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d));
  if (recurrence === 'daily') next.setUTCDate(next.getUTCDate() + 1);
  else if (recurrence === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
  else if (recurrence === 'monthly') {
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    next.setTime(Date.UTC(y, m, Math.min(d, lastDay)));
  } else return null;
  return next.toISOString().slice(0, 10);
}
