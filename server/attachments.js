// Allegati: link e file (fino a 5 MB), salvati su disco accanto al database

import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, rowToAttachment } from './db.js';
import { badRequest, forbidden, notFound } from './errors.js';
import { LIMITS } from '../public/js/constants.js';
import { canContribute, canEdit } from './access.js';
import { loadTask, parseId } from './tasks.js';
import { config } from './config.js';
import { recordEvent } from './events.js';

// sotto /api/tasks/:taskId/attachments
export const taskAttachments = express.Router({ mergeParams: true });
// sotto /api/attachments
export const attachments = express.Router();

const MAX_PER_TASK = 30;

// il browser manda il nome con encodeURIComponent; qui si tolgono percorsi e caratteri strani
function cleanFilename(header) {
  let name = '';
  try {
    name = decodeURIComponent(String(header ?? ''));
  } catch {
    name = '';
  }
  name = path
    .basename(name.replace(/\\/g, '/'))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f"<>:*?|]/g, '')
    .trim();
  return (name || 'file').slice(0, LIMITS.attachmentNameMax);
}

function insertAttachment(task, user, fields) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE task_id = ?').get(task.id);
  if (n >= MAX_PER_TASK) throw badRequest(`Al massimo ${MAX_PER_TASK} allegati per attività`);
  const info = db
    .prepare(
      `INSERT INTO attachments (task_id, kind, name, url, stored_name, mime, size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      task.id,
      fields.kind,
      fields.name,
      fields.url ?? null,
      fields.storedName ?? null,
      fields.mime ?? null,
      fields.size ?? null,
      user.id,
    );
  recordEvent(task.boardId, task.id, user.id, 'attachment.added', {
    title: task.title,
    name: fields.name,
  });
  return rowToAttachment(
    db.prepare('SELECT * FROM attachments WHERE id = ?').get(info.lastInsertRowid),
  );
}

// link: JSON { url, name? }; file: corpo grezzo con l'header X-Filename
taskAttachments.post(
  '/',
  express.raw({ type: (req) => !req.is('application/json'), limit: LIMITS.attachmentBytes }),
  (req, res) => {
    const task = loadTask(parseId(req.params.taskId), req.user, { need: 'contribute' });

    if (req.is('application/json')) {
      let url;
      try {
        url = new URL(String(req.body?.url ?? '').trim());
      } catch {
        throw badRequest('Indirizzo non valido', 'url');
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.href.length > 500) {
        throw badRequest('Servono indirizzi http o https (max 500 caratteri)', 'url');
      }
      const given = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const name = (given || url.hostname).slice(0, LIMITS.attachmentNameMax);
      return res
        .status(201)
        .json(insertAttachment(task, req.user, { kind: 'link', name, url: url.href }));
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest('File vuoto');
    const name = cleanFilename(req.get('x-filename'));
    const storedName = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(config.uploadDir, { recursive: true });
    fs.writeFileSync(path.join(config.uploadDir, storedName), req.body);
    try {
      const mime = /^[\w.+-]+\/[\w.+-]+$/.test(req.get('x-file-type') ?? '')
        ? req.get('x-file-type')
        : 'application/octet-stream';
      res.status(201).json(
        insertAttachment(task, req.user, {
          kind: 'file',
          name,
          storedName,
          mime,
          size: req.body.length,
        }),
      );
    } catch (err) {
      fs.rmSync(path.join(config.uploadDir, storedName), { force: true });
      throw err;
    }
  },
);

function loadAttachment(value) {
  const id = parseId(value, 'Allegato non trovato');
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  if (!row) throw notFound('Allegato non trovato');
  return row;
}

// sempre come download e con tipo generico: un file caricato non deve mai essere eseguito
// dal browser come pagina del sito
attachments.get('/:id/download', (req, res) => {
  const row = loadAttachment(req.params.id);
  if (row.kind !== 'file') throw notFound('Allegato non trovato');
  const file = path.join(config.uploadDir, row.stored_name);
  if (!fs.existsSync(file)) throw notFound('File non più disponibile');
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': String(row.size),
  });
  fs.createReadStream(file).pipe(res);
});

// elimina chi l'ha caricato o chi può modificare l'attività
attachments.delete('/:id', (req, res) => {
  const row = loadAttachment(req.params.id);
  const task = loadTask(row.task_id, req.user);
  if (row.uploaded_by !== req.user.id && !canEdit(req.user, task)) throw forbidden();
  if (!canContribute(req.user, task)) throw forbidden();
  db.prepare('DELETE FROM attachments WHERE id = ?').run(row.id);
  if (row.kind === 'file') fs.rmSync(path.join(config.uploadDir, row.stored_name), { force: true });
  res.status(204).end();
});
