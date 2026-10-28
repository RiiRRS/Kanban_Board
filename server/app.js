// Costruzione dell'app Express (senza ascoltare su una porta: così i test possono usarla)

import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { errorHandler, notFound } from './errors.js';
import { securityHeaders, csrfGuard } from './security.js';
import { db } from './db.js';
import authRouter, { requireAuth } from './auth.js';
import boardsRouter from './boards.js';
import tasksRouter from './tasks.js';
import commentsRouter from './comments.js';
import notificationsRouter from './notifications.js';
import usersRouter from './users.js';
import { taskAttachments, attachments } from './attachments.js';
import { openStream, broadcast } from './realtime.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const AUTH_PATHS = new Set(['/login', '/register', '/logout']);

export function createApp() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  // l'import di una board è l'unico JSON grande: ha il suo limite, prima di quello generale
  app.use('/api/boards/import', express.json({ limit: '5mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/health', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });

  app.use('/api', csrfGuard);

  // dopo ogni modifica riuscita avvisa i client collegati, che ricaricano i dati
  app.use('/api', (req, res, next) => {
    if (!SAFE_METHODS.has(req.method) && !AUTH_PATHS.has(req.path)) {
      res.on('finish', () => {
        if (res.statusCode < 400) broadcast({ type: 'change' });
      });
    }
    next();
  });

  app.use('/api', authRouter);
  app.get('/api/stream', requireAuth, openStream);
  app.use('/api/users', requireAuth, usersRouter);
  app.use('/api/notifications', requireAuth, notificationsRouter);
  app.use('/api/boards', requireAuth, boardsRouter);
  app.use('/api/attachments', requireAuth, attachments);
  // più specifici prima: /api/tasks/:taskId/... deve precedere /api/tasks
  app.use('/api/tasks/:taskId/comments', requireAuth, commentsRouter);
  app.use('/api/tasks/:taskId/attachments', requireAuth, taskAttachments);
  app.use('/api/tasks', requireAuth, tasksRouter);
  app.use('/api', (req, res, next) => next(notFound('Risorsa non trovata')));

  app.use(
    express.static(path.join(root, 'public'), {
      extensions: ['html'],
      // il frontend cambia spesso: il browser ricontrolla sempre (ETag), senza riscaricare
      setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
    }),
  );
  app.use(errorHandler);
  return app;
}
