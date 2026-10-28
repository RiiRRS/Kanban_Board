// Dati di esempio: `npm run seed` cancella tutto e ricrea gli stessi utenti, attività e commenti
// dei dati finti di api.js (password per tutti: password123). Le date sono calcolate rispetto a oggi.

import bcrypt from 'bcryptjs';
import { db } from './db.js';

const PASSWORD = 'password123';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// 'YYYY-MM-DD HH:MM:SS' in UTC, come lo salva SQLite
const sqlTime = (offsetMs = 0) =>
  new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace('T', ' ');

// data locale di oggi + offset giorni -> 'YYYY-MM-DD'
function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const users = [
  { id: 1, username: 'enrico', role: 'admin' },
  { id: 2, username: 'riccardo', role: 'member' },
  { id: 3, username: 'manuel', role: 'member' },
];

// [titolo, descrizione, stato, giorno (offset da oggi), inizio, fine, colore, priorità, genitore, autore]
const taskRows = [
  [
    'Preparare presentazione',
    'Struttura: problema, demo, architettura, limiti noti.\nDurata massima: 10 minuti.',
    'todo',
    3,
    '10:00',
    '12:00',
    '#a855f7',
    'high',
    null,
    1,
  ],
  [
    'Scrivere le slide sulla parte tecnica',
    'Server, database, API e cache.',
    'doing',
    2,
    '14:00',
    '16:00',
    '#4f8cff',
    'medium',
    1,
    1,
  ],
  [
    "Raccogliere gli screenshot dell'interfaccia",
    '',
    'todo',
    2,
    '09:00',
    '10:00',
    '#14b8a6',
    'low',
    1,
    3,
  ],
  [
    'Correggere il layout delle card su mobile',
    'A 375px il titolo esce dalla card.',
    'doing',
    -1,
    '15:00',
    '17:00',
    '#ef4444',
    'high',
    null,
    2,
  ],
  ['Riunione di allineamento', '', 'doing', 0, '09:00', '09:30', '#f59e0b', 'medium', null, 2],
  [
    'Rivedere tutti i messaggi di errore del form di registrazione e confrontarli con le specifiche',
    '',
    'todo',
    4,
    '11:00',
    '12:30',
    '#ec4899',
    'low',
    null,
    3,
  ],
  [
    'Testare il drag-and-drop su telefono',
    'Provare sia Android sia iPhone.',
    'review',
    0,
    '16:00',
    '17:30',
    '#22c55e',
    'medium',
    null,
    1,
  ],
  [
    'Controllare i permessi delle API',
    'Un member non deve poter modificare le attività altrui.',
    'review',
    1,
    '10:00',
    '11:00',
    '#64748b',
    'high',
    null,
    1,
  ],
  ['Schema del database', '', 'done', 1, '14:00', '15:00', '#4f8cff', 'medium', null, 1],
  ['Mockup della pagina di login', '', 'done', 5, '09:00', '10:00', '#a855f7', 'low', null, 3],
];

// [attività, autore, testo, ore fa]
const commentRows = [
  [1, 2, 'Io posso preparare la parte sul layout.', 26],
  [
    1,
    3,
    'Per la demo propongo di partire dal login, creare un’attività, spostarla con il drag-and-drop ' +
      'e poi aprire il dettaglio per mostrare la gerarchia e i commenti. Così in pochi minuti si vedono ' +
      'tutte le funzionalità principali, compresi gli errori quando due attività iniziano alla stessa ora.',
    25,
  ],
  [4, 1, 'Succede anche nella colonna In revisione.', 5],
  [4, 2, 'Ci guardo oggi pomeriggio.', 4],
];

const hash = bcrypt.hashSync(PASSWORD, 10);

const seed = db.transaction(() => {
  // l'ordine rispetta le foreign key
  db.exec('DELETE FROM comments; DELETE FROM tasks; DELETE FROM sessions; DELETE FROM users;');

  const insertUser = db.prepare(
    'INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)',
  );
  for (const u of users) insertUser.run(u.id, u.username, hash, u.role);

  const insertTask = db.prepare(
    `INSERT INTO tasks (id, title, description, status, date, start_time, end_time, color, priority,
                        parent_id, position, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const positions = {};
  taskRows.forEach(
    ([title, description, status, day, start, end, color, priority, parentId, authorId], i) => {
      positions[status] = (positions[status] ?? -1) + 1;
      const createdAt = sqlTime(-(10 - i) * DAY);
      insertTask.run(
        i + 1,
        title,
        description,
        status,
        localDate(day),
        start,
        end,
        color,
        priority,
        parentId,
        positions[status],
        authorId,
        createdAt,
        createdAt,
      );
    },
  );

  const insertComment = db.prepare(
    'INSERT INTO comments (id, task_id, author_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  commentRows.forEach(([taskId, authorId, text, hoursAgo], i) => {
    insertComment.run(i + 1, taskId, authorId, text, sqlTime(-hoursAgo * HOUR));
  });
});

seed();

console.log(
  `Seed completato: ${users.length} utenti, ${taskRows.length} attività, ${commentRows.length} commenti.`,
);
console.log(`Utenti: ${users.map((u) => u.username).join(', ')} (password: ${PASSWORD})`);
