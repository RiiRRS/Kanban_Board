// API dei commenti di un'attività (montata su /api/tasks/:taskId/comments)

import express from 'express';
import { db, getTaskById, rowToComment } from './db.js';
import { badRequest, notFound } from './errors.js';
import { validateCommentText } from '../public/js/validation.js';

const router = express.Router({ mergeParams: true });

const COMMENT_SELECT = `
  SELECT c.*, u.username AS author_username
  FROM comments c JOIN users u ON u.id = c.author_id`;

function parseTaskId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || !getTaskById(id)) throw notFound();
  return id;
}

router.get('/', (req, res) => {
  const taskId = parseTaskId(req.params.taskId);
  const rows = db.prepare(`${COMMENT_SELECT} WHERE c.task_id = ? ORDER BY c.id`).all(taskId);
  res.json(rows.map(rowToComment));
});

const addComment = db.transaction((taskId, authorId, text) => {
  const info = db
    .prepare('INSERT INTO comments (task_id, author_id, text) VALUES (?, ?, ?)')
    .run(taskId, authorId, text);
  db.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").run(taskId);
  return db.prepare(`${COMMENT_SELECT} WHERE c.id = ?`).get(info.lastInsertRowid);
});

router.post('/', (req, res) => {
  const taskId = parseTaskId(req.params.taskId);
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const error = validateCommentText(text);
  if (error) throw badRequest(error, 'text');
  res.status(201).json(rowToComment(addComment(taskId, req.user.id, text)));
});

export default router;
