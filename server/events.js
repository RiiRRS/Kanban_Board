// Cronologia delle attività: chi ha fatto cosa e quando

import { db, toIso } from './db.js';

export function recordEvent(boardId, taskId, actorId, type, data = {}) {
  db.prepare(
    'INSERT INTO events (board_id, task_id, actor_id, type, data) VALUES (?, ?, ?, ?, ?)',
  ).run(boardId, taskId, actorId, type, JSON.stringify(data));
}

const rowToEvent = (r) => ({
  id: r.id,
  boardId: r.board_id,
  taskId: r.task_id,
  type: r.type,
  data: JSON.parse(r.data),
  actor: r.actor_id ? { id: r.actor_id, username: r.actor_username } : null,
  createdAt: toIso(r.created_at),
});

// più recenti per primi; `before` è l'id dell'ultimo evento già ricevuto (paginazione)
export function listEvents({ boardId = null, taskId = null, limit = 50, before = null }) {
  const where = [];
  const params = [];
  if (boardId != null) {
    where.push('e.board_id = ?');
    params.push(boardId);
  }
  if (taskId != null) {
    where.push('e.task_id = ?');
    params.push(taskId);
  }
  if (before != null) {
    where.push('e.id < ?');
    params.push(before);
  }
  const rows = db
    .prepare(
      `SELECT e.*, u.username AS actor_username
       FROM events e LEFT JOIN users u ON u.id = e.actor_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY e.id DESC LIMIT ?`,
    )
    .all(...params, Math.min(Math.max(limit, 1), 200));
  return rows.map(rowToEvent);
}
