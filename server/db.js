// Database SQLite: schema, conversione righe -> oggetti JSON, query comuni

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dbPath = process.env.DB_PATH || path.join(root, 'data', 'kanban.db');
if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Migrazioni: l'elenco cresce solo in fondo. La versione applicata è in PRAGMA user_version.
const MIGRATIONS = [
  // 1 · schema iniziale (IF NOT EXISTS: i database creati prima delle migrazioni restano validi)
  `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
    status      TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','review','done')),
    date        TEXT NOT NULL,
    start_time  TEXT NOT NULL,
    end_time    TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#4f8cff',
    priority    TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
    parent_id   INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (end_time > start_time),
    UNIQUE (date, start_time)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY,
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author_id  INTEGER NOT NULL REFERENCES users(id),
    text       TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_status_position ON tasks(status, position);
  CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
  CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`,
  // 2 · i token di sessione ora sono salvati come hash: le sessioni vecchie non servono più
  'DELETE FROM sessions',
  // 3 · board e colonne personalizzabili. Lo stato fisso diventa una colonna della board
  // "Board principale"; cade anche il vincolo di unicità su data e ora di inizio (i conflitti
  // diventano avvisi). Per cambiare i vincoli la tabella va ricostruita.
  `
  CREATE TABLE boards (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE columns (
    id        INTEGER PRIMARY KEY,
    board_id  INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name      TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 30),
    position  INTEGER NOT NULL,
    wip_limit INTEGER CHECK (wip_limit IS NULL OR wip_limit BETWEEN 1 AND 999),
    is_done   INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0,1))
  );
  CREATE INDEX idx_columns_board ON columns(board_id, position);

  INSERT INTO boards (id, name) VALUES (1, 'Board principale');
  INSERT INTO columns (board_id, name, position, is_done) VALUES
    (1, 'Da fare', 0, 0), (1, 'In corso', 1, 0), (1, 'In revisione', 2, 0), (1, 'Fatto', 3, 1);

  CREATE TABLE tasks_new (
    id                 INTEGER PRIMARY KEY,
    board_id           INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    column_id          INTEGER NOT NULL REFERENCES columns(id),
    title              TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
    description        TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
    date               TEXT NOT NULL,
    start_time         TEXT NOT NULL,
    end_time           TEXT NOT NULL,
    color              TEXT NOT NULL DEFAULT '#4f8cff',
    priority           TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
    parent_id          INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    position           INTEGER NOT NULL DEFAULT 0,
    estimate_min       INTEGER CHECK (estimate_min IS NULL OR estimate_min BETWEEN 0 AND 99999),
    spent_min          INTEGER NOT NULL DEFAULT 0 CHECK (spent_min BETWEEN 0 AND 99999),
    recurrence         TEXT NOT NULL DEFAULT 'none'
                         CHECK (recurrence IN ('none','daily','weekly','monthly')),
    recurrence_spawned INTEGER NOT NULL DEFAULT 0,
    completed_at       TEXT,
    archived_at        TEXT,
    created_by         INTEGER NOT NULL REFERENCES users(id),
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (end_time > start_time)
  );
  INSERT INTO tasks_new (id, board_id, column_id, title, description, date, start_time, end_time,
                         color, priority, parent_id, position, completed_at,
                         created_by, created_at, updated_at)
    SELECT t.id, 1,
           (SELECT c.id FROM columns c WHERE c.board_id = 1 AND c.position =
              CASE t.status WHEN 'todo' THEN 0 WHEN 'doing' THEN 1 WHEN 'review' THEN 2 ELSE 3 END),
           t.title, t.description, t.date, t.start_time, t.end_time, t.color, t.priority,
           t.parent_id, t.position, CASE WHEN t.status = 'done' THEN t.updated_at END,
           t.created_by, t.created_at, t.updated_at
    FROM tasks t;
  DROP TABLE tasks;
  ALTER TABLE tasks_new RENAME TO tasks;
  CREATE INDEX idx_tasks_column_position ON tasks(column_id, position);
  CREATE INDEX idx_tasks_board ON tasks(board_id);
  CREATE INDEX idx_tasks_parent ON tasks(parent_id);
  CREATE INDEX idx_tasks_date ON tasks(date);
`,
  // 4 · collaborazione: assegnatari, etichette, checklist, cronologia, notifiche, allegati
  `
  CREATE TABLE task_assignees (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, user_id)
  );
  CREATE INDEX idx_assignees_user ON task_assignees(user_id);
  CREATE TABLE labels (
    id       INTEGER PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name     TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 30),
    color    TEXT NOT NULL DEFAULT '#4f8cff',
    UNIQUE (board_id, name)
  );
  CREATE TABLE task_labels (
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
  );
  CREATE TABLE checklist_items (
    id       INTEGER PRIMARY KEY,
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    text     TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 200),
    done     INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_checklist_task ON checklist_items(task_id, position);
  CREATE TABLE events (
    id         INTEGER PRIMARY KEY,
    board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    task_id    INTEGER,
    actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type       TEXT NOT NULL,
    data       TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_events_board ON events(board_id, id DESC);
  CREATE INDEX idx_events_task ON events(task_id, id DESC);
  CREATE TABLE notifications (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type       TEXT NOT NULL,
    task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    dedupe     TEXT,
    read_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, dedupe)
  );
  CREATE INDEX idx_notifications_user ON notifications(user_id, id DESC);
  CREATE TABLE attachments (
    id          INTEGER PRIMARY KEY,
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('link','file')),
    name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    url         TEXT,
    stored_name TEXT,
    mime        TEXT,
    size        INTEGER,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_attachments_task ON attachments(task_id);
`,
  // 5 · profilo utente e commenti modificabili
  `
  ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN avatar_color TEXT NOT NULL DEFAULT '#4f8cff';
  ALTER TABLE comments ADD COLUMN edited_at TEXT;
`,
];

// Con le foreign key attive, DROP TABLE tasks cancellerebbe a cascata commenti e simili:
// durante la migrazione restano spente (il pragma non si può cambiare dentro una transazione)
db.pragma('foreign_keys = OFF');
const migrate = db.transaction(() => {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec(MIGRATIONS[v]);
    db.pragma(`user_version = ${v + 1}`);
  }
  const broken = db.pragma('foreign_key_check');
  if (broken.length > 0) throw new Error('Migrazione non valida: foreign key violate');
});
migrate();
db.pragma('foreign_keys = ON');

export const SCHEMA_VERSION = MIGRATIONS.length;

// SQLite salva 'YYYY-MM-DD HH:MM:SS' (UTC): lo trasformiamo in ISO con Z
export const toIso = (s) => (s ? s.replace(' ', 'T') + 'Z' : null);

export const rowToUser = (r) => ({
  id: r.id,
  username: r.username,
  role: r.role,
  displayName: r.display_name ?? '',
  avatarColor: r.avatar_color ?? '#4f8cff',
});

// versione per gli altri utenti: niente ruolo di sistema superfluo, ma serve per i permessi in UI
export const publicUser = (r) => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name ?? '',
  avatarColor: r.avatar_color ?? '#4f8cff',
});

export const rowToColumn = (r) => ({
  id: r.id,
  boardId: r.board_id,
  name: r.name,
  position: r.position,
  wipLimit: r.wip_limit,
  isDone: r.is_done === 1,
});

export const rowToLabel = (r) => ({ id: r.id, boardId: r.board_id, name: r.name, color: r.color });

export const rowToComment = (r) => ({
  id: r.id,
  taskId: r.task_id,
  author: { id: r.author_id, username: r.author_username },
  text: r.text,
  createdAt: toIso(r.created_at),
  editedAt: toIso(r.edited_at),
});

export const rowToAttachment = (r) => ({
  id: r.id,
  taskId: r.task_id,
  kind: r.kind,
  name: r.name,
  url: r.kind === 'link' ? r.url : `/api/attachments/${r.id}/download`,
  mime: r.mime,
  size: r.size,
  uploadedBy: r.uploaded_by,
  createdAt: toIso(r.created_at),
});

export const rowToChecklistItem = (r) => ({
  id: r.id,
  taskId: r.task_id,
  text: r.text,
  done: r.done === 1,
  position: r.position,
});

export const TASK_SELECT = `
  SELECT t.*, u.username AS created_by_username, col.is_done,
    (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) AS comment_count,
    (SELECT COUNT(*) FROM tasks ch WHERE ch.parent_id = t.id) AS child_count,
    (SELECT COUNT(*) FROM tasks ch JOIN columns cc ON cc.id = ch.column_id
       WHERE ch.parent_id = t.id AND cc.is_done = 1) AS child_done_count,
    (SELECT COUNT(*) FROM checklist_items k WHERE k.task_id = t.id) AS checklist_total,
    (SELECT COUNT(*) FROM checklist_items k WHERE k.task_id = t.id AND k.done = 1)
      AS checklist_done,
    (SELECT COUNT(*) FROM attachments a WHERE a.task_id = t.id) AS attachment_count
  FROM tasks t
  JOIN users u ON u.id = t.created_by
  JOIN columns col ON col.id = t.column_id`;

export const rowToTask = (r) => ({
  id: r.id,
  boardId: r.board_id,
  columnId: r.column_id,
  title: r.title,
  description: r.description,
  isDone: r.is_done === 1,
  date: r.date,
  startTime: r.start_time,
  endTime: r.end_time,
  color: r.color,
  priority: r.priority,
  parentId: r.parent_id,
  position: r.position,
  estimateMin: r.estimate_min,
  spentMin: r.spent_min,
  recurrence: r.recurrence,
  completedAt: toIso(r.completed_at),
  archivedAt: toIso(r.archived_at),
  createdBy: { id: r.created_by, username: r.created_by_username },
  createdAt: toIso(r.created_at),
  updatedAt: toIso(r.updated_at),
  commentCount: r.comment_count ?? 0,
  childCount: r.child_count ?? 0,
  childDoneCount: r.child_done_count ?? 0,
  checklistTotal: r.checklist_total ?? 0,
  checklistDone: r.checklist_done ?? 0,
  attachmentCount: r.attachment_count ?? 0,
  assignees: [],
  labels: [],
});

// aggiunge assegnatari ed etichette (due query per tutte le attività, non una per attività)
function attachRelations(tasks) {
  if (tasks.length === 0) return tasks;
  const ids = JSON.stringify(tasks.map((t) => t.id));
  const byTask = new Map(tasks.map((t) => [t.id, t]));
  const assignees = db
    .prepare(
      `SELECT ta.task_id, u.id, u.username, u.display_name, u.avatar_color
       FROM task_assignees ta JOIN users u ON u.id = ta.user_id
       WHERE ta.task_id IN (SELECT value FROM json_each(?)) ORDER BY u.username`,
    )
    .all(ids);
  for (const a of assignees) byTask.get(a.task_id).assignees.push(publicUser(a));
  const labels = db
    .prepare(
      `SELECT tl.task_id, l.id, l.board_id, l.name, l.color
       FROM task_labels tl JOIN labels l ON l.id = tl.label_id
       WHERE tl.task_id IN (SELECT value FROM json_each(?)) ORDER BY l.name`,
    )
    .all(ids);
  for (const l of labels) byTask.get(l.task_id).labels.push(rowToLabel(l));
  return tasks;
}

export function getTaskById(id) {
  const row = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id);
  return row ? attachRelations([rowToTask(row)])[0] : null;
}

export function listBoardTasks(boardId, { archived = false } = {}) {
  const rows = db
    .prepare(
      `${TASK_SELECT} WHERE t.board_id = ? AND t.archived_at IS ${archived ? 'NOT' : ''} NULL
       ORDER BY t.column_id, t.position, t.id`,
    )
    .all(boardId);
  return attachRelations(rows.map(rowToTask));
}

export function getBoardById(id) {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
  if (!board) return null;
  return {
    id: board.id,
    name: board.name,
    createdBy: board.created_by,
    createdAt: toIso(board.created_at),
    columns: db
      .prepare('SELECT * FROM columns WHERE board_id = ? ORDER BY position, id')
      .all(id)
      .map(rowToColumn),
    labels: db
      .prepare('SELECT * FROM labels WHERE board_id = ? ORDER BY name')
      .all(id)
      .map(rowToLabel),
  };
}
