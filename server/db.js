// Database SQLite: schema, conversione righe -> oggetti JSON, query comuni

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dbPath = process.env.DB_PATH || path.join(root, 'data', 'kanban.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
`);

// SQLite salva 'YYYY-MM-DD HH:MM:SS' (UTC): lo trasformiamo in ISO con Z
export const toIso = (s) => (s ? s.replace(' ', 'T') + 'Z' : null);

export const rowToUser = (r) => ({ id: r.id, username: r.username, role: r.role });

export const rowToTask = (r) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  status: r.status,
  date: r.date,
  startTime: r.start_time,
  endTime: r.end_time,
  color: r.color,
  priority: r.priority,
  parentId: r.parent_id,
  position: r.position,
  createdBy: { id: r.created_by, username: r.created_by_username },
  createdAt: toIso(r.created_at),
  updatedAt: toIso(r.updated_at),
  commentCount: r.comment_count ?? 0,
  childCount: r.child_count ?? 0,
});

export const rowToComment = (r) => ({
  id: r.id,
  taskId: r.task_id,
  author: { id: r.author_id, username: r.author_username },
  text: r.text,
  createdAt: toIso(r.created_at),
});

export const TASK_SELECT = `
  SELECT t.*, u.username AS created_by_username,
    (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) AS comment_count,
    (SELECT COUNT(*) FROM tasks ch WHERE ch.parent_id = t.id) AS child_count
  FROM tasks t JOIN users u ON u.id = t.created_by`;

export function getTaskById(id) {
  const row = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id);
  return row ? rowToTask(row) : null;
}
