// API delle board: board, colonne, etichette, archivio, statistiche, export e import

import express from 'express';
import {
  db,
  getBoardById,
  listBoardTasks,
  publicUser,
  rowToColumn,
  rowToLabel,
  toIso,
} from './db.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import {
  normalizeTaskInput,
  validateTaskInput,
  validateName,
  isValidColor,
} from '../public/js/validation.js';
import { DEFAULT_COLUMNS, DEFAULT_COLOR, LIMITS } from '../public/js/constants.js';
import { canManageBoard } from './access.js';
import { recordEvent, listEvents } from './events.js';
import { localToday } from './notifications.js';
import { parseId, removeStoredFiles } from './tasks.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function loadBoard(value, user, { manage = false } = {}) {
  const board = getBoardById(parseId(value, 'Board non trovata'));
  if (!board) throw notFound('Board non trovata');
  if (manage && !canManageBoard(user, board)) throw forbidden();
  return board;
}

function boardName(value) {
  const error = validateName(value, LIMITS.boardNameMax, 'Board');
  if (error) throw badRequest(error, 'name');
  return value.trim();
}

function wipValue(value) {
  if (value == null || value === '') return null;
  if (!Number.isInteger(value) || value < 1 || value > LIMITS.wipMax) {
    throw badRequest(`Il limite deve essere un numero tra 1 e ${LIMITS.wipMax}`, 'wipLimit');
  }
  return value;
}

function createBoard(
  name,
  userId,
  columns = DEFAULT_COLUMNS.map(([n, d]) => ({ name: n, isDone: d })),
) {
  const info = db.prepare('INSERT INTO boards (name, created_by) VALUES (?, ?)').run(name, userId);
  const boardId = Number(info.lastInsertRowid);
  const insert = db.prepare(
    'INSERT INTO columns (board_id, name, position, wip_limit, is_done) VALUES (?, ?, ?, ?, ?)',
  );
  columns.forEach((c, i) => insert.run(boardId, c.name, i, c.wipLimit ?? null, c.isDone ? 1 : 0));
  return boardId;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.*,
         (SELECT COUNT(*) FROM tasks t WHERE t.board_id = b.id AND t.archived_at IS NULL)
           AS task_count
       FROM boards b ORDER BY b.id`,
    )
    .all();
  res.json(
    rows.map((b) => ({
      id: b.id,
      name: b.name,
      createdBy: b.created_by,
      taskCount: b.task_count,
    })),
  );
});

router.post('/', (req, res) => {
  const name = boardName(req.body?.name);
  const id = db.transaction(() => {
    const boardId = createBoard(name, req.user.id);
    recordEvent(boardId, null, req.user.id, 'board.created', { name });
    return boardId;
  })();
  res.status(201).json(getBoardById(id));
});

router.get('/:id', (req, res) => {
  res.json(loadBoard(req.params.id, req.user));
});

router.put('/:id', (req, res) => {
  const board = loadBoard(req.params.id, req.user, { manage: true });
  db.prepare('UPDATE boards SET name = ? WHERE id = ?').run(boardName(req.body?.name), board.id);
  res.json(getBoardById(board.id));
});

router.delete('/:id', (req, res) => {
  const board = loadBoard(req.params.id, req.user, { manage: true });
  if (db.prepare('SELECT COUNT(*) AS n FROM boards').get().n <= 1) {
    throw badRequest("Non puoi eliminare l'ultima board");
  }
  const files = db.transaction(() => {
    const names = db
      .prepare(
        `SELECT a.stored_name FROM attachments a JOIN tasks t ON t.id = a.task_id
         WHERE t.board_id = ? AND a.kind = 'file'`,
      )
      .all(board.id)
      .map((a) => a.stored_name);
    // prima le attività (che puntano alle colonne), poi la board con colonne ed etichette
    db.prepare('DELETE FROM tasks WHERE board_id = ?').run(board.id);
    db.prepare('DELETE FROM boards WHERE id = ?').run(board.id);
    return names;
  })();
  removeStoredFiles(files);
  res.status(204).end();
});

router.get('/:id/tasks', (req, res) => {
  const board = loadBoard(req.params.id, req.user);
  res.json(listBoardTasks(board.id, { archived: req.query.archived === '1' }));
});

router.get('/:id/events', (req, res) => {
  const board = loadBoard(req.params.id, req.user);
  const before = Number(req.query.before);
  res.json(
    listEvents({
      boardId: board.id,
      limit: Number(req.query.limit) || 50,
      before: Number.isInteger(before) && before > 0 ? before : null,
    }),
  );
});

// ---------------------------------------------------------------------------
// Colonne
// ---------------------------------------------------------------------------

function loadColumn(board, value) {
  const column = db
    .prepare('SELECT * FROM columns WHERE id = ? AND board_id = ?')
    .get(parseId(value, 'Colonna non trovata'), board.id);
  if (!column) throw notFound('Colonna non trovata');
  return column;
}

function columnName(value) {
  const error = validateName(value, LIMITS.columnNameMax, 'Colonna');
  if (error) throw badRequest(error, 'name');
  return value.trim();
}

router.post('/:id/columns', (req, res) => {
  const board = loadBoard(req.params.id, req.user, { manage: true });
  const name = columnName(req.body?.name);
  const wip = wipValue(req.body?.wipLimit);
  if (board.columns.length >= 20) throw badRequest('Al massimo 20 colonne per board', 'name');
  const info = db
    .prepare(
      `INSERT INTO columns (board_id, name, position, wip_limit, is_done)
       VALUES (?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM columns WHERE board_id = ?), ?, ?)`,
    )
    .run(board.id, name, board.id, wip, req.body?.isDone === true ? 1 : 0);
  res
    .status(201)
    .json(rowToColumn(db.prepare('SELECT * FROM columns WHERE id = ?').get(info.lastInsertRowid)));
});

// l'ordine va prima di /:columnId, altrimenti "order" verrebbe preso per un id
router.put('/:id/columns-order', (req, res) => {
  const board = loadBoard(req.params.id, req.user, { manage: true });
  const ids = req.body?.ids;
  const current = board.columns.map((c) => c.id);
  if (
    !Array.isArray(ids) ||
    ids.length !== current.length ||
    !ids.every((id) => current.includes(id)) ||
    new Set(ids).size !== ids.length
  ) {
    throw badRequest("L'elenco deve contenere tutte le colonne, una volta sola");
  }
  const update = db.prepare('UPDATE columns SET position = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id, i) => update.run(i, id)))();
  res.json(getBoardById(board.id));
});

router.put('/:id/columns/:columnId', (req, res) => {
  const board = loadBoard(req.params.id, req.user, { manage: true });
  const column = loadColumn(board, req.params.columnId);
  const name = columnName(req.body?.name);
  const wip = wipValue(req.body?.wipLimit);
  const isDone = req.body?.isDone === true ? 1 : 0;
  db.transaction(() => {
    db.prepare('UPDATE columns SET name = ?, wip_limit = ?, is_done = ? WHERE id = ?').run(
      name,
      wip,
      isDone,
      column.id,
    );
    // cambiando il significato della colonna cambia anche cosa conta come "completato"
    if (isDone !== column.is_done) {
      db.prepare(
        isDone
          ? "UPDATE tasks SET completed_at = COALESCE(completed_at, datetime('now')) WHERE column_id = ?"
          : 'UPDATE tasks SET completed_at = NULL WHERE column_id = ?',
      ).run(column.id);
    }
  })();
  res.json(rowToColumn(db.prepare('SELECT * FROM columns WHERE id = ?').get(column.id)));
});

// con attività dentro, serve dire dove spostarle (?moveTo=ID)
router.delete('/:id/columns/:columnId', (req, res) => {
  const board = loadBoard(req.params.id, req.user, { manage: true });
  const column = loadColumn(board, req.params.columnId);
  if (board.columns.length <= 1) throw badRequest('Una board deve avere almeno una colonna');

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE column_id = ?').get(column.id);
  let target = null;
  if (n > 0) {
    if (!req.query.moveTo) {
      throw conflict(`La colonna contiene ${n} attività: scegli dove spostarle`, null, {
        code: 'column_not_empty',
        count: n,
      });
    }
    target = loadColumn(board, req.query.moveTo);
    if (target.id === column.id) throw badRequest('Scegli un’altra colonna');
  }

  db.transaction(() => {
    if (target) {
      // in fondo alla colonna di destinazione, nell'ordine di prima; le archiviate restano a 0
      let next = db
        .prepare(
          'SELECT COALESCE(MAX(position) + 1, 0) AS p FROM tasks WHERE column_id = ? AND archived_at IS NULL',
        )
        .get(target.id).p;
      const moving = db
        .prepare('SELECT id, archived_at FROM tasks WHERE column_id = ? ORDER BY position, id')
        .all(column.id);
      const move = db.prepare('UPDATE tasks SET column_id = ?, position = ? WHERE id = ?');
      for (const t of moving) move.run(target.id, t.archived_at ? 0 : next++, t.id);
      // chi finisce in una colonna "completati" (o ne esce) aggiorna la data di completamento
      if (target.is_done !== column.is_done) {
        db.prepare(
          target.is_done
            ? "UPDATE tasks SET completed_at = COALESCE(completed_at, datetime('now')) WHERE column_id = ?"
            : 'UPDATE tasks SET completed_at = NULL WHERE column_id = ?',
        ).run(target.id);
      }
    }
    db.prepare('DELETE FROM columns WHERE id = ?').run(column.id);
    // richiude i buchi nelle posizioni delle colonne
    const rest = db
      .prepare('SELECT id FROM columns WHERE board_id = ? ORDER BY position, id')
      .all(board.id);
    const reposition = db.prepare('UPDATE columns SET position = ? WHERE id = ?');
    rest.forEach((c, i) => reposition.run(i, c.id));
  })();
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Etichette
// ---------------------------------------------------------------------------

function labelFields(body) {
  const error = validateName(body?.name, LIMITS.labelNameMax, 'Etichetta');
  if (error) throw badRequest(error, 'name');
  const color = body?.color ?? DEFAULT_COLOR;
  if (!isValidColor(color)) throw badRequest('Colore non valido', 'color');
  return { name: body.name.trim(), color };
}

const labelTaken = (error) => {
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    throw conflict('Esiste già un’etichetta con questo nome', 'name');
  }
  throw error;
};

// creare etichette è permesso a tutti (servono a chi lavora); modificarle o toglierle no
router.post('/:id/labels', (req, res) => {
  const board = loadBoard(req.params.id, req.user);
  const { name, color } = labelFields(req.body);
  try {
    const info = db
      .prepare('INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)')
      .run(board.id, name, color);
    res
      .status(201)
      .json(rowToLabel(db.prepare('SELECT * FROM labels WHERE id = ?').get(info.lastInsertRowid)));
  } catch (err) {
    labelTaken(err);
  }
});

function loadLabel(board, value) {
  const label = db
    .prepare('SELECT * FROM labels WHERE id = ? AND board_id = ?')
    .get(parseId(value, 'Etichetta non trovata'), board.id);
  if (!label) throw notFound('Etichetta non trovata');
  return label;
}

router.put('/:id/labels/:labelId', (req, res) => {
  const board = loadBoard(req.params.id, req.user, { manage: true });
  const label = loadLabel(board, req.params.labelId);
  const { name, color } = labelFields(req.body);
  try {
    db.prepare('UPDATE labels SET name = ?, color = ? WHERE id = ?').run(name, color, label.id);
  } catch (err) {
    labelTaken(err);
  }
  res.json(rowToLabel(db.prepare('SELECT * FROM labels WHERE id = ?').get(label.id)));
});

router.delete('/:id/labels/:labelId', (req, res) => {
  const board = loadBoard(req.params.id, req.user, { manage: true });
  db.prepare('DELETE FROM labels WHERE id = ?').run(loadLabel(board, req.params.labelId).id);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Archivio
// ---------------------------------------------------------------------------

// archivia tutte le attività nelle colonne dei completati
router.post('/:id/archive-done', (req, res) => {
  const board = loadBoard(req.params.id, req.user);
  const archived = db.transaction(() => {
    const tasks = db
      .prepare(
        `SELECT t.id, t.title FROM tasks t JOIN columns c ON c.id = t.column_id
         WHERE t.board_id = ? AND c.is_done = 1 AND t.archived_at IS NULL`,
      )
      .all(board.id);
    db.prepare(
      `UPDATE tasks SET archived_at = datetime('now'), position = 0
       WHERE board_id = ? AND archived_at IS NULL
         AND column_id IN (SELECT id FROM columns WHERE board_id = ? AND is_done = 1)`,
    ).run(board.id, board.id);
    if (tasks.length > 0) {
      recordEvent(board.id, null, req.user.id, 'board.archived-done', { count: tasks.length });
    }
    return tasks.length;
  })();
  res.json({ archived });
});

// ---------------------------------------------------------------------------
// Statistiche
// ---------------------------------------------------------------------------

router.get('/:id/stats', (req, res) => {
  const board = loadBoard(req.params.id, req.user);
  const today = localToday();
  const now = new Date();
  const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const open = db
    .prepare(
      `SELECT t.*, c.is_done FROM tasks t JOIN columns c ON c.id = t.column_id
       WHERE t.board_id = ? AND t.archived_at IS NULL`,
    )
    .all(board.id);
  const isOverdue = (t) =>
    !t.is_done && (t.date < today || (t.date === today && t.end_time < nowTime));

  const perColumn = board.columns.map((c) => ({
    columnId: c.id,
    name: c.name,
    isDone: c.isDone,
    wipLimit: c.wipLimit,
    count: open.filter((t) => t.column_id === c.id).length,
  }));

  const perPriority = { low: 0, medium: 0, high: 0 };
  for (const t of open) if (!t.is_done) perPriority[t.priority]++;

  const assignedTo = db
    .prepare(
      `SELECT ta.task_id, u.id, u.username, u.display_name, u.avatar_color
       FROM task_assignees ta JOIN users u ON u.id = ta.user_id
       JOIN tasks t ON t.id = ta.task_id WHERE t.board_id = ? AND t.archived_at IS NULL`,
    )
    .all(board.id);
  const people = new Map();
  const bucket = (key, user) => {
    if (!people.has(key)) {
      people.set(key, { user, open: 0, done: 0, estimateMin: 0, spentMin: 0 });
    }
    return people.get(key);
  };
  const addTo = (b, t) => {
    b[t.is_done ? 'done' : 'open']++;
    b.estimateMin += t.estimate_min ?? 0;
    b.spentMin += t.spent_min;
  };
  const byId = new Map(open.map((t) => [t.id, t]));
  const assigned = new Set();
  for (const a of assignedTo) {
    assigned.add(a.task_id);
    addTo(bucket(a.id, publicUser(a)), byId.get(a.task_id));
  }
  for (const t of open) if (!assigned.has(t.id)) addTo(bucket('none', null), t);

  // completate negli ultimi 14 giorni (giorno locale del server)
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    );
  }
  const completed = db
    .prepare(
      `SELECT date(completed_at, 'localtime') AS day, COUNT(*) AS n FROM tasks
       WHERE board_id = ? AND completed_at IS NOT NULL AND date(completed_at, 'localtime') >= ?
       GROUP BY day`,
    )
    .all(board.id, days[0]);
  const completedByDay = new Map(completed.map((r) => [r.day, r.n]));

  const archived = db
    .prepare('SELECT COUNT(*) AS n FROM tasks WHERE board_id = ? AND archived_at IS NOT NULL')
    .get(board.id).n;

  res.json({
    totals: {
      open: open.filter((t) => !t.is_done).length,
      done: open.filter((t) => t.is_done).length,
      archived,
      overdue: open.filter(isOverdue).length,
      dueToday: open.filter((t) => !t.is_done && t.date === today).length,
      estimateMin: open.reduce((s, t) => s + (t.estimate_min ?? 0), 0),
      spentMin: open.reduce((s, t) => s + t.spent_min, 0),
    },
    perColumn,
    perPriority,
    perAssignee: [...people.values()].sort((a, b) =>
      (a.user?.username ?? '~').localeCompare(b.user?.username ?? '~'),
    ),
    completedPerDay: days.map((date) => ({ date, count: completedByDay.get(date) ?? 0 })),
  });
});

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

const EXPORT_FORMAT = 'kanban-board';

function exportBoard(board) {
  const tasks = db
    .prepare(
      `SELECT t.*, c.name AS column_name, u.username AS creator FROM tasks t
       JOIN columns c ON c.id = t.column_id JOIN users u ON u.id = t.created_by
       WHERE t.board_id = ? ORDER BY c.position, t.position, t.id`,
    )
    .all(board.id);
  const rel = (sql) => {
    const map = new Map();
    for (const r of db.prepare(sql).all(board.id)) {
      if (!map.has(r.task_id)) map.set(r.task_id, []);
      map.get(r.task_id).push(r);
    }
    return map;
  };
  const assignees = rel(
    `SELECT ta.task_id, u.username AS v FROM task_assignees ta JOIN users u ON u.id = ta.user_id
     JOIN tasks t ON t.id = ta.task_id WHERE t.board_id = ? ORDER BY u.username`,
  );
  const labels = rel(
    `SELECT tl.task_id, l.name AS v FROM task_labels tl JOIN labels l ON l.id = tl.label_id
     JOIN tasks t ON t.id = tl.task_id WHERE t.board_id = ? ORDER BY l.name`,
  );
  const checklist = rel(
    `SELECT k.task_id, k.text, k.done FROM checklist_items k JOIN tasks t ON t.id = k.task_id
     WHERE t.board_id = ? ORDER BY k.position, k.id`,
  );
  const comments = rel(
    `SELECT c.task_id, c.text, c.created_at, u.username AS author FROM comments c
     JOIN users u ON u.id = c.author_id JOIN tasks t ON t.id = c.task_id
     WHERE t.board_id = ? ORDER BY c.id`,
  );
  const links = rel(
    `SELECT a.task_id, a.name, a.url FROM attachments a JOIN tasks t ON t.id = a.task_id
     WHERE t.board_id = ? AND a.kind = 'link' ORDER BY a.id`,
  );
  return {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    board: { name: board.name },
    columns: board.columns.map((c) => ({ name: c.name, wipLimit: c.wipLimit, isDone: c.isDone })),
    labels: board.labels.map((l) => ({ name: l.name, color: l.color })),
    tasks: tasks.map((t) => ({
      ref: t.id,
      parentRef: t.parent_id,
      title: t.title,
      description: t.description,
      column: t.column_name,
      date: t.date,
      startTime: t.start_time,
      endTime: t.end_time,
      color: t.color,
      priority: t.priority,
      estimateMin: t.estimate_min,
      spentMin: t.spent_min,
      recurrence: t.recurrence,
      archived: t.archived_at != null,
      completedAt: toIso(t.completed_at),
      createdBy: t.creator,
      assignees: (assignees.get(t.id) ?? []).map((r) => r.v),
      labels: (labels.get(t.id) ?? []).map((r) => r.v),
      checklist: (checklist.get(t.id) ?? []).map((r) => ({ text: r.text, done: r.done === 1 })),
      comments: (comments.get(t.id) ?? []).map((r) => ({
        author: r.author,
        text: r.text,
        createdAt: toIso(r.created_at),
      })),
      links: (links.get(t.id) ?? []).map((r) => ({ name: r.name, url: r.url })),
    })),
  };
}

// una cella che inizia con = + - @ verrebbe eseguita come formula da Excel e simili
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(data) {
  const header = [
    'Titolo',
    'Colonna',
    'Data',
    'Inizio',
    'Fine',
    'Priorità',
    'Assegnatari',
    'Etichette',
    'Stima (min)',
    'Tempo (min)',
    'Archiviata',
    'Descrizione',
  ];
  const rows = data.tasks.map((t) => [
    t.title,
    t.column,
    t.date,
    t.startTime,
    t.endTime,
    t.priority,
    t.assignees.join('; '),
    t.labels.join('; '),
    t.estimateMin ?? '',
    t.spentMin,
    t.archived ? 'sì' : 'no',
    t.description,
  ]);
  // il BOM fa riconoscere l'UTF-8 a Excel
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

router.get('/:id/export', (req, res) => {
  const board = loadBoard(req.params.id, req.user);
  const data = exportBoard(board);
  const safeName = board.name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'board';
  if (req.query.format === 'csv') {
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}.csv"`,
    });
    return res.send(toCsv(data));
  }
  res.set({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${safeName}.json"`,
  });
  res.send(JSON.stringify(data, null, 2));
});

const MAX_IMPORT_TASKS = 2000;

const text = (v) => (typeof v === 'string' ? v : '');

// L'import crea sempre una board nuova: non tocca mai quelle esistenti. Utenti che non
// esistono qui vengono ignorati come assegnatari; autore di attività e commenti diventa chi importa.
const importBoard = db.transaction((data, user) => {
  if (data?.format !== EXPORT_FORMAT || data.version !== 1) {
    throw badRequest('File non riconosciuto: serve un export di questa applicazione');
  }
  if (!Array.isArray(data.columns) || data.columns.length === 0 || data.columns.length > 20) {
    throw badRequest('Il file deve contenere da 1 a 20 colonne');
  }
  if (!Array.isArray(data.tasks) || data.tasks.length > MAX_IMPORT_TASKS) {
    throw badRequest(`Il file può contenere al massimo ${MAX_IMPORT_TASKS} attività`);
  }
  const labels = Array.isArray(data.labels) ? data.labels.slice(0, 100) : [];

  const name = boardName(
    `${text(data.board?.name).trim() || 'Board'}`.slice(0, LIMITS.boardNameMax),
  );
  const columns = data.columns.map((c) => ({
    name: columnName(c?.name),
    wipLimit: wipValue(c?.wipLimit),
    isDone: c?.isDone === true,
  }));
  if (new Set(columns.map((c) => c.name)).size !== columns.length) {
    throw badRequest('I nomi delle colonne devono essere diversi');
  }
  const boardId = createBoard(name, user.id, columns);
  const columnIds = new Map(
    db
      .prepare('SELECT id, name FROM columns WHERE board_id = ?')
      .all(boardId)
      .map((c) => [c.name, c.id]),
  );

  const labelIds = new Map();
  for (const l of labels) {
    const { name: labelName, color } = labelFields(l);
    if (labelIds.has(labelName.toLowerCase())) continue;
    const info = db
      .prepare('INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)')
      .run(boardId, labelName, color);
    labelIds.set(labelName.toLowerCase(), Number(info.lastInsertRowid));
  }

  const userId = (username) =>
    db.prepare('SELECT id FROM users WHERE username = ?').get(text(username))?.id ?? null;

  const insertTask = db.prepare(
    `INSERT INTO tasks (board_id, column_id, title, description, date, start_time, end_time,
                        color, priority, position, estimate_min, spent_min, recurrence,
                        completed_at, archived_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const created = new Map(); // ref nel file -> id nuovo
  const positions = new Map();
  const parents = [];

  data.tasks.forEach((raw, index) => {
    const where = `Attività ${index + 1}`;
    const columnId = columnIds.get(text(raw?.column));
    if (!columnId) throw badRequest(`${where}: colonna "${text(raw?.column)}" non trovata`);
    // si riusano le stesse regole dell'app (con valori finti dove servono id)
    const input = normalizeTaskInput({
      ...raw,
      columnId,
      parentId: null,
      assigneeIds: [],
      labelIds: [],
    });
    const errors = validateTaskInput(input);
    const [field] = Object.keys(errors);
    if (field) throw badRequest(`${where}: ${errors[field]}`, field);

    const archived = raw.archived === true;
    const isDone = columns.find((c) => columnIds.get(c.name) === columnId).isDone;
    const position = archived ? 0 : (positions.get(columnId) ?? 0);
    if (!archived) positions.set(columnId, position + 1);
    const completedAt =
      isDone && typeof raw.completedAt === 'string' && !isNaN(Date.parse(raw.completedAt))
        ? new Date(raw.completedAt).toISOString().slice(0, 19).replace('T', ' ')
        : isDone
          ? new Date().toISOString().slice(0, 19).replace('T', ' ')
          : null;

    const info = insertTask.run(
      boardId,
      columnId,
      input.title,
      input.description,
      input.date,
      input.startTime,
      input.endTime,
      input.color,
      input.priority,
      position,
      input.estimateMin,
      input.spentMin,
      input.recurrence,
      completedAt,
      archived ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
      userId(raw.createdBy) ?? user.id,
    );
    const id = Number(info.lastInsertRowid);
    if (raw.ref != null) created.set(raw.ref, id);
    if (raw.parentRef != null) parents.push([id, raw.parentRef]);

    for (const a of Array.isArray(raw.assignees)
      ? raw.assignees.slice(0, LIMITS.assigneesMax)
      : []) {
      const uid = userId(a);
      if (uid) db.prepare('INSERT OR IGNORE INTO task_assignees VALUES (?, ?)').run(id, uid);
    }
    for (const l of Array.isArray(raw.labels) ? raw.labels : []) {
      const lid = labelIds.get(text(l).toLowerCase());
      if (lid) db.prepare('INSERT OR IGNORE INTO task_labels VALUES (?, ?)').run(id, lid);
    }
    (Array.isArray(raw.checklist) ? raw.checklist.slice(0, 100) : []).forEach((k, i) => {
      const itemText = text(k?.text).trim().slice(0, LIMITS.checklistTextMax);
      if (itemText) {
        db.prepare(
          'INSERT INTO checklist_items (task_id, text, done, position) VALUES (?, ?, ?, ?)',
        ).run(id, itemText, k.done === true ? 1 : 0, i);
      }
    });
    for (const c of Array.isArray(raw.comments) ? raw.comments.slice(0, 500) : []) {
      const body = text(c?.text).trim();
      if (!body) continue;
      const authorId = userId(c.author);
      // se l'autore non c'è qui, il nome resta almeno nel testo
      const final = authorId ? body : `[${text(c.author) || 'ignoto'}] ${body}`;
      db.prepare('INSERT INTO comments (task_id, author_id, text) VALUES (?, ?, ?)').run(
        id,
        authorId ?? user.id,
        final.slice(0, LIMITS.commentMax),
      );
    }
    for (const l of Array.isArray(raw.links) ? raw.links.slice(0, 30) : []) {
      try {
        const url = new URL(text(l?.url));
        if (!['http:', 'https:'].includes(url.protocol)) continue;
        db.prepare(
          `INSERT INTO attachments (task_id, kind, name, url, uploaded_by)
           VALUES (?, 'link', ?, ?, ?)`,
        ).run(
          id,
          (text(l.name) || url.hostname).slice(0, LIMITS.attachmentNameMax),
          url.href,
          user.id,
        );
      } catch {
        // link non valido: lo salta
      }
    }
  });

  // i genitori si collegano alla fine, quando tutte le attività esistono; un file manomesso
  // potrebbe descrivere un ciclo, che qui viene scartato
  const parentOf = new Map();
  const reachesSelf = (id, parentId) => {
    for (let cur = parentId, hops = 0; cur != null && hops <= created.size; hops++) {
      if (cur === id) return true;
      cur = parentOf.get(cur);
    }
    return false;
  };
  for (const [id, ref] of parents) {
    const parentId = created.get(ref);
    if (parentId && !reachesSelf(id, parentId)) {
      parentOf.set(id, parentId);
      db.prepare('UPDATE tasks SET parent_id = ? WHERE id = ?').run(parentId, id);
    }
  }
  recordEvent(boardId, null, user.id, 'board.imported', { name, count: data.tasks.length });
  return boardId;
});

router.post('/import', express.json({ limit: '5mb' }), (req, res) => {
  res.status(201).json(getBoardById(importBoard(req.body, req.user)));
});

export default router;
