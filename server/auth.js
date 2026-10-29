// Registrazione, login, logout e controllo della sessione (cookie HttpOnly)

import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db, rowToUser } from './db.js';
import { HttpError, badRequest, conflict, unauthorized } from './errors.js';
import { validateUsername, validatePassword, isValidColor } from '../public/js/validation.js';
import { LIMITS } from '../public/js/constants.js';
import { config } from './config.js';
import { rateLimit } from './security.js';

const COOKIE = 'kanban_session';
const SESSION_DAYS = config.sessionDays;
const BAD_LOGIN = 'Username o password non validi';
const router = express.Router();

// hash finto: se lo username non esiste confrontiamo comunque, così i tempi non lo rivelano
const DUMMY_HASH = bcrypt.hashSync('password-inesistente', 10);

// nel DB finisce solo l'hash del token: una copia del file non permette di entrare
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: config.authRateMax,
  skipSuccessful: true,
});

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES (?, ?, datetime('now', '+' || ? || ' days'))`,
  ).run(hashToken(token), userId, SESSION_DAYS);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    secure: config.secureCookies,
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
    .get(hashToken(token));
  if (!row) throw unauthorized();
  req.user = rowToUser(row);
  req.sessionHash = hashToken(token);
  next();
}

const insertUser = db.transaction((username, hash) => {
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw conflict('Username già in uso', 'username');
  }
  const isFirst = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get() != null;
  const isAdminName =
    config.adminUsername != null && username.toLowerCase() === config.adminUsername.toLowerCase();
  // a registrazioni chiuse resta aperta solo la creazione dell'admin: il primo utente, oppure
  // (se ADMIN_USERNAME è impostato) chi si registra con quel nome finché non c'è un admin
  if (!config.registrationOpen) {
    const allowed = config.adminUsername ? isAdminName && !hasAdmin : isFirst;
    if (!allowed) throw new HttpError(403, 'Le registrazioni sono chiuse');
  }
  const isAdmin = config.adminUsername ? isAdminName : isFirst;
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hash, isAdmin ? 'admin' : 'member');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
});

router.post('/register', authLimiter, async (req, res) => {
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

router.post('/login', authLimiter, async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!username || !password) throw badRequest(BAD_LOGIN);

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // stesso messaggio se lo username non esiste o la password è sbagliata
  const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) {
    const err = unauthorized();
    err.message = BAD_LOGIN;
    throw err;
  }
  createSession(res, row.id);
  res.json(rowToUser(row));
});

router.post('/logout', (req, res) => {
  const token = req.cookies[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(hashToken(token));
  res.clearCookie(COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
  });
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// profilo: nome visualizzato e colore dell'avatar (lo username non cambia: serve per le menzioni)
router.patch('/me', requireAuth, (req, res) => {
  const body = req.body ?? {};
  let displayName = req.user.displayName;
  let avatarColor = req.user.avatarColor;
  if (body.displayName !== undefined) {
    displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    if (displayName.length > LIMITS.displayNameMax) {
      throw badRequest(
        `Il nome può avere al massimo ${LIMITS.displayNameMax} caratteri`,
        'displayName',
      );
    }
  }
  if (body.avatarColor !== undefined) {
    if (!isValidColor(body.avatarColor)) throw badRequest('Colore non valido', 'avatarColor');
    avatarColor = body.avatarColor;
  }
  db.prepare('UPDATE users SET display_name = ?, avatar_color = ? WHERE id = ?').run(
    displayName,
    avatarColor,
    req.user.id,
  );
  res.json(rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
});

// cambio password: richiede quella attuale e chiude tutte le altre sessioni
router.post('/me/password', requireAuth, authLimiter, async (req, res) => {
  const current = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const next = req.body?.newPassword;
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await bcrypt.compare(current, row.password_hash))) {
    throw badRequest('La password attuale non è corretta', 'currentPassword');
  }
  const error = validatePassword(next);
  if (error) throw badRequest(error, 'newPassword');
  const hash = await bcrypt.hash(next, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(
    req.user.id,
    hashToken(req.cookies[COOKIE]),
  );
  res.status(204).end();
});

// sessioni scadute: all'avvio e poi ogni ora
const purgeSessions = () =>
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
purgeSessions();
setInterval(purgeSessions, 3600_000).unref();

export default router;
