// Registrazione, login, logout e controllo della sessione (cookie HttpOnly)

import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db, rowToUser } from './db.js';
import { badRequest, conflict, unauthorized } from './errors.js';
import { validateUsername, validatePassword } from '../public/js/validation.js';

const COOKIE = 'kanban_session';
const SESSION_DAYS = 7;
const BAD_LOGIN = 'Username o password non validi';
const router = express.Router();

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  // SESSION_DAYS è una costante nostra, non un dato dell'utente: qui la template string è sicura
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`,
  ).run(token, userId);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    // secure: true solo in HTTPS (non in locale)
  });
}

export function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) throw unauthorized();
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token);
  if (!row) throw unauthorized();
  req.user = rowToUser(row);
  next();
}

const insertUser = db.transaction((username, hash) => {
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw conflict('Username già in uso', 'username');
  }
  const isFirst = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hash, isFirst ? 'admin' : 'member');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
});

router.post('/register', async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = req.body?.password;

  const usernameError = validateUsername(username);
  if (usernameError) throw badRequest(usernameError, 'username');
  const passwordError = validatePassword(password);
  if (passwordError) throw badRequest(passwordError, 'password');

  // asincrono, quindi fuori dalla transazione
  const hash = await bcrypt.hash(password, 10);
  const user = rowToUser(insertUser(username, hash));
  createSession(res, user.id);
  res.status(201).json(user);
});

router.post('/login', async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!username || !password) throw badRequest(BAD_LOGIN);

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // stesso messaggio se lo username non esiste o la password è sbagliata
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    const err = unauthorized();
    err.message = BAD_LOGIN;
    throw err;
  }
  createSession(res, row.id);
  res.json(rowToUser(row));
});

router.post('/logout', (req, res) => {
  const token = req.cookies[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE, { path: '/' });
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// sessioni scadute: all'avvio e poi ogni ora
const purgeSessions = () =>
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
purgeSessions();
setInterval(purgeSessions, 3600_000).unref();

export default router;
