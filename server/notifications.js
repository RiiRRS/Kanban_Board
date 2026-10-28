// Notifiche in-app: assegnazioni, menzioni, commenti e scadenze del giorno

import express from 'express';
import { db, toIso } from './db.js';
import { badRequest } from './errors.js';

const router = express.Router();

// niente notifica a chi ha fatto l'azione; `dedupe` evita doppioni (es. una scadenza al giorno)
export function notify(userId, actorId, type, taskId, text, dedupe = null) {
  if (userId === actorId) return;
  db.prepare(
    `INSERT OR IGNORE INTO notifications (user_id, actor_id, type, task_id, text, dedupe)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(userId, actorId, type, taskId, text, dedupe);
}

const pad = (n) => String(n).padStart(2, '0');
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// le scadenze non nascono da un'azione di qualcuno: si creano quando l'utente guarda le notifiche
function ensureDueNotifications(userId) {
  const today = localToday();
  const due = db
    .prepare(
      `SELECT t.id, t.title FROM tasks t
       JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = ?
       JOIN columns c ON c.id = t.column_id
       WHERE t.date = ? AND c.is_done = 0 AND t.archived_at IS NULL`,
    )
    .all(userId, today);
  for (const t of due) {
    notify(userId, null, 'due', t.id, `"${t.title}" scade oggi`, `due:${t.id}:${today}`);
  }
}

const rowToNotification = (r) => ({
  id: r.id,
  type: r.type,
  taskId: r.task_id,
  text: r.text,
  actor: r.actor_id ? { id: r.actor_id, username: r.actor_username } : null,
  read: r.read_at != null,
  createdAt: toIso(r.created_at),
});

router.get('/', (req, res) => {
  ensureDueNotifications(req.user.id);
  const rows = db
    .prepare(
      `SELECT n.*, u.username AS actor_username
       FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
       WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 50`,
    )
    .all(req.user.id);
  const { unread } = db
    .prepare('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .get(req.user.id);
  res.json({ items: rows.map(rowToNotification), unread });
});

// { all: true } segna tutto come letto, { ids: [...] } solo quelle indicate
router.post('/read', (req, res) => {
  const { all, ids } = req.body ?? {};
  if (all === true) {
    db.prepare(
      "UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL",
    ).run(req.user.id);
  } else if (Array.isArray(ids) && ids.every(Number.isInteger)) {
    db.prepare(
      `UPDATE notifications SET read_at = datetime('now')
       WHERE user_id = ? AND read_at IS NULL AND id IN (SELECT value FROM json_each(?))`,
    ).run(req.user.id, JSON.stringify(ids));
  } else {
    throw badRequest('Indica all oppure ids');
  }
  res.status(204).end();
});

export default router;
