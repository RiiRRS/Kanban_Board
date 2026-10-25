// API delle attività: elenco, creazione, modifica, spostamento, eliminazione

import express from 'express';
import { db, getTaskById, TASK_SELECT, rowToTask } from './db.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import {
  normalizeTaskInput,
  validateTaskInput,
  findTimeConflict,
  wouldCreateCycle,
} from '../public/js/validation.js';
import { STATUSES } from '../public/js/constants.js';

const router = express.Router();

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  return id;
}

// solo i campi che servono alle regole
function allTasksLight() {
  return db
    .prepare('SELECT id, date, start_time AS startTime, parent_id AS parentId FROM tasks')
    .all();
}

function checkTaskRules(input, id = null) {
  const errors = validateTaskInput(input);
  const [field] = Object.keys(errors);
  if (field) throw badRequest(errors[field], field);

  const tasks = allTasksLight();
  if (input.parentId != null) {
    if (!tasks.some((t) => t.id === input.parentId)) {
      throw badRequest('Attività genitore non trovata', 'parentId');
    }
    if (id != null && wouldCreateCycle(tasks, id, input.parentId)) {
      throw badRequest('Gerarchia non valida: si creerebbe un ciclo', 'parentId');
    }
  }
  if (findTimeConflict(tasks, { id, date: input.date, startTime: input.startTime })) {
    throw conflict(
      `Esiste già un'attività che inizia alle ${input.startTime} in questo giorno`,
      'startTime',
    );
  }
}

const canEdit = (user, task) => user.role === 'admin' || task.createdBy.id === user.id;

const nextPosition = (status) =>
  db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM tasks WHERE status = ?').get(status)
    .p;

// chiude il buco lasciato da una card che esce dalla colonna
const closeGap = (status, position) =>
  db
    .prepare('UPDATE tasks SET position = position - 1 WHERE status = ? AND position > ?')
    .run(status, position);

function loadTask(id, user, { needEdit }) {
  const task = getTaskById(id);
  if (!task) throw notFound();
  if (needEdit && !canEdit(user, task)) throw forbidden();
  return task;
}

router.get('/', (req, res) => {
  const rows = db.prepare(`${TASK_SELECT} ORDER BY t.status, t.position, t.id`).all();
  res.json(rows.map(rowToTask));
});

const createTask = db.transaction((input, userId) => {
  checkTaskRules(input);
  const info = db
    .prepare(
      `INSERT INTO tasks (title, description, status, date, start_time, end_time,
                          color, priority, parent_id, position, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.title,
      input.description,
      input.status,
      input.date,
      input.startTime,
      input.endTime,
      input.color,
      input.priority,
      input.parentId,
      nextPosition(input.status),
      userId,
    );
  return getTaskById(info.lastInsertRowid);
});

router.post('/', (req, res) => {
  const task = createTask(normalizeTaskInput(req.body), req.user.id);
  res.status(201).json(task);
});

const updateTask = db.transaction((id, input, user) => {
  const old = loadTask(id, user, { needEdit: true });
  checkTaskRules(input, id);

  let position = old.position;
  if (input.status !== old.status) {
    closeGap(old.status, old.position);
    position = nextPosition(input.status);
  }
  db.prepare(
    `UPDATE tasks SET title = ?, description = ?, status = ?, date = ?, start_time = ?,
                      end_time = ?, color = ?, priority = ?, parent_id = ?, position = ?,
                      updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    input.title,
    input.description,
    input.status,
    input.date,
    input.startTime,
    input.endTime,
    input.color,
    input.priority,
    input.parentId,
    position,
    id,
  );
  return getTaskById(id);
});

router.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  res.json(updateTask(id, normalizeTaskInput(req.body), req.user));
});

const moveTask = db.transaction((id, status, position) => {
  const task = getTaskById(id);
  if (!task) throw notFound();

  closeGap(task.status, task.position);
  const { n } = db
    .prepare('SELECT COUNT(*) AS n FROM tasks WHERE status = ? AND id != ?')
    .get(status, id);
  const newPos = Math.min(position, n);
  db.prepare(
    'UPDATE tasks SET position = position + 1 WHERE status = ? AND position >= ? AND id != ?',
  ).run(status, newPos, id);
  db.prepare(
    `UPDATE tasks SET status = ?, position = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(status, newPos, id);
  return getTaskById(id);
});

// spostare è permesso a chiunque sia loggato
router.patch('/:id/move', (req, res) => {
  const id = parseId(req.params.id);
  const { status, position } = req.body ?? {};
  if (!STATUSES.includes(status)) throw badRequest('Stato non valido', 'status');
  if (!Number.isInteger(position) || position < 0) {
    throw badRequest('Posizione non valida', 'position');
  }
  res.json(moveTask(id, status, position));
});

const deleteTask = db.transaction((id, user) => {
  const task = loadTask(id, user, { needEdit: true });
  // le foreign key staccano i figli e cancellano i commenti
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  closeGap(task.status, task.position);
});

router.delete('/:id', (req, res) => {
  deleteTask(parseId(req.params.id), req.user);
  res.status(204).end();
});

export default router;
