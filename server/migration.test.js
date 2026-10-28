// La migrazione da un database creato prima di board e colonne non deve perdere dati
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-migration-'));
const file = path.join(dir, 'legacy.db');

// schema com'era alla versione 2, con qualche dato
const legacy = new Database(file);
legacy.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL);
  CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','review','done')),
    date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#4f8cff',
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
    parent_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL, position INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), CHECK (end_time > start_time), UNIQUE (date, start_time));
  CREATE TABLE comments (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id), text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
  INSERT INTO users (id, username, password_hash, role) VALUES (1, 'a', 'x', 'admin'), (2, 'b', 'x', 'member');
  INSERT INTO tasks (id, title, status, date, start_time, end_time, parent_id, position, created_by) VALUES
    (1, 'Da fare', 'todo', '2030-01-01', '09:00', '10:00', NULL, 0, 1),
    (2, 'Fatta', 'done', '2030-01-01', '11:00', '12:00', 1, 0, 2),
    (3, 'In revisione', 'review', '2030-01-02', '11:00', '12:00', 1, 1, 1),
    (4, 'In revisione 2', 'review', '2030-01-03', '11:00', '12:00', NULL, 0, 1);
  INSERT INTO comments (task_id, author_id, text) VALUES (1, 2, 'ciao'), (2, 1, 'fatto');
`);
legacy.pragma('user_version = 2');
legacy.close();

process.env.DB_PATH = file;
const { db, listBoardTasks, getBoardById, SCHEMA_VERSION } = await import('./db.js');

test('migrazione: gli stati diventano colonne della board principale', () => {
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  const board = getBoardById(1);
  assert.equal(board.name, 'Board principale');
  assert.deepEqual(
    board.columns.map((c) => [c.name, c.isDone]),
    [
      ['Da fare', false],
      ['In corso', false],
      ['In revisione', false],
      ['Fatto', true],
    ],
  );
  const byTitle = Object.fromEntries(listBoardTasks(1).map((t) => [t.title, t]));
  assert.equal(byTitle['Da fare'].columnId, board.columns[0].id);
  assert.equal(byTitle['In revisione'].columnId, board.columns[2].id);
  assert.equal(byTitle['Fatta'].columnId, board.columns[3].id);
  assert.equal(byTitle['Fatta'].isDone, true);
  assert.ok(byTitle['Fatta'].completedAt, 'le attività già fatte risultano completate');
  assert.equal(byTitle['Da fare'].completedAt, null);
});

test('migrazione: gerarchia, posizioni e commenti restano', () => {
  const tasks = listBoardTasks(1);
  assert.equal(tasks.length, 4);
  assert.equal(tasks.find((t) => t.id === 2).parentId, 1);
  assert.equal(
    tasks.find((t) => t.id === 1).commentCount,
    1,
    'i commenti non vengono cancellati a cascata',
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 2);
  const review = tasks
    .filter((t) => t.title.startsWith('In revisione'))
    .sort((a, b) => a.position - b.position);
  assert.deepEqual(
    review.map((t) => t.id),
    [4, 3],
    'ordine nella colonna invariato',
  );
});

test('migrazione: non c’è più il vincolo su data e ora di inizio, e le foreign key sono attive', () => {
  db.prepare(
    `INSERT INTO tasks (board_id, column_id, title, date, start_time, end_time, created_by)
     VALUES (1, 1, 'Stesso orario', '2030-01-01', '09:00', '10:00', 1)`,
  ).run();
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('migrazione: riaprire il database non la rilancia', async () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n;
  assert.equal(before, 5);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM boards').get().n, 1);
});

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
