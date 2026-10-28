// API dei commenti di un'attività (montata su /api/tasks/:taskId/comments)

import express from 'express';
import { db, getTaskById, rowToComment } from './db.js';
import { badRequest, forbidden, notFound } from './errors.js';
import { validateCommentText } from '../public/js/validation.js';
import { displayName } from './access.js';
import { recordEvent } from './events.js';
import { notify } from './notifications.js';

const router = express.Router({ mergeParams: true });

const COMMENT_SELECT = `
  SELECT c.*, u.username AS author_username
  FROM comments c JOIN users u ON u.id = c.author_id`;

function parseTaskId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || !getTaskById(id)) throw notFound();
  return id;
}

function loadComment(taskId, value) {
  const id = Number(value);
  const row =
    Number.isInteger(id) && id > 0
      ? db.prepare(`${COMMENT_SELECT} WHERE c.id = ? AND c.task_id = ?`).get(id, taskId)
      : null;
  if (!row) throw notFound('Commento non trovato');
  return row;
}

// utenti citati con @username (ignora maiuscole; una mail come a@b.it non conta)
const MENTION_RE = /(?<![\w@])@([A-Za-z0-9_]{3,30})/g;

export function findMentions(text) {
  const names = [...new Set([...text.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase()))];
  if (names.length === 0) return [];
  return db
    .prepare(
      `SELECT id, username FROM users
       WHERE lower(username) IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(names));
}

router.get('/', (req, res) => {
  const taskId = parseTaskId(req.params.taskId);
  const rows = db.prepare(`${COMMENT_SELECT} WHERE c.task_id = ? ORDER BY c.id`).all(taskId);
  res.json(rows.map(rowToComment));
});

const addComment = db.transaction((taskId, user, text) => {
  const info = db
    .prepare('INSERT INTO comments (task_id, author_id, text) VALUES (?, ?, ?)')
    .run(taskId, user.id, text);
  db.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").run(taskId);

  const task = getTaskById(taskId);
  recordEvent(task.boardId, taskId, user.id, 'comment.added', { title: task.title });

  // chi è citato riceve "menzione"; l'autore e gli assegnati dell'attività ricevono "commento"
  // (una persona sola riceve una sola notifica)
  const mentioned = findMentions(text).map((u) => u.id);
  for (const userId of mentioned) {
    notify(
      userId,
      user.id,
      'mention',
      taskId,
      `${displayName(user)} ti ha menzionato in "${task.title}"`,
    );
  }
  const followers = new Set([task.createdBy.id, ...task.assignees.map((a) => a.id)]);
  for (const userId of followers) {
    if (mentioned.includes(userId)) continue;
    notify(
      userId,
      user.id,
      'comment',
      taskId,
      `${displayName(user)} ha commentato "${task.title}"`,
    );
  }
  return db.prepare(`${COMMENT_SELECT} WHERE c.id = ?`).get(info.lastInsertRowid);
});

function readText(body) {
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const error = validateCommentText(text);
  if (error) throw badRequest(error, 'text');
  return text;
}

router.post('/', (req, res) => {
  const taskId = parseTaskId(req.params.taskId);
  const text = readText(req.body);
  res.status(201).json(rowToComment(addComment(taskId, req.user, text)));
});

// modifica: solo l'autore (nemmeno l'admin può mettere parole in bocca agli altri)
router.put('/:commentId', (req, res) => {
  const taskId = parseTaskId(req.params.taskId);
  const comment = loadComment(taskId, req.params.commentId);
  if (comment.author_id !== req.user.id) throw forbidden();
  const text = readText(req.body);
  db.prepare("UPDATE comments SET text = ?, edited_at = datetime('now') WHERE id = ?").run(
    text,
    comment.id,
  );
  res.json(rowToComment(db.prepare(`${COMMENT_SELECT} WHERE c.id = ?`).get(comment.id)));
});

// eliminazione: l'autore, oppure un admin che modera
router.delete('/:commentId', (req, res) => {
  const taskId = parseTaskId(req.params.taskId);
  const comment = loadComment(taskId, req.params.commentId);
  if (comment.author_id !== req.user.id && req.user.role !== 'admin') throw forbidden();
  db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
  res.status(204).end();
});

export default router;
