// Dati di esempio: `npm run seed` cancella tutto e ricrea gli stessi utenti, attività e commenti
// (password per tutti: password123). Le date sono calcolate rispetto a oggi.
// Se il database contiene già utenti, serve `npm run seed -- --force`.

import bcrypt from 'bcryptjs';
import { db } from './db.js';

if (
  db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0 &&
  !process.argv.includes('--force')
) {
  console.error(
    'Il database contiene già dati: il seed li cancellerebbe. Usa --force per procedere.',
  );
  process.exit(1);
}

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
      'tutte le funzionalità principali, compresi gli avvisi quando due attività si sovrappongono. @manuel ti va?',
    25,
  ],
  [4, 1, 'Succede anche nella colonna In revisione.', 5],
  [4, 2, 'Ci guardo oggi pomeriggio.', 4],
];

const hash = bcrypt.hashSync(PASSWORD, 10);

// [nome, colore]
const labelRows = [
  ['Frontend', '#4f8cff'],
  ['Backend', '#22c55e'],
  ['Bug', '#ef4444'],
  ['Documentazione', '#f59e0b'],
];

// per ogni attività (stesso ordine di taskRows): assegnatari, etichette, stima e tempo in minuti,
// ripetizione
const extraRows = [
  { assignees: [1, 2], labels: ['Documentazione'], estimate: 180, spent: 45 },
  { assignees: [1], labels: ['Documentazione'], estimate: 120, spent: 60 },
  { assignees: [3], labels: ['Frontend'], estimate: 60, spent: 0 },
  { assignees: [2], labels: ['Frontend', 'Bug'], estimate: 120, spent: 90 },
  { assignees: [1, 2, 3], labels: [], estimate: 30, spent: 30, recurrence: 'daily' },
  { assignees: [], labels: ['Documentazione'], estimate: null, spent: 0 },
  { assignees: [1], labels: ['Frontend'], estimate: 90, spent: 80 },
  { assignees: [2], labels: ['Backend'], estimate: 60, spent: 50 },
  { assignees: [1], labels: ['Backend'], estimate: 60, spent: 55 },
  { assignees: [3], labels: ['Frontend'], estimate: 60, spent: 60 },
];

// [attività, voce, fatta]
const checklistRows = [
  [1, 'Scrivere la scaletta', 1],
  [1, 'Preparare la demo', 0],
  [1, 'Provare il discorso davanti al gruppo', 0],
  [4, 'Riprodurre il problema a 375px', 1],
  [4, 'Correggere il CSS della card', 0],
];

const seed = db.transaction(() => {
  // l'ordine rispetta le foreign key (le attività prima delle colonne, la board per ultima)
  db.exec(`
    DELETE FROM notifications; DELETE FROM events; DELETE FROM attachments;
    DELETE FROM checklist_items; DELETE FROM task_labels; DELETE FROM task_assignees;
    DELETE FROM comments; DELETE FROM tasks; DELETE FROM labels; DELETE FROM columns;
    DELETE FROM boards; DELETE FROM sessions; DELETE FROM users;
  `);

  const insertUser = db.prepare(
    'INSERT INTO users (id, username, password_hash, role, avatar_color) VALUES (?, ?, ?, ?, ?)',
  );
  const avatarColors = ['#4f8cff', '#22c55e', '#a855f7'];
  users.forEach((u, i) => insertUser.run(u.id, u.username, hash, u.role, avatarColors[i]));

  // board principale con le quattro colonne di sempre (In corso ha un limite WIP)
  db.prepare('INSERT INTO boards (id, name, created_by) VALUES (1, ?, 1)').run('Board principale');
  const columnNames = ['Da fare', 'In corso', 'In revisione', 'Fatto'];
  const insertColumn = db.prepare(
    'INSERT INTO columns (id, board_id, name, position, wip_limit, is_done) VALUES (?, ?, ?, ?, ?, ?)',
  );
  columnNames.forEach((name, i) =>
    insertColumn.run(i + 1, 1, name, i, name === 'In corso' ? 4 : null, name === 'Fatto' ? 1 : 0),
  );
  const columnOf = { todo: 1, doing: 2, review: 3, done: 4 };

  // una seconda board, per mostrare che se ne possono avere più di una
  db.prepare('INSERT INTO boards (id, name, created_by) VALUES (2, ?, 1)').run('Idee future');
  ['Idee', 'Da valutare', 'Approvate'].forEach((name, i) =>
    insertColumn.run(5 + i, 2, name, i, null, i === 2 ? 1 : 0),
  );

  const insertLabel = db.prepare(
    'INSERT INTO labels (id, board_id, name, color) VALUES (?, 1, ?, ?)',
  );
  const labelId = {};
  labelRows.forEach(([name, color], i) => {
    insertLabel.run(i + 1, name, color);
    labelId[name] = i + 1;
  });

  const insertTask = db.prepare(
    `INSERT INTO tasks (id, board_id, column_id, title, description, date, start_time, end_time,
                        color, priority, parent_id, position, estimate_min, spent_min, recurrence,
                        completed_at, created_by, created_at, updated_at)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAssignee = db.prepare('INSERT INTO task_assignees VALUES (?, ?)');
  const insertTaskLabel = db.prepare('INSERT INTO task_labels VALUES (?, ?)');
  const insertEvent = db.prepare(
    'INSERT INTO events (board_id, task_id, actor_id, type, data, created_at) VALUES (1, ?, ?, ?, ?, ?)',
  );
  const positions = {};
  taskRows.forEach(
    ([title, description, status, day, start, end, color, priority, parentId, authorId], i) => {
      const columnId = columnOf[status];
      positions[columnId] = (positions[columnId] ?? -1) + 1;
      const createdAt = sqlTime(-(10 - i) * DAY);
      const extra = extraRows[i];
      insertTask.run(
        i + 1,
        columnId,
        title,
        description,
        localDate(day),
        start,
        end,
        color,
        priority,
        parentId,
        positions[columnId],
        extra.estimate,
        extra.spent,
        extra.recurrence ?? 'none',
        status === 'done' ? createdAt : null,
        authorId,
        createdAt,
        createdAt,
      );
      for (const userId of extra.assignees) insertAssignee.run(i + 1, userId);
      for (const name of extra.labels) insertTaskLabel.run(i + 1, labelId[name]);
      insertEvent.run(
        i + 1,
        authorId,
        'task.created',
        JSON.stringify({ title, column: columnNames[columnId - 1] }),
        createdAt,
      );
    },
  );

  db.prepare(
    `INSERT INTO tasks (id, board_id, column_id, title, description, date, start_time, end_time,
                        color, priority, position, created_by)
     VALUES (11, 2, 5, 'Esportare le attività in PDF', 'Idea da valutare dopo la consegna.', ?,
             '10:00', '11:00', '#14b8a6', 'low', 0, 1)`,
  ).run(localDate(14));

  const insertItem = db.prepare(
    'INSERT INTO checklist_items (task_id, text, done, position) VALUES (?, ?, ?, ?)',
  );
  checklistRows.forEach(([taskId, text, done], i) => insertItem.run(taskId, text, done, i));

  const insertComment = db.prepare(
    'INSERT INTO comments (id, task_id, author_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  commentRows.forEach(([taskId, authorId, text, hoursAgo], i) => {
    insertComment.run(i + 1, taskId, authorId, text, sqlTime(-hoursAgo * HOUR));
  });

  // una menzione di prova: manuel la trova nelle notifiche
  db.prepare(
    `INSERT INTO notifications (user_id, actor_id, type, task_id, text, created_at)
     VALUES (3, 1, 'mention', 1, 'enrico ti ha menzionato in "Preparare presentazione"', ?)`,
  ).run(sqlTime(-25 * HOUR));
});

seed();

console.log(
  `Seed completato: ${users.length} utenti, 2 board, ${taskRows.length + 1} attività, ${commentRows.length} commenti.`,
);
console.log(`Utenti: ${users.map((u) => u.username).join(', ')} (password: ${PASSWORD})`);
