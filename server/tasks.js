// API delle attività: elenco, creazione, modifica, spostamento, archivio, eliminazione,
// checklist e tempo

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, getTaskById, rowToChecklistItem, rowToAttachment } from './db.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import {
  normalizeTaskInput,
  validateTaskInput,
  validateName,
  findTimeConflicts,
  wouldCreateCycle,
  nextOccurrence,
} from '../public/js/validation.js';
import { LIMITS } from '../public/js/constants.js';
import { canEdit, canContribute, displayName } from './access.js';
import { recordEvent, listEvents } from './events.js';
import { notify } from './notifications.js';
import { config } from './config.js';

const router = express.Router();

export function parseId(value, message) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw notFound(message);
  return id;
}

// ---------------------------------------------------------------------------
// Posizioni nelle colonne (le attività in archivio non occupano posti)
// ---------------------------------------------------------------------------

const nextPosition = (columnId) =>
  db
    .prepare(
      'SELECT COALESCE(MAX(position) + 1, 0) AS p FROM tasks WHERE column_id = ? AND archived_at IS NULL',
    )
    .get(columnId).p;

// chiude il buco lasciato da una card che esce dalla colonna
const closeGap = (columnId, position) =>
  db
    .prepare(
      `UPDATE tasks SET position = position - 1
       WHERE column_id = ? AND position > ? AND archived_at IS NULL`,
    )
    .run(columnId, position);

const getColumn = (id) => db.prepare('SELECT * FROM columns WHERE id = ?').get(id);

const openCount = (columnId, exceptTaskId = 0) =>
  db
    .prepare(
      'SELECT COUNT(*) AS n FROM tasks WHERE column_id = ? AND archived_at IS NULL AND id != ?',
    )
    .get(columnId, exceptTaskId).n;

// Limite WIP: oltre il limite serve una conferma esplicita (force)
function checkWip(column, exceptTaskId, force) {
  if (force || column.wip_limit == null) return;
  if (openCount(column.id, exceptTaskId) >= column.wip_limit) {
    throw conflict(
      `La colonna "${column.name}" ha raggiunto il limite di ${column.wip_limit} attività`,
      'columnId',
      { code: 'wip_limit', limit: column.wip_limit, column: column.name },
    );
  }
}

// ---------------------------------------------------------------------------
// Regole sui dati
// ---------------------------------------------------------------------------

// attività della board con gli assegnatari, per cercare i conflitti d'orario
// (su tutte le board: una persona non può essere in due posti)
function tasksOnDate(date) {
  return db
    .prepare(
      `SELECT t.id, t.title, t.date, t.start_time AS startTime, t.end_time AS endTime,
              c.is_done AS isDone, t.archived_at IS NOT NULL AS archived,
              (SELECT json_group_array(user_id) FROM task_assignees WHERE task_id = t.id)
                AS assignees
       FROM tasks t JOIN columns c ON c.id = t.column_id WHERE t.date = ?`,
    )
    .all(date)
    .map((t) => ({
      ...t,
      isDone: t.isDone === 1,
      archived: t.archived === 1,
      assigneeIds: JSON.parse(t.assignees),
    }));
}

function checkConflicts(input, id, ignore) {
  if (ignore) return;
  const found = findTimeConflicts(tasksOnDate(input.date), { id, ...input });
  if (found.length === 0) return;
  throw conflict(
    found.length === 1
      ? `Si sovrappone a "${found[0].title}" (${found[0].startTime}–${found[0].endTime})`
      : `Si sovrappone a ${found.length} attività degli stessi assegnatari`,
    'startTime',
    {
      code: 'time_conflict',
      conflicts: found.map((t) => ({
        id: t.id,
        title: t.title,
        date: t.date,
        startTime: t.startTime,
        endTime: t.endTime,
      })),
    },
  );
}

// rilegge i riferimenti dell'input: colonna, genitore, etichette e assegnatari devono esistere
// e stare nella stessa board
function checkRefs(input, column, id) {
  const errors = validateTaskInput(input);
  const [field] = Object.keys(errors);
  if (field) throw badRequest(errors[field], field);

  if (input.parentId != null) {
    const parent = db.prepare('SELECT board_id FROM tasks WHERE id = ?').get(input.parentId);
    if (!parent || parent.board_id !== column.board_id) {
      throw badRequest('Attività genitore non trovata', 'parentId');
    }
    if (id != null) {
      const all = db.prepare('SELECT id, parent_id AS parentId FROM tasks').all();
      if (wouldCreateCycle(all, id, input.parentId)) {
        throw badRequest('Gerarchia non valida: si creerebbe un ciclo', 'parentId');
      }
    }
  }
  if (input.labelIds.length > 0) {
    const n = db
      .prepare(
        `SELECT COUNT(*) AS n FROM labels
         WHERE board_id = ? AND id IN (SELECT value FROM json_each(?))`,
      )
      .get(column.board_id, JSON.stringify(input.labelIds)).n;
    if (n !== input.labelIds.length) throw badRequest('Etichetta non trovata', 'labelIds');
  }
  if (input.assigneeIds.length > 0) {
    const n = db
      .prepare('SELECT COUNT(*) AS n FROM users WHERE id IN (SELECT value FROM json_each(?))')
      .get(JSON.stringify(input.assigneeIds)).n;
    if (n !== input.assigneeIds.length) throw badRequest('Utente non trovato', 'assigneeIds');
  }
}

function setAssignees(taskId, ids) {
  db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(taskId);
  const insert = db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)');
  for (const id of ids) insert.run(taskId, id);
}

function setLabels(taskId, ids) {
  db.prepare('DELETE FROM task_labels WHERE task_id = ?').run(taskId);
  const insert = db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)');
  for (const id of ids) insert.run(taskId, id);
}

function notifyAssigned(task, ids, actor) {
  for (const userId of ids) {
    notify(
      userId,
      actor.id,
      'assigned',
      task.id,
      `${displayName(actor)} ti ha assegnato "${task.title}"`,
    );
  }
}

function loadTask(id, user, { need = 'view' } = {}) {
  const task = getTaskById(id);
  if (!task) throw notFound();
  if (need === 'edit' && !canEdit(user, task)) throw forbidden();
  if (need === 'contribute' && !canContribute(user, task)) throw forbidden();
  return task;
}

// ---------------------------------------------------------------------------
// Completamento e ricorrenze
// ---------------------------------------------------------------------------

// Quando un'attività ricorrente passa in una colonna "completati" ne nasce la prossima
// occorrenza nella prima colonna, con gli stessi assegnatari ed etichette e la checklist azzerata.
// `recurrence_spawned` impedisce doppioni se la card viene spostata avanti e indietro.
function spawnNextOccurrence(task, actorId) {
  if (task.recurrence === 'none') return null;
  const flag = db.prepare('SELECT recurrence_spawned AS s FROM tasks WHERE id = ?').get(task.id);
  if (flag.s === 1) return null;
  const date = nextOccurrence(task.date, task.recurrence);
  const first = db
    .prepare('SELECT id FROM columns WHERE board_id = ? ORDER BY position LIMIT 1')
    .get(task.boardId);

  const info = db
    .prepare(
      `INSERT INTO tasks (board_id, column_id, title, description, date, start_time, end_time,
                          color, priority, parent_id, position, estimate_min, recurrence,
                          created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      task.boardId,
      first.id,
      task.title,
      task.description,
      date,
      task.startTime,
      task.endTime,
      task.color,
      task.priority,
      task.parentId,
      nextPosition(first.id),
      task.estimateMin,
      task.recurrence,
      task.createdBy.id,
    );
  const newId = Number(info.lastInsertRowid);
  db.prepare(
    'INSERT INTO task_assignees SELECT ?, user_id FROM task_assignees WHERE task_id = ?',
  ).run(newId, task.id);
  db.prepare('INSERT INTO task_labels SELECT ?, label_id FROM task_labels WHERE task_id = ?').run(
    newId,
    task.id,
  );
  db.prepare(
    `INSERT INTO checklist_items (task_id, text, done, position)
     SELECT ?, text, 0, position FROM checklist_items WHERE task_id = ?`,
  ).run(newId, task.id);
  db.prepare('UPDATE tasks SET recurrence_spawned = 1 WHERE id = ?').run(task.id);
  recordEvent(task.boardId, newId, actorId, 'task.recurred', { title: task.title, date });
  return newId;
}

// aggiorna completed_at e, se serve, genera la prossima occorrenza
function handleCompletion(before, after, actorId) {
  if (!before.isDone && after.isDone) {
    db.prepare("UPDATE tasks SET completed_at = datetime('now') WHERE id = ?").run(after.id);
    spawnNextOccurrence(after, actorId);
  } else if (before.isDone && !after.isDone) {
    db.prepare('UPDATE tasks SET completed_at = NULL WHERE id = ?').run(after.id);
  }
}

// ---------------------------------------------------------------------------
// Elenco di un'attività e cronologia
// ---------------------------------------------------------------------------

// dettaglio: l'attività con checklist e allegati
router.get('/:id', (req, res) => {
  const task = loadTask(parseId(req.params.id), req.user);
  const checklist = db
    .prepare('SELECT * FROM checklist_items WHERE task_id = ? ORDER BY position, id')
    .all(task.id)
    .map(rowToChecklistItem);
  const attachments = db
    .prepare('SELECT * FROM attachments WHERE task_id = ? ORDER BY id')
    .all(task.id)
    .map(rowToAttachment);
  res.json({ ...task, checklist, attachments });
});

router.get('/:id/events', (req, res) => {
  const task = loadTask(parseId(req.params.id), req.user);
  res.json(listEvents({ taskId: task.id, limit: 100 }));
});

// ---------------------------------------------------------------------------
// Creazione
// ---------------------------------------------------------------------------

const createTask = db.transaction((input, user, flags) => {
  const column = getColumn(input.columnId);
  if (!column) throw badRequest('Colonna non trovata', 'columnId');
  checkRefs(input, column, null);
  // un'attività già nella colonna dei completati non occupa più tempo a nessuno
  checkConflicts(input, null, flags.ignoreConflicts || column.is_done === 1);
  checkWip(column, 0, flags.force);

  const info = db
    .prepare(
      `INSERT INTO tasks (board_id, column_id, title, description, date, start_time, end_time,
                          color, priority, parent_id, position, estimate_min, spent_min,
                          recurrence, completed_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      column.board_id,
      column.id,
      input.title,
      input.description,
      input.date,
      input.startTime,
      input.endTime,
      input.color,
      input.priority,
      input.parentId,
      nextPosition(column.id),
      input.estimateMin,
      input.spentMin,
      input.recurrence,
      column.is_done ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
      user.id,
    );
  const id = Number(info.lastInsertRowid);
  setAssignees(id, input.assigneeIds);
  setLabels(id, input.labelIds);
  const task = getTaskById(id);
  recordEvent(column.board_id, id, user.id, 'task.created', {
    title: task.title,
    column: column.name,
  });
  notifyAssigned(task, input.assigneeIds, user);
  return task;
});

// i "flag" (ignoreConflicts, force) sono conferme dell'utente, non dati dell'attività
const flagsOf = (body) => ({
  ignoreConflicts: body?.ignoreConflicts === true,
  force: body?.force === true,
});

router.post('/', (req, res) => {
  res.status(201).json(createTask(normalizeTaskInput(req.body), req.user, flagsOf(req.body)));
});

// ---------------------------------------------------------------------------
// Modifica
// ---------------------------------------------------------------------------

const FIELD_LABELS = {
  title: 'titolo',
  description: 'descrizione',
  date: 'data',
  time: 'orario',
  color: 'colore',
  priority: 'priorità',
  parentId: 'genitore',
  estimateMin: 'stima',
  spentMin: 'tempo effettivo',
  recurrence: 'ripetizione',
  labels: 'etichette',
};

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

const updateTask = db.transaction((id, input, user, flags) => {
  const old = loadTask(id, user, { need: 'edit' });
  const column = getColumn(input.columnId);
  if (!column || column.board_id !== old.boardId)
    throw badRequest('Colonna non valida', 'columnId');
  checkRefs(input, column, id);

  const oldAssigneeIds = old.assignees.map((a) => a.id);
  const timeChanged =
    input.date !== old.date ||
    input.startTime !== old.startTime ||
    input.endTime !== old.endTime ||
    !sameSet(input.assigneeIds, oldAssigneeIds);
  // un conflitto già confermato in passato non va richiesto a ogni modifica del titolo
  if (timeChanged) checkConflicts(input, id, flags.ignoreConflicts || column.is_done === 1);

  const columnChanged = column.id !== old.columnId;
  if (columnChanged) checkWip(column, id, flags.force);

  let position = old.position;
  if (columnChanged) {
    if (old.archivedAt == null) closeGap(old.columnId, old.position);
    position = nextPosition(column.id);
  }
  db.prepare(
    `UPDATE tasks SET title = ?, description = ?, column_id = ?, date = ?, start_time = ?,
                      end_time = ?, color = ?, priority = ?, parent_id = ?, position = ?,
                      estimate_min = ?, spent_min = ?, recurrence = ?,
                      updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    input.title,
    input.description,
    column.id,
    input.date,
    input.startTime,
    input.endTime,
    input.color,
    input.priority,
    input.parentId,
    position,
    input.estimateMin,
    input.spentMin,
    input.recurrence,
    id,
  );
  const oldLabelIds = old.labels.map((l) => l.id);
  setAssignees(id, input.assigneeIds);
  setLabels(id, input.labelIds);

  const task = getTaskById(id);
  if (columnChanged) handleCompletion(old, task, user.id);

  // cronologia: cosa è cambiato davvero
  const changed = [];
  for (const f of ['title', 'description', 'color', 'priority', 'parentId']) {
    if (input[f] !== old[f]) changed.push(FIELD_LABELS[f]);
  }
  if (
    input.date !== old.date ||
    input.startTime !== old.startTime ||
    input.endTime !== old.endTime
  ) {
    changed.push(FIELD_LABELS.time);
  }
  for (const f of ['estimateMin', 'spentMin', 'recurrence']) {
    if (input[f] !== old[f]) changed.push(FIELD_LABELS[f]);
  }
  if (!sameSet(input.labelIds, oldLabelIds)) changed.push(FIELD_LABELS.labels);

  const added = input.assigneeIds.filter((a) => !oldAssigneeIds.includes(a));
  const removed = oldAssigneeIds.filter((a) => !input.assigneeIds.includes(a));
  if (changed.length > 0) {
    recordEvent(old.boardId, id, user.id, 'task.updated', { title: task.title, fields: changed });
  }
  if (added.length + removed.length > 0) {
    const names = (ids) =>
      db
        .prepare('SELECT username FROM users WHERE id IN (SELECT value FROM json_each(?))')
        .all(JSON.stringify(ids))
        .map((u) => u.username);
    recordEvent(old.boardId, id, user.id, 'task.assigned', {
      title: task.title,
      added: names(added),
      removed: names(removed),
    });
    notifyAssigned(task, added, user);
  }
  if (columnChanged) {
    recordEvent(old.boardId, id, user.id, 'task.moved', {
      title: task.title,
      from: getColumn(old.columnId).name,
      to: column.name,
    });
  }
  return getTaskById(id);
});

router.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  res.json(updateTask(id, normalizeTaskInput(req.body), req.user, flagsOf(req.body)));
});

// ---------------------------------------------------------------------------
// Spostamento (permesso a chiunque sia loggato) e archivio
// ---------------------------------------------------------------------------

const moveTask = db.transaction((id, columnId, position, user, flags) => {
  const old = getTaskById(id);
  if (!old) throw notFound();
  const column = getColumn(columnId);
  if (!column || column.board_id !== old.boardId)
    throw badRequest('Colonna non valida', 'columnId');
  if (old.archivedAt) throw badRequest("Ripristina l'attività dall'archivio prima di spostarla");

  const columnChanged = column.id !== old.columnId;
  if (columnChanged) checkWip(column, id, flags.force);

  closeGap(old.columnId, old.position);
  const n = openCount(column.id, id);
  const newPos = Math.min(position, n);
  db.prepare(
    `UPDATE tasks SET position = position + 1
     WHERE column_id = ? AND position >= ? AND id != ? AND archived_at IS NULL`,
  ).run(column.id, newPos, id);
  db.prepare(
    `UPDATE tasks SET column_id = ?, position = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(column.id, newPos, id);

  const task = getTaskById(id);
  if (columnChanged) {
    handleCompletion(old, task, user.id);
    recordEvent(old.boardId, id, user.id, 'task.moved', {
      title: task.title,
      from: getColumn(old.columnId).name,
      to: column.name,
    });
  }
  return getTaskById(id);
});

router.patch('/:id/move', (req, res) => {
  const id = parseId(req.params.id);
  const { columnId, position } = req.body ?? {};
  if (!Number.isInteger(columnId) || columnId <= 0)
    throw badRequest('Colonna non valida', 'columnId');
  if (!Number.isInteger(position) || position < 0) {
    throw badRequest('Posizione non valida', 'position');
  }
  res.json(moveTask(id, columnId, position, req.user, flagsOf(req.body)));
});

// archiviare e ripristinare si possono annullare a vicenda, quindi come spostare: a tutti
const setArchived = db.transaction((id, archived, user) => {
  const task = loadTask(id, user);
  if (archived === (task.archivedAt != null)) return task;
  if (archived) {
    closeGap(task.columnId, task.position);
    db.prepare("UPDATE tasks SET archived_at = datetime('now'), position = 0 WHERE id = ?").run(id);
  } else {
    db.prepare('UPDATE tasks SET archived_at = NULL, position = ? WHERE id = ?').run(
      nextPosition(task.columnId),
      id,
    );
  }
  recordEvent(task.boardId, id, user.id, archived ? 'task.archived' : 'task.restored', {
    title: task.title,
  });
  return getTaskById(id);
});

router.post('/:id/archive', (req, res) => {
  const archived = req.body?.archived !== false;
  res.json(setArchived(parseId(req.params.id), archived, req.user));
});

// ---------------------------------------------------------------------------
// Eliminazione
// ---------------------------------------------------------------------------

// i file degli allegati non spariscono con le righe del database: si cancellano a parte
export function removeStoredFiles(names) {
  for (const name of names) {
    try {
      fs.unlinkSync(path.join(config.uploadDir, name));
    } catch {
      // file già assente: va bene
    }
  }
}

const deleteTask = db.transaction((id, user) => {
  const task = loadTask(id, user, { need: 'edit' });
  const files = db
    .prepare("SELECT stored_name FROM attachments WHERE task_id = ? AND kind = 'file'")
    .all(id)
    .map((a) => a.stored_name);
  // le foreign key staccano i figli e cancellano commenti, checklist e allegati
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  if (task.archivedAt == null) closeGap(task.columnId, task.position);
  recordEvent(task.boardId, id, user.id, 'task.deleted', { title: task.title });
  return files;
});

router.delete('/:id', (req, res) => {
  removeStoredFiles(deleteTask(parseId(req.params.id), req.user));
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Tempo effettivo e checklist (anche per gli assegnati)
// ---------------------------------------------------------------------------

router.patch('/:id/time', (req, res) => {
  const task = loadTask(parseId(req.params.id), req.user, { need: 'contribute' });
  const spent = req.body?.spentMin;
  if (!Number.isInteger(spent) || spent < 0 || spent > LIMITS.minutesMax) {
    throw badRequest('Tempo non valido', 'spentMin');
  }
  db.prepare("UPDATE tasks SET spent_min = ?, updated_at = datetime('now') WHERE id = ?").run(
    spent,
    task.id,
  );
  res.json(getTaskById(task.id));
});

const checklistItem = (taskId, itemId) => {
  const row = db
    .prepare('SELECT * FROM checklist_items WHERE id = ? AND task_id = ?')
    .get(itemId, taskId);
  if (!row) throw notFound('Voce non trovata');
  return row;
};

router.post('/:id/checklist', (req, res) => {
  const task = loadTask(parseId(req.params.id), req.user, { need: 'contribute' });
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const error = validateName(text, LIMITS.checklistTextMax, 'Voce');
  if (error) throw badRequest(error, 'text');
  const { n } = db
    .prepare('SELECT COUNT(*) AS n FROM checklist_items WHERE task_id = ?')
    .get(task.id);
  if (n >= 100) throw badRequest('Al massimo 100 voci per checklist', 'text');
  const info = db
    .prepare(
      `INSERT INTO checklist_items (task_id, text, position)
       VALUES (?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM checklist_items WHERE task_id = ?))`,
    )
    .run(task.id, text, task.id);
  res
    .status(201)
    .json(
      rowToChecklistItem(
        db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(info.lastInsertRowid),
      ),
    );
});

router.put('/:id/checklist/:itemId', (req, res) => {
  const task = loadTask(parseId(req.params.id), req.user, { need: 'contribute' });
  const item = checklistItem(task.id, parseId(req.params.itemId, 'Voce non trovata'));
  const body = req.body ?? {};
  let text = item.text;
  let done = item.done;
  if (body.text !== undefined) {
    text = typeof body.text === 'string' ? body.text.trim() : '';
    const error = validateName(text, LIMITS.checklistTextMax, 'Voce');
    if (error) throw badRequest(error, 'text');
  }
  if (body.done !== undefined) {
    if (typeof body.done !== 'boolean') throw badRequest('Valore non valido', 'done');
    done = body.done ? 1 : 0;
  }
  db.prepare('UPDATE checklist_items SET text = ?, done = ? WHERE id = ?').run(text, done, item.id);
  res.json(
    rowToChecklistItem(db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(item.id)),
  );
});

router.delete('/:id/checklist/:itemId', (req, res) => {
  const task = loadTask(parseId(req.params.id), req.user, { need: 'contribute' });
  const item = checklistItem(task.id, parseId(req.params.itemId, 'Voce non trovata'));
  db.prepare('DELETE FROM checklist_items WHERE id = ?').run(item.id);
  res.status(204).end();
});

export { loadTask };
export default router;
