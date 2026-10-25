import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorHandler, notFound } from './errors.js';
import authRouter, { requireAuth } from './auth.js';
import tasksRouter from './tasks.js';
import commentsRouter from './comments.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.use('/api', authRouter);
app.use('/api/tasks/:taskId/comments', requireAuth, commentsRouter); // prima delle attività
app.use('/api/tasks', requireAuth, tasksRouter);
app.use('/api', (req, res, next) => next(notFound('Risorsa non trovata')));

app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));
app.use(errorHandler);

app.listen(PORT, () => console.log(`Kanban Board su http://localhost:${PORT}`));
