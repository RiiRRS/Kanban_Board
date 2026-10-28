// Header di sicurezza, protezione CSRF e limite di richieste

import { HttpError } from './errors.js';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  next();
}

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'kanban';

// Un form di un altro sito non può impostare header personalizzati: basta richiederlo
// alle richieste che modificano dati.
export function csrfGuard(req, res, next) {
  const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  if (!safe && req.get(CSRF_HEADER) !== CSRF_VALUE) {
    return next(new HttpError(403, 'Richiesta non valida'));
  }
  next();
}

// Limite in memoria per IP: max richieste ogni windowMs. Basta per un'istanza sola.
export function rateLimit({ windowMs, max, message = 'Troppi tentativi, riprova tra poco' }) {
  const hits = new Map(); // ip -> { count, resetAt }
  setInterval(() => {
    const now = Date.now();
    for (const [ip, h] of hits) if (h.resetAt <= now) hits.delete(ip);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    let h = hits.get(req.ip);
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + windowMs };
      hits.set(req.ip, h);
    }
    h.count += 1;
    if (h.count > max) {
      res.set('Retry-After', String(Math.ceil((h.resetAt - now) / 1000)));
      return next(new HttpError(429, message));
    }
    next();
  };
}
