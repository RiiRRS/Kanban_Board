// Test d'integrazione: avviano l'app vera su una porta libera con un database in memoria
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.DB_PATH = ':memory:';
process.env.AUTH_RATE_MAX = '1000';
process.env.QUIET_ERRORS = '1';

const { createApp } = await import('./app.js');
const { db } = await import('./db.js');
const { config } = await import('./config.js');

let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
  db.close();
  fs.rmSync(config.uploadDir, { recursive: true, force: true });
});

// piccolo client con cookie: ogni "utente" ha il suo
function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const isRaw = body instanceof Uint8Array;
    const res = await fetch(base + path, {
      method,
      headers: {
        'X-Requested-With': 'kanban',
        ...(body && !isRaw ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body ? (isRaw ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };
}

// la board di partenza ha le colonne 1 Da fare, 2 In corso, 3 In revisione, 4 Fatto
const TODO = 1;
const DOING = 2;
const REVIEW = 3;
const DONE = 4;

// ogni attività di prova ha un giorno suo, salvo che il test ne indichi uno: i conflitti
// d'orario valgono tra tutte le board, e i test non devono influenzarsi a vicenda
let day = 0;
const uniqueDate = () => {
  const d = new Date(Date.UTC(2040, 0, 1 + day++));
  return d.toISOString().slice(0, 10);
};

const task = (over = {}) => ({
  title: 'Task',
  columnId: TODO,
  date: uniqueDate(),
  startTime: '09:00',
  endTime: '10:00',
  ...over,
});

const admin = client();
const member = client();
const other = client();
const ids = {};

const create = async (who, over) => {
  const r = await who('POST', '/api/tasks', task(over));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};
const list = async (who = admin, boardId = 1) =>
  (await who('GET', `/api/boards/${boardId}/tasks`)).body;

// ---------------------------------------------------------------------------
// Account e sicurezza
// ---------------------------------------------------------------------------

test('il primo utente è admin, i successivi member', async () => {
  const a = await admin('POST', '/api/register', { username: 'alice', password: 'password123' });
  assert.equal(a.status, 201);
  assert.equal(a.body.role, 'admin');
  ids.alice = a.body.id;
  const m = await member('POST', '/api/register', { username: 'bob', password: 'password123' });
  assert.equal(m.body.role, 'member');
  ids.bob = m.body.id;
  const c = await other('POST', '/api/register', { username: 'carol', password: 'password123' });
  ids.carol = c.body.id;
});

test('username duplicato (anche con maiuscole diverse) → 409', async () => {
  const r = await client()('POST', '/api/register', { username: 'ALICE', password: 'password123' });
  assert.equal(r.status, 409);
});

test('login: password sbagliata e username inesistente danno lo stesso errore', async () => {
  const c = client();
  const wrong = await c('POST', '/api/login', { username: 'alice', password: 'sbagliata1' });
  const ghost = await c('POST', '/api/login', { username: 'nessuno', password: 'password123' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, ghost.body);
});

test('il token di sessione nel DB è un hash, non quello del cookie', async () => {
  const c = client();
  const res = await c('POST', '/api/login', { username: 'alice', password: 'password123' });
  const cookieToken = res.headers.get('set-cookie').split(';')[0].split('=')[1];
  assert.equal(db.prepare('SELECT 1 FROM sessions WHERE token = ?').get(cookieToken), undefined);
});

test('senza sessione le rotte protette danno 401', async () => {
  const anon = client();
  for (const path of ['/api/boards', '/api/users', '/api/notifications', '/api/stream']) {
    assert.equal((await anon('GET', path)).status, 401, path);
  }
  assert.equal((await anon('GET', '/api/tasks/1')).status, 401);
});

test('CSRF: le richieste che modificano dati senza header vengono rifiutate', async () => {
  const r = await client()(
    'POST',
    '/api/login',
    { username: 'alice', password: 'x' },
    { 'X-Requested-With': '' },
  );
  assert.equal(r.status, 403);
});

test('header di sicurezza e /health', async () => {
  const r = await client()('GET', '/health');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('logout invalida la sessione', async () => {
  const c = client();
  await c('POST', '/api/login', { username: 'bob', password: 'password123' });
  assert.equal((await c('GET', '/api/me')).status, 200);
  await c('POST', '/api/logout');
  const stale = await fetch(base + '/api/me', { headers: { Cookie: 'kanban_session=x' } });
  assert.equal(stale.status, 401);
});

// ---------------------------------------------------------------------------
// Profilo
// ---------------------------------------------------------------------------

test('profilo: nome e colore dell’avatar, con validazione', async () => {
  const ok = await other('PATCH', '/api/me', { displayName: ' Carolina ', avatarColor: '#ec4899' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.displayName, 'Carolina');
  assert.equal(ok.body.avatarColor, '#ec4899');
  assert.equal(ok.body.username, 'carol');
  assert.equal(
    (await other('PATCH', '/api/me', { avatarColor: 'rosa' })).body.field,
    'avatarColor',
  );
  assert.equal((await other('PATCH', '/api/me', { displayName: 'x'.repeat(41) })).status, 400);
  // un campo non inviato resta com'è
  assert.equal((await other('PATCH', '/api/me', {})).body.displayName, 'Carolina');
});

test('cambio password: richiede quella attuale e chiude le altre sessioni', async () => {
  const first = client();
  const second = client();
  await first('POST', '/api/register', { username: 'dave', password: 'password123' });
  await second('POST', '/api/login', { username: 'dave', password: 'password123' });

  assert.equal(
    (await first('POST', '/api/me/password', { currentPassword: 'no', newPassword: 'nuovapass1' }))
      .body.field,
    'currentPassword',
  );
  assert.equal(
    (
      await first('POST', '/api/me/password', {
        currentPassword: 'password123',
        newPassword: 'corta',
      })
    ).body.field,
    'newPassword',
  );
  const ok = await first('POST', '/api/me/password', {
    currentPassword: 'password123',
    newPassword: 'nuovapass1',
  });
  assert.equal(ok.status, 204);
  assert.equal((await first('GET', '/api/me')).status, 200, 'la sessione corrente resta');
  assert.equal((await second('GET', '/api/me')).status, 401, 'le altre vengono chiuse');
  const relog = await client()('POST', '/api/login', { username: 'dave', password: 'nuovapass1' });
  assert.equal(relog.status, 200);
  assert.equal(
    (await client()('POST', '/api/login', { username: 'dave', password: 'password123' })).status,
    401,
  );
});

test('elenco utenti senza dati sensibili', async () => {
  const r = await member('GET', '/api/users');
  assert.equal(r.status, 200);
  assert.ok(r.body.length >= 3);
  assert.ok(r.body.every((u) => !('passwordHash' in u) && !('password_hash' in u)));
});

// ---------------------------------------------------------------------------
// Attività: base
// ---------------------------------------------------------------------------

test('crea attività e posizioni progressive nella colonna', async () => {
  const a = await create(member, { title: 'A', startTime: '09:00', endTime: '10:00' });
  const b = await create(member, { title: 'B', startTime: '11:00', endTime: '12:00' });
  assert.equal(b.position, a.position + 1);
  assert.equal(a.boardId, 1);
  assert.equal(a.isDone, false);
});

test('senza assegnatari le attività possono sovrapporsi', async () => {
  const r = await member('POST', '/api/tasks', task({ title: 'Stesso orario' }));
  assert.equal(r.status, 201);
});

test('dati non validi → 400 con il campo', async () => {
  const r = await member('POST', '/api/tasks', task({ title: '' }));
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'title');
  assert.equal(
    (await member('POST', '/api/tasks', task({ columnId: 999 }))).body.field,
    'columnId',
  );
  assert.equal(
    (await member('POST', '/api/tasks', task({ columnId: null }))).body.field,
    'columnId',
  );
  assert.equal(
    (await member('POST', '/api/tasks', task({ assigneeIds: [9999] }))).body.field,
    'assigneeIds',
  );
  assert.equal(
    (await member('POST', '/api/tasks', task({ labelIds: [9999] }))).body.field,
    'labelIds',
  );
  assert.equal(
    (await member('POST', '/api/tasks', task({ estimateMin: 1.5 }))).body.field,
    'estimateMin',
  );
  assert.equal((await member('POST', '/api/tasks', task({ recurrence: 'yearly' }))).status, 400);
});

test("permessi: un member non modifica né elimina le attività altrui, l'admin sì", async () => {
  const t = await create(member, { title: 'Di bob', startTime: '15:00', endTime: '16:00' });
  const body = task({ startTime: '15:00', endTime: '16:00' });
  assert.equal((await other('PUT', `/api/tasks/${t.id}`, body)).status, 403);
  assert.equal((await other('DELETE', `/api/tasks/${t.id}`)).status, 403);
  const edited = await admin('PUT', `/api/tasks/${t.id}`, { ...body, title: 'Cambiato' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.title, 'Cambiato');
  assert.equal((await admin('DELETE', `/api/tasks/${t.id}`)).status, 204);
});

test('dettaglio di un’attività: checklist e allegati inclusi; inesistente → 404', async () => {
  const t = await create(member, { title: 'Dettaglio' });
  const d = await other('GET', `/api/tasks/${t.id}`);
  assert.equal(d.status, 200);
  assert.deepEqual(d.body.checklist, []);
  assert.deepEqual(d.body.attachments, []);
  assert.equal((await other('GET', '/api/tasks/99999')).status, 404);
  assert.equal((await other('GET', '/api/tasks/abc')).status, 404);
});

// ---------------------------------------------------------------------------
// Spostamenti
// ---------------------------------------------------------------------------

test('chiunque può spostare, e le posizioni restano contigue', async () => {
  const moved = [];
  for (const h of ['06', '07', '08']) {
    moved.push(
      (
        await create(member, {
          date: '2030-02-01',
          startTime: `${h}:00`,
          endTime: `${h}:30`,
          columnId: DOING,
        })
      ).id,
    );
  }
  assert.equal(
    (await other('PATCH', `/api/tasks/${moved[2]}/move`, { columnId: DOING, position: 0 })).status,
    200,
  );
  assert.equal(
    (await other('PATCH', `/api/tasks/${moved[0]}/move`, { columnId: REVIEW, position: 0 })).status,
    200,
  );
  const all = await list(member);
  for (const columnId of [DOING, REVIEW]) {
    const positions = all.filter((t) => t.columnId === columnId).map((t) => t.position);
    assert.deepEqual(
      positions,
      positions.map((_, i) => i),
      `colonna ${columnId}`,
    );
  }
  assert.equal(all.filter((t) => t.columnId === DOING)[0].id, moved[2]);
  for (const id of moved) await member('DELETE', `/api/tasks/${id}`);
});

test('spostamento: colonna o posizione non valide → 400, inesistente → 404', async () => {
  const t = await create(member, { title: 'Da spostare' });
  const move = (body, id = t.id) => member('PATCH', `/api/tasks/${id}/move`, body);
  assert.equal((await move({ columnId: 'x', position: 0 })).status, 400);
  assert.equal((await move({ columnId: 9999, position: 0 })).status, 400);
  assert.equal((await move({ columnId: TODO, position: -1 })).status, 400);
  assert.equal((await move({ columnId: TODO, position: 0 }, 99999)).status, 404);
});

test('gerarchia: genitore inesistente e cicli vengono rifiutati; il figlio si stacca alla cancellazione', async () => {
  const p = await create(member, { title: 'P' });
  const c = await create(member, { title: 'C', parentId: p.id });
  assert.equal((await member('POST', '/api/tasks', task({ parentId: 99999 }))).status, 400);
  const cycle = await member('PUT', `/api/tasks/${p.id}`, task({ title: 'P', parentId: c.id }));
  assert.equal(cycle.status, 400);
  await member('DELETE', `/api/tasks/${p.id}`);
  assert.equal((await list(member)).find((t) => t.id === c.id).parentId, null);
});

test('il genitore deve stare nella stessa board', async () => {
  const board = (await member('POST', '/api/boards', { name: 'Altra' })).body;
  const foreign = await member('POST', '/api/tasks', task({ columnId: board.columns[0].id }));
  const r = await member('POST', '/api/tasks', task({ parentId: foreign.body.id }));
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'parentId');
  await member('DELETE', `/api/boards/${board.id}`);
});

// ---------------------------------------------------------------------------
// Sotto-attività con progresso
// ---------------------------------------------------------------------------

test('il genitore conosce quanti figli sono completati', async () => {
  const p = await create(member, { title: 'Genitore' });
  const c1 = await create(member, { title: 'F1', parentId: p.id });
  await create(member, { title: 'F2', parentId: p.id });
  await member('PATCH', `/api/tasks/${c1.id}/move`, { columnId: DONE, position: 0 });
  const found = (await list(member)).find((t) => t.id === p.id);
  assert.equal(found.childCount, 2);
  assert.equal(found.childDoneCount, 1);
});

// ---------------------------------------------------------------------------
// Assegnatari, etichette, stima e tempo
// ---------------------------------------------------------------------------

test('assegnatari, etichette, stima e tempo vengono salvati e restituiti', async () => {
  const label = (
    await member('POST', '/api/boards/1/labels', { name: 'Urgente', color: '#ef4444' })
  ).body;
  const t = await create(member, {
    title: 'Completa',
    assigneeIds: [ids.carol, ids.bob],
    labelIds: [label.id],
    estimateMin: 120,
    spentMin: 30,
    description: '# Titolo\n\n**grassetto**',
  });
  assert.deepEqual(
    t.assignees.map((a) => a.username),
    ['bob', 'carol'],
  );
  assert.equal(t.assignees.find((a) => a.username === 'carol').displayName, 'Carolina');
  assert.deepEqual(
    t.labels.map((l) => l.name),
    ['Urgente'],
  );
  assert.equal(t.estimateMin, 120);
  assert.equal(t.spentMin, 30);
  assert.equal(t.description, '# Titolo\n\n**grassetto**');

  // la modifica sostituisce gli insiemi
  const upd = await member(
    'PUT',
    `/api/tasks/${t.id}`,
    task({ title: 'Completa', assigneeIds: [ids.alice], labelIds: [] }),
  );
  assert.deepEqual(
    upd.body.assignees.map((a) => a.username),
    ['alice'],
  );
  assert.deepEqual(upd.body.labels, []);
  assert.equal(upd.body.estimateMin, null);
  await member('DELETE', `/api/tasks/${t.id}`);
});

test('etichette: nome unico per board, solo chi gestisce la board le cambia', async () => {
  const board = (await member('POST', '/api/boards', { name: 'Etichette' })).body;
  const url = `/api/boards/${board.id}/labels`;
  const a = await other('POST', url, { name: 'Bug', color: '#ef4444' });
  assert.equal(a.status, 201, 'chiunque può crearle');
  assert.equal(
    (await other('POST', url, { name: 'bug' })).status,
    409,
    'nome duplicato senza maiuscole',
  );
  assert.equal((await other('POST', url, { name: '' })).status, 400);
  assert.equal((await other('POST', url, { name: 'X', color: 'rosso' })).status, 400);
  assert.equal((await other('PUT', `${url}/${a.body.id}`, { name: 'Altro' })).status, 403);
  assert.equal(
    (await member('PUT', `${url}/${a.body.id}`, { name: 'Difetto', color: '#22c55e' })).body.name,
    'Difetto',
  );
  assert.equal((await other('DELETE', `${url}/${a.body.id}`)).status, 403);
  assert.equal((await member('DELETE', `${url}/${a.body.id}`)).status, 204);
  await member('DELETE', `/api/boards/${board.id}`);
});

test('un’etichetta di un’altra board viene rifiutata', async () => {
  const board = (await member('POST', '/api/boards', { name: 'Con etichetta' })).body;
  const l = (await member('POST', `/api/boards/${board.id}/labels`, { name: 'Mia' })).body;
  const r = await member('POST', '/api/tasks', task({ labelIds: [l.id] }));
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'labelIds');
  await member('DELETE', `/api/boards/${board.id}`);
});

// ---------------------------------------------------------------------------
// Conflitti d'orario
// ---------------------------------------------------------------------------

test('conflitto: avviso con le attività in sovrapposizione, poi si può confermare', async () => {
  const base1 = await create(member, {
    title: 'Riunione',
    date: '2031-05-05',
    startTime: '10:00',
    endTime: '11:00',
    assigneeIds: [ids.carol],
  });
  const clash = task({
    title: 'Si accavalla',
    date: '2031-05-05',
    startTime: '10:30',
    endTime: '11:30',
    assigneeIds: [ids.carol],
  });
  const warn = await member('POST', '/api/tasks', clash);
  assert.equal(warn.status, 409);
  assert.equal(warn.body.code, 'time_conflict');
  assert.equal(warn.body.field, 'startTime');
  assert.equal(warn.body.conflicts[0].id, base1.id);
  assert.equal(warn.body.conflicts[0].title, 'Riunione');

  const forced = await member('POST', '/api/tasks', { ...clash, ignoreConflicts: true });
  assert.equal(forced.status, 201);

  // altra persona o orario solo adiacente (11:30 è la fine dell'attività confermata): nessun avviso
  assert.equal(
    (await member('POST', '/api/tasks', { ...clash, assigneeIds: [ids.bob] })).status,
    201,
  );
  assert.equal(
    (await member('POST', '/api/tasks', { ...clash, startTime: '11:30', endTime: '12:30' })).status,
    201,
  );
  // completando l'attività il suo orario torna libero
  const probe = { ...clash, title: 'Ora libero', startTime: '10:00', endTime: '10:30' };
  assert.equal((await member('POST', '/api/tasks', probe)).status, 409);
  await member('PATCH', `/api/tasks/${base1.id}/move`, { columnId: DONE, position: 0 });
  assert.equal((await member('POST', '/api/tasks', probe)).status, 201);
  // e un'attività creata già tra le completate non segnala niente
  const doneProbe = {
    ...clash,
    title: 'Già fatta',
    columnId: DONE,
    startTime: '10:30',
    endTime: '11:30',
  };
  assert.equal((await member('POST', '/api/tasks', doneProbe)).status, 201);
});

test('modificare solo il titolo non richiede di nuovo la conferma del conflitto', async () => {
  const a = await create(member, {
    title: 'A',
    date: '2031-06-06',
    startTime: '09:00',
    endTime: '10:00',
    assigneeIds: [ids.carol],
  });
  const forced = await member('POST', '/api/tasks', {
    ...task({
      title: 'B',
      date: '2031-06-06',
      startTime: '09:30',
      endTime: '10:30',
      assigneeIds: [ids.carol],
    }),
    ignoreConflicts: true,
  });
  assert.equal(forced.status, 201);
  const rename = await member(
    'PUT',
    `/api/tasks/${forced.body.id}`,
    task({
      title: 'B rinominata',
      date: '2031-06-06',
      startTime: '09:30',
      endTime: '10:30',
      assigneeIds: [ids.carol],
    }),
  );
  assert.equal(rename.status, 200);
  // spostare l'orario invece sì
  const move = await member(
    'PUT',
    `/api/tasks/${forced.body.id}`,
    task({
      title: 'B',
      date: '2031-06-06',
      startTime: '09:45',
      endTime: '10:30',
      assigneeIds: [ids.carol],
    }),
  );
  assert.equal(move.status, 409);
  assert.equal(move.body.conflicts[0].id, a.id);
});

// ---------------------------------------------------------------------------
// Colonne e limite WIP
// ---------------------------------------------------------------------------

test('colonne: crea, rinomina, riordina, limite WIP; solo chi gestisce la board', async () => {
  const board = (await member('POST', '/api/boards', { name: 'Colonne' })).body;
  assert.deepEqual(
    board.columns.map((c) => c.name),
    ['Da fare', 'In corso', 'In revisione', 'Fatto'],
  );
  assert.equal(board.columns[3].isDone, true);
  const url = `/api/boards/${board.id}/columns`;

  assert.equal((await other('POST', url, { name: 'Extra' })).status, 403);
  const added = await member('POST', url, { name: 'Bloccate', wipLimit: 2 });
  assert.equal(added.status, 201);
  assert.equal(added.body.wipLimit, 2);
  assert.equal(added.body.position, 4);
  assert.equal((await member('POST', url, { name: '' })).status, 400);
  assert.equal((await member('POST', url, { name: 'X', wipLimit: 0 })).body.field, 'wipLimit');
  assert.equal((await member('POST', url, { name: 'X', wipLimit: 1.5 })).status, 400);

  const renamed = await member('PUT', `${url}/${added.body.id}`, {
    name: 'In attesa',
    wipLimit: null,
    isDone: false,
  });
  assert.equal(renamed.body.name, 'In attesa');
  assert.equal(renamed.body.wipLimit, null);

  const order = board.columns
    .map((c) => c.id)
    .reverse()
    .concat(added.body.id);
  const reordered = await member('PUT', `/api/boards/${board.id}/columns-order`, { ids: order });
  assert.deepEqual(
    reordered.body.columns.map((c) => c.id),
    order,
  );
  assert.equal(
    (await member('PUT', `/api/boards/${board.id}/columns-order`, { ids: [order[0]] })).status,
    400,
  );
  assert.equal(
    (
      await member('PUT', `/api/boards/${board.id}/columns-order`, {
        ids: [...order.slice(1), order[1]],
      })
    ).status,
    400,
  );
  await member('DELETE', `/api/boards/${board.id}`);
});

test('WIP: oltre il limite serve la conferma (force), in creazione, spostamento e modifica', async () => {
  const board = (await member('POST', '/api/boards', { name: 'WIP' })).body;
  const [todo, doing] = board.columns;
  await member('PUT', `/api/boards/${board.id}/columns/${doing.id}`, {
    name: doing.name,
    wipLimit: 2,
    isDone: false,
  });
  const inDoing = (extra = {}) => task({ columnId: doing.id, ...extra });

  assert.equal((await member('POST', '/api/tasks', inDoing())).status, 201);
  const second = await member('POST', '/api/tasks', inDoing());
  assert.equal(second.status, 201);
  const blocked = await member('POST', '/api/tasks', inDoing());
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'wip_limit');
  assert.equal(blocked.body.limit, 2);
  assert.equal((await member('POST', '/api/tasks', inDoing({ force: true }))).status, 201);

  // spostare dentro dal fuori è bloccato, riordinare nella stessa colonna no
  const outside = (await member('POST', '/api/tasks', task({ columnId: todo.id }))).body;
  const mv = await member('PATCH', `/api/tasks/${outside.id}/move`, {
    columnId: doing.id,
    position: 0,
  });
  assert.equal(mv.status, 409);
  assert.equal(mv.body.code, 'wip_limit');
  assert.equal(
    (
      await member('PATCH', `/api/tasks/${outside.id}/move`, {
        columnId: doing.id,
        position: 0,
        force: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (await member('PATCH', `/api/tasks/${outside.id}/move`, { columnId: doing.id, position: 2 }))
      .status,
    200,
  );

  // modifica che cambia colonna
  const another = (await member('POST', '/api/tasks', task({ columnId: todo.id }))).body;
  const edit = await member('PUT', `/api/tasks/${another.id}`, task({ columnId: doing.id }));
  assert.equal(edit.status, 409);
  assert.equal(edit.body.code, 'wip_limit');

  // le attività archiviate non contano nel limite
  const open = (await member('GET', `/api/boards/${board.id}/tasks`)).body.filter(
    (t) => t.columnId === doing.id,
  );
  assert.equal(open.length, 4);
  for (const t of open.slice(0, 3)) await member('POST', `/api/tasks/${t.id}/archive`, {});
  assert.equal((await member('POST', '/api/tasks', inDoing())).status, 201);
  await member('DELETE', `/api/boards/${board.id}`);
});

test('colonne: eliminarne una piena richiede la destinazione e conserva l’ordine', async () => {
  const board = (await member('POST', '/api/boards', { name: 'Elimina colonna' })).body;
  const [todo, doing, , done] = board.columns;
  const a = (await member('POST', '/api/tasks', task({ columnId: todo.id, title: 'A' }))).body;
  const b = (await member('POST', '/api/tasks', task({ columnId: todo.id, title: 'B' }))).body;
  const c = (await member('POST', '/api/tasks', task({ columnId: doing.id, title: 'C' }))).body;
  const url = `/api/boards/${board.id}/columns/${todo.id}`;

  assert.equal((await other('DELETE', url)).status, 403);
  const needs = await member('DELETE', url);
  assert.equal(needs.status, 409);
  assert.equal(needs.body.code, 'column_not_empty');
  assert.equal(needs.body.count, 2);
  assert.equal((await member('DELETE', `${url}?moveTo=${todo.id}`)).status, 400);
  assert.equal((await member('DELETE', `${url}?moveTo=999999`)).status, 404);

  assert.equal((await member('DELETE', `${url}?moveTo=${doing.id}`)).status, 204);
  const rest = await list(member, board.id);
  const inDoing = rest
    .filter((t) => t.columnId === doing.id)
    .sort((x, y) => x.position - y.position);
  assert.deepEqual(
    inDoing.map((t) => t.title),
    ['C', 'A', 'B'],
  );
  assert.deepEqual(
    inDoing.map((t) => t.position),
    [0, 1, 2],
  );
  const fresh = (await member('GET', `/api/boards/${board.id}`)).body;
  assert.deepEqual(
    fresh.columns.map((x) => x.position),
    [0, 1, 2],
    'posizioni delle colonne senza buchi',
  );

  // spostare in una colonna dei completati imposta la data di completamento
  assert.equal(
    (await member('DELETE', `/api/boards/${board.id}/columns/${doing.id}?moveTo=${done.id}`))
      .status,
    204,
  );
  const completed = await list(member, board.id);
  assert.ok(completed.every((t) => t.isDone && t.completedAt));
  assert.ok([a, b, c].every((x) => completed.some((t) => t.id === x.id)));

  // l'ultima colonna non si elimina
  const left = (await member('GET', `/api/boards/${board.id}`)).body.columns;
  await member('DELETE', `/api/boards/${board.id}/columns/${left[0].id}?moveTo=${left[1].id}`);
  const last = (await member('GET', `/api/boards/${board.id}`)).body.columns;
  assert.equal(
    (await member('DELETE', `/api/boards/${board.id}/columns/${last[0].id}?moveTo=${last[0].id}`))
      .status,
    400,
  );
  await member('DELETE', `/api/boards/${board.id}`);
});

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

test('board: crea, rinomina (solo chi la gestisce), elenca; l’ultima non si elimina', async () => {
  const created = await other('POST', '/api/boards', { name: '  Progetto Z ' });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Progetto Z');
  assert.equal(created.body.createdBy, ids.carol);
  assert.equal((await other('POST', '/api/boards', { name: '' })).status, 400);
  assert.equal((await other('POST', '/api/boards', { name: 'x'.repeat(51) })).status, 400);

  const url = `/api/boards/${created.body.id}`;
  assert.equal((await member('PUT', url, { name: 'Rubata' })).status, 403);
  assert.equal((await other('PUT', url, { name: 'Progetto Y' })).body.name, 'Progetto Y');
  assert.equal(
    (await admin('PUT', url, { name: 'Progetto X' })).body.name,
    'Progetto X',
    'l’admin gestisce tutto',
  );
  const boards = (await member('GET', '/api/boards')).body;
  assert.ok(boards.some((b) => b.id === created.body.id && b.name === 'Progetto X'));
  assert.equal((await member('GET', '/api/boards/99999')).status, 404);

  assert.equal((await member('DELETE', url)).status, 403);
  assert.equal((await other('DELETE', url)).status, 204);
  assert.equal((await member('GET', url)).status, 404);

  // la board 1 è l'unica rimasta tra le originali: non si può eliminare se è l'ultima
  const count = db.prepare('SELECT COUNT(*) AS n FROM boards').get().n;
  if (count === 1) assert.equal((await admin('DELETE', '/api/boards/1')).status, 400);
});

test('eliminare una board elimina attività, colonne ed etichette', async () => {
  const board = (await member('POST', '/api/boards', { name: 'Da cancellare' })).body;
  const l = (await member('POST', `/api/boards/${board.id}/labels`, { name: 'L' })).body;
  const t = (
    await member('POST', '/api/tasks', task({ columnId: board.columns[0].id, labelIds: [l.id] }))
  ).body;
  await member('POST', `/api/tasks/${t.id}/comments`, { text: 'ciao' });
  assert.equal((await member('DELETE', `/api/boards/${board.id}`)).status, 204);
  for (const table of ['tasks', 'columns', 'labels', 'comments', 'task_labels']) {
    const sql = {
      tasks: 'SELECT COUNT(*) n FROM tasks WHERE board_id = ?',
      columns: 'SELECT COUNT(*) n FROM columns WHERE board_id = ?',
      labels: 'SELECT COUNT(*) n FROM labels WHERE board_id = ?',
      comments: 'SELECT COUNT(*) n FROM comments WHERE task_id = ?',
      task_labels: 'SELECT COUNT(*) n FROM task_labels WHERE task_id = ?',
    }[table];
    const param = ['comments', 'task_labels'].includes(table) ? t.id : board.id;
    assert.equal(db.prepare(sql).get(param).n, 0, table);
  }
});

// ---------------------------------------------------------------------------
// Archivio
// ---------------------------------------------------------------------------

test('archivio: le attività archiviate escono dalla board e non occupano posti', async () => {
  const board = (await member('POST', '/api/boards', { name: 'Archivio' })).body;
  const col = board.columns[0].id;
  const mk = async (title) =>
    (await member('POST', '/api/tasks', task({ columnId: col, title }))).body;
  const [a, b, c] = [await mk('A'), await mk('B'), await mk('C')];

  const arch = await other('POST', `/api/tasks/${b.id}/archive`, {});
  assert.equal(arch.status, 200, 'archiviare è permesso a tutti, come spostare');
  assert.ok(arch.body.archivedAt);
  const visible = await list(member, board.id);
  assert.deepEqual(
    visible.map((t) => t.title),
    ['A', 'C'],
  );
  assert.deepEqual(
    visible.map((t) => t.position),
    [0, 1],
  );
  const archived = (await member('GET', `/api/boards/${board.id}/tasks?archived=1`)).body;
  assert.deepEqual(
    archived.map((t) => t.title),
    ['B'],
  );

  assert.equal(
    (await member('PATCH', `/api/tasks/${b.id}/move`, { columnId: col, position: 0 })).status,
    400,
  );
  // ripristinando torna in fondo alla colonna
  const back = await member('POST', `/api/tasks/${b.id}/archive`, { archived: false });
  assert.equal(back.body.archivedAt, null);
  assert.deepEqual(
    (await list(member, board.id)).map((t) => t.title),
    ['A', 'C', 'B'],
  );
  // archiviare due volte non rompe nulla
  await member('POST', `/api/tasks/${a.id}/archive`, {});
  assert.equal((await member('POST', `/api/tasks/${a.id}/archive`, {})).status, 200);
  assert.deepEqual(
    (await list(member, board.id)).map((t) => t.position),
    [0, 1],
  );
  assert.equal(c.title, 'C');
  await member('DELETE', `/api/boards/${board.id}`);
});

test('archivia tutte le attività completate della board', async () => {
  const board = (await member('POST', '/api/boards', { name: 'Archivia fatte' })).body;
  const [todo, , , done] = board.columns;
  const t1 = (await member('POST', '/api/tasks', task({ columnId: todo.id }))).body;
  await member('POST', '/api/tasks', task({ columnId: done.id }));
  await member('POST', '/api/tasks', task({ columnId: done.id }));
  const r = await other('POST', `/api/boards/${board.id}/archive-done`);
  assert.equal(r.body.archived, 2);
  const left = await list(member, board.id);
  assert.deepEqual(
    left.map((t) => t.id),
    [t1.id],
  );
  assert.equal((await member('POST', `/api/boards/${board.id}/archive-done`)).body.archived, 0);
  await member('DELETE', `/api/boards/${board.id}`);
});

// ---------------------------------------------------------------------------
// Ricorrenze
// ---------------------------------------------------------------------------

test('completando un’attività ricorrente nasce la prossima, una volta sola', async () => {
  const label = (await member('POST', '/api/boards/1/labels', { name: 'Ripetuta' })).body;
  const t = await create(member, {
    title: 'Settimanale',
    date: '2031-01-31',
    recurrence: 'monthly',
    assigneeIds: [ids.bob],
    labelIds: [label.id],
    estimateMin: 60,
    columnId: DOING,
  });
  await member('POST', `/api/tasks/${t.id}/checklist`, { text: 'Passo 1' });
  const item = (await member('GET', `/api/tasks/${t.id}`)).body.checklist[0];
  await member('PUT', `/api/tasks/${t.id}/checklist/${item.id}`, { done: true });

  const done = await member('PATCH', `/api/tasks/${t.id}/move`, { columnId: DONE, position: 0 });
  assert.ok(done.body.completedAt);
  let tasks = await list(member);
  const next = tasks.find((x) => x.title === 'Settimanale' && x.id !== t.id);
  assert.ok(next, 'prossima occorrenza creata');
  assert.equal(next.date, '2031-02-28', 'fine mese corto');
  assert.equal(next.columnId, TODO, 'nella prima colonna');
  assert.equal(next.recurrence, 'monthly');
  assert.equal(next.estimateMin, 60);
  assert.equal(next.spentMin, 0);
  assert.deepEqual(
    next.assignees.map((a) => a.username),
    ['bob'],
  );
  assert.deepEqual(
    next.labels.map((l) => l.name),
    ['Ripetuta'],
  );
  assert.equal(next.checklistTotal, 1);
  assert.equal(next.checklistDone, 0, 'checklist azzerata');

  // avanti e indietro non crea doppioni
  await member('PATCH', `/api/tasks/${t.id}/move`, { columnId: DOING, position: 0 });
  assert.equal((await list(member)).find((x) => x.id === t.id).completedAt, null);
  await member('PATCH', `/api/tasks/${t.id}/move`, { columnId: DONE, position: 0 });
  tasks = await list(member);
  assert.equal(tasks.filter((x) => x.title === 'Settimanale').length, 2);

  // anche completare con "Modifica" (cambio colonna) conta
  const t2 = await create(member, {
    title: 'Giornaliera',
    date: '2031-03-01',
    recurrence: 'daily',
  });
  await member(
    'PUT',
    `/api/tasks/${t2.id}`,
    task({ title: 'Giornaliera', date: '2031-03-01', recurrence: 'daily', columnId: DONE }),
  );
  assert.ok((await list(member)).some((x) => x.title === 'Giornaliera' && x.date === '2031-03-02'));
});

// ---------------------------------------------------------------------------
// Checklist e tempo
// ---------------------------------------------------------------------------

test('checklist: gli assegnati collaborano, gli altri no; progresso sulla card', async () => {
  const t = await create(member, { title: 'Con checklist', assigneeIds: [ids.carol] });
  const url = `/api/tasks/${t.id}/checklist`;

  // carol è assegnata: può; alice è admin: può; un terzo estraneo no
  const outsider = client();
  await outsider('POST', '/api/register', { username: 'erin', password: 'password123' });
  assert.equal((await outsider('POST', url, { text: 'No' })).status, 403);

  const one = await other('POST', url, { text: ' Prima voce ' });
  assert.equal(one.status, 201);
  assert.equal(one.body.text, 'Prima voce');
  assert.equal(one.body.done, false);
  const two = await member('POST', url, { text: 'Seconda' });
  assert.equal((await member('POST', url, { text: '' })).status, 400);
  assert.equal((await member('POST', url, { text: 'x'.repeat(201) })).status, 400);

  assert.equal((await outsider('PUT', `${url}/${one.body.id}`, { done: true })).status, 403);
  assert.equal((await other('PUT', `${url}/${one.body.id}`, { done: true })).body.done, true);
  assert.equal((await other('PUT', `${url}/${one.body.id}`, { done: 'sì' })).status, 400);
  assert.equal(
    (await other('PUT', `${url}/${two.body.id}`, { text: 'Rinominata' })).body.text,
    'Rinominata',
  );
  assert.equal((await other('PUT', `${url}/99999`, { done: true })).status, 404);

  const card = (await list(member)).find((x) => x.id === t.id);
  assert.equal(card.checklistTotal, 2);
  assert.equal(card.checklistDone, 1);

  assert.equal((await outsider('DELETE', `${url}/${two.body.id}`)).status, 403);
  assert.equal((await other('DELETE', `${url}/${two.body.id}`)).status, 204);
  const detail = (await member('GET', `/api/tasks/${t.id}`)).body;
  assert.deepEqual(
    detail.checklist.map((i) => i.text),
    ['Prima voce'],
  );

  // eliminando l'attività sparisce anche la checklist
  await member('DELETE', `/api/tasks/${t.id}`);
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM checklist_items WHERE task_id = ?').get(t.id).n,
    0,
  );
});

test('tempo effettivo: lo aggiorna anche chi è assegnato', async () => {
  const t = await create(member, { title: 'Tempo', assigneeIds: [ids.carol], estimateMin: 60 });
  const r = await other('PATCH', `/api/tasks/${t.id}/time`, { spentMin: 45 });
  assert.equal(r.status, 200);
  assert.equal(r.body.spentMin, 45);
  assert.equal((await other('PATCH', `/api/tasks/${t.id}/time`, { spentMin: -1 })).status, 400);
  assert.equal((await other('PATCH', `/api/tasks/${t.id}/time`, { spentMin: 1.5 })).status, 400);
  assert.equal((await other('PATCH', `/api/tasks/${t.id}/time`, { spentMin: 100000 })).status, 400);
  const stranger = client();
  await stranger('POST', '/api/login', { username: 'erin', password: 'password123' });
  assert.equal((await stranger('PATCH', `/api/tasks/${t.id}/time`, { spentMin: 5 })).status, 403);
});

// ---------------------------------------------------------------------------
// Commenti, menzioni, notifiche
// ---------------------------------------------------------------------------

test("commenti: crea, elenca, conta; eliminando l'attività spariscono", async () => {
  const t = await create(member, { title: 'Commentata' });
  assert.equal((await other('POST', `/api/tasks/${t.id}/comments`, { text: 'Ciao' })).status, 201);
  assert.equal((await other('POST', `/api/tasks/${t.id}/comments`, { text: '   ' })).status, 400);
  const comments = await member('GET', `/api/tasks/${t.id}/comments`);
  assert.equal(comments.body.length, 1);
  assert.equal(comments.body[0].author.username, 'carol');
  assert.equal(comments.body[0].editedAt, null);
  assert.equal((await list(member)).find((x) => x.id === t.id).commentCount, 1);
  await member('DELETE', `/api/tasks/${t.id}`);
  assert.equal((await member('GET', `/api/tasks/${t.id}/comments`)).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments WHERE task_id = ?').get(t.id).n, 0);
});

test('commenti: modifica solo l’autore, eliminazione anche l’admin', async () => {
  const t = await create(member, { title: 'Moderata' });
  const c = (await other('POST', `/api/tasks/${t.id}/comments`, { text: 'Originale' })).body;
  const url = `/api/tasks/${t.id}/comments/${c.id}`;

  assert.equal((await member('PUT', url, { text: 'Manomesso' })).status, 403);
  assert.equal(
    (await admin('PUT', url, { text: 'Manomesso' })).status,
    403,
    'nemmeno l’admin modifica',
  );
  assert.equal((await other('PUT', url, { text: '  ' })).status, 400);
  const edited = await other('PUT', url, { text: 'Corretto' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.text, 'Corretto');
  assert.ok(edited.body.editedAt);
  assert.equal(
    (await other('PUT', `/api/tasks/${t.id}/comments/99999`, { text: 'x' })).status,
    404,
  );
  assert.equal(
    (await other('PUT', `/api/tasks/99999/comments/${c.id}`, { text: 'x' })).status,
    404,
  );

  assert.equal((await member('DELETE', url)).status, 403);
  assert.equal((await other('DELETE', url)).status, 204);
  const c2 = (await other('POST', `/api/tasks/${t.id}/comments`, { text: 'Da moderare' })).body;
  assert.equal((await admin('DELETE', `/api/tasks/${t.id}/comments/${c2.id}`)).status, 204);
  assert.equal((await member('GET', `/api/tasks/${t.id}/comments`)).body.length, 0);
});

const notes = async (who) => (await who('GET', '/api/notifications')).body;

test('notifiche: assegnazione, menzione e commento, senza avvisare chi agisce', async () => {
  const reader = client();
  await reader('POST', '/api/register', { username: 'frank', password: 'password123' });
  const frank = (await reader('GET', '/api/me')).body.id;
  const before = (await notes(reader)).items.length;

  // alice crea e assegna frank
  const t = await create(admin, { title: 'Per Frank', assigneeIds: [frank, ids.alice] });
  let n = await notes(reader);
  assert.equal(n.items.length, before + 1);
  assert.match(n.items[0].text, /alice ti ha assegnato "Per Frank"/);
  assert.equal(n.items[0].type, 'assigned');
  assert.equal(n.items[0].taskId, t.id);
  assert.equal(n.items[0].read, false);
  assert.equal(n.unread, before + 1);
  // alice si è auto-assegnata: nessuna notifica a sé stessa
  assert.ok(!(await notes(admin)).items.some((x) => x.type === 'assigned' && x.taskId === t.id));

  // menzione: frank citato, carol no (utente inesistente ignorato), email non conta
  await member('POST', `/api/tasks/${t.id}/comments`, {
    text: 'Guarda @Frank e @nessuno, scrivi a bob@frank.it',
  });
  n = await notes(reader);
  assert.equal(n.items[0].type, 'mention');
  assert.match(n.items[0].text, /bob ti ha menzionato/);
  // frank è assegnato E citato: una sola notifica (menzione), non anche "commento"
  assert.equal(n.items.filter((x) => x.taskId === t.id && x.type === 'comment').length, 0);

  // commento senza menzione: gli assegnati e l'autore ricevono "commento"
  await member('POST', `/api/tasks/${t.id}/comments`, { text: 'Aggiornamento' });
  assert.equal((await notes(reader)).items[0].type, 'comment');
  assert.ok((await notes(admin)).items.some((x) => x.type === 'comment' && x.taskId === t.id));
  assert.ok(
    !(await notes(member)).items.some((x) => x.type === 'comment' && x.taskId === t.id),
    'bob ha commentato lui',
  );

  // segna come lette
  const first = (await notes(reader)).items[0];
  assert.equal((await reader('POST', '/api/notifications/read', { ids: [first.id] })).status, 204);
  assert.equal((await notes(reader)).items.find((x) => x.id === first.id).read, true);
  assert.equal((await reader('POST', '/api/notifications/read', {})).status, 400);
  await reader('POST', '/api/notifications/read', { all: true });
  assert.equal((await notes(reader)).unread, 0);
  // non si possono leggere le notifiche altrui
  const bobBefore = (await notes(member)).unread;
  await reader('POST', '/api/notifications/read', {
    ids: (await notes(member)).items.map((x) => x.id),
  });
  assert.equal((await notes(member)).unread, bobBefore);
});

test('notifiche: la scadenza di oggi compare una volta sola al giorno', async () => {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const t = await create(member, { title: 'Scade oggi', date: today, assigneeIds: [ids.carol] });
  const count = async () =>
    (await notes(other)).items.filter((x) => x.type === 'due' && x.taskId === t.id).length;
  assert.equal(await count(), 1);
  assert.equal(await count(), 1, 'nessun doppione alla seconda lettura');
  const note = (await notes(other)).items.find((x) => x.type === 'due');
  assert.equal(note.actor, null);
  // un'attività completata non genera avvisi
  const done = await create(member, {
    title: 'Già fatta',
    date: today,
    assigneeIds: [ids.carol],
    columnId: DONE,
  });
  assert.ok(!(await notes(other)).items.some((x) => x.type === 'due' && x.taskId === done.id));
});

// ---------------------------------------------------------------------------
// Cronologia
// ---------------------------------------------------------------------------

test('cronologia: registra creazione, modifiche, spostamenti, commenti e archivio', async () => {
  const t = await create(member, { title: 'Storia', priority: 'low' });
  await member(
    'PUT',
    `/api/tasks/${t.id}`,
    task({ title: 'Storia 2', date: t.date, priority: 'high', assigneeIds: [ids.carol] }),
  );
  await member('PATCH', `/api/tasks/${t.id}/move`, { columnId: REVIEW, position: 0 });
  await other('POST', `/api/tasks/${t.id}/comments`, { text: 'ok' });
  await member('POST', `/api/tasks/${t.id}/archive`, {});

  const events = (await other('GET', `/api/tasks/${t.id}/events`)).body;
  const types = events.map((e) => e.type).reverse();
  assert.deepEqual(types, [
    'task.created',
    'task.updated',
    'task.assigned',
    'task.moved',
    'comment.added',
    'task.archived',
  ]);
  const updated = events.find((e) => e.type === 'task.updated');
  assert.deepEqual(updated.data.fields.sort(), ['priorità', 'titolo']);
  assert.equal(updated.actor.username, 'bob');
  const moved = events.find((e) => e.type === 'task.moved');
  assert.equal(moved.data.from, 'Da fare');
  assert.equal(moved.data.to, 'In revisione');
  assert.deepEqual(events.find((e) => e.type === 'task.assigned').data.added, ['carol']);

  // lo spostamento nella stessa colonna non fa rumore
  const t2 = await create(member, { title: 'Quieta' });
  await member('PATCH', `/api/tasks/${t2.id}/move`, { columnId: TODO, position: 0 });
  assert.deepEqual(
    (await member('GET', `/api/tasks/${t2.id}/events`)).body.map((e) => e.type),
    ['task.created'],
  );

  // salvare senza cambiare nulla non registra nulla
  await member('PUT', `/api/tasks/${t2.id}`, task({ title: 'Quieta', date: t2.date }));
  assert.equal((await member('GET', `/api/tasks/${t2.id}/events`)).body.length, 1);

  // dopo l'eliminazione l'evento resta nel registro della board, con il titolo
  await member('DELETE', `/api/tasks/${t2.id}`);
  const feed = (await member('GET', '/api/boards/1/events?limit=5')).body;
  assert.equal(feed[0].type, 'task.deleted');
  assert.equal(feed[0].data.title, 'Quieta');
  assert.equal(feed[0].taskId, t2.id);

  // paginazione
  const page1 = (await member('GET', '/api/boards/1/events?limit=3')).body;
  const page2 = (await member('GET', `/api/boards/1/events?limit=3&before=${page1.at(-1).id}`))
    .body;
  assert.equal(page1.length, 3);
  assert.ok(page2.every((e) => e.id < page1.at(-1).id));
});

// ---------------------------------------------------------------------------
// Statistiche
// ---------------------------------------------------------------------------

test('statistiche della board', async () => {
  const board = (await member('POST', '/api/boards', { name: 'Statistiche' })).body;
  const [todo, doing, , done] = board.columns;
  const mk = (over) => member('POST', '/api/tasks', task({ columnId: todo.id, ...over }));
  await mk({
    date: '2000-01-01',
    priority: 'high',
    assigneeIds: [ids.bob],
    estimateMin: 60,
    spentMin: 30,
  });
  await mk({
    columnId: doing.id,
    priority: 'low',
    assigneeIds: [ids.bob, ids.carol],
    estimateMin: 30,
  });
  await mk({ columnId: done.id, assigneeIds: [ids.carol], spentMin: 15 });
  await mk({ priority: 'medium' });
  const archived = (await mk({ title: 'Archiviata' })).body;
  await member('POST', `/api/tasks/${archived.id}/archive`, {});

  const s = (await other('GET', `/api/boards/${board.id}/stats`)).body;
  assert.equal(s.totals.open, 3);
  assert.equal(s.totals.done, 1);
  assert.equal(s.totals.archived, 1);
  assert.equal(s.totals.overdue, 1);
  assert.equal(s.totals.estimateMin, 90);
  assert.equal(s.totals.spentMin, 45);
  assert.deepEqual(s.perPriority, { low: 1, medium: 1, high: 1 });
  assert.deepEqual(
    s.perColumn.map((c) => [c.name, c.count]),
    [
      ['Da fare', 2],
      ['In corso', 1],
      ['In revisione', 0],
      ['Fatto', 1],
    ],
  );
  const byName = Object.fromEntries(s.perAssignee.map((p) => [p.user?.username ?? 'nessuno', p]));
  assert.equal(byName.bob.open, 2);
  assert.equal(byName.carol.open, 1);
  assert.equal(byName.carol.done, 1);
  assert.equal(byName.nessuno.open, 1);
  assert.equal(s.completedPerDay.length, 14);
  assert.equal(s.completedPerDay.at(-1).count, 1, 'completata oggi');
  assert.equal(
    s.completedPerDay.reduce((n, d) => n + d.count, 0),
    1,
  );
  await member('DELETE', `/api/boards/${board.id}`);
});

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

test('export e import: giro completo senza perdere nulla', async () => {
  const board = (await member('POST', '/api/boards', { name: 'Origine' })).body;
  const [todo, doing] = board.columns;
  await member('PUT', `/api/boards/${board.id}/columns/${doing.id}`, {
    name: 'In corso',
    wipLimit: 3,
    isDone: false,
  });
  const label = (
    await member('POST', `/api/boards/${board.id}/labels`, { name: 'Importante', color: '#a855f7' })
  ).body;
  const parent = (
    await member(
      'POST',
      '/api/tasks',
      task({
        columnId: todo.id,
        title: 'Genitore',
        labelIds: [label.id],
        assigneeIds: [ids.carol],
        estimateMin: 90,
        spentMin: 20,
        recurrence: 'weekly',
        description: '**md**',
      }),
    )
  ).body;
  const child = (
    await member(
      'POST',
      '/api/tasks',
      task({ columnId: doing.id, title: 'Figlio', parentId: parent.id }),
    )
  ).body;
  await member('POST', `/api/tasks/${parent.id}/checklist`, { text: 'Voce' });
  await other('POST', `/api/tasks/${parent.id}/comments`, { text: 'Un commento' });
  await member('POST', `/api/tasks/${parent.id}/attachments`, {
    url: 'https://example.com/doc',
    name: 'Doc',
  });
  await member('POST', `/api/tasks/${child.id}/archive`, {});

  const exported = await member('GET', `/api/boards/${board.id}/export`);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /attachment; filename="Origine\.json"/);
  const data = exported.body;
  assert.equal(data.format, 'kanban-board');
  assert.equal(data.tasks.length, 2);

  const imported = await other('POST', '/api/boards/import', data);
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  const nb = imported.body;
  assert.notEqual(nb.id, board.id);
  assert.equal(nb.createdBy, ids.carol, 'chi importa diventa il proprietario');
  assert.deepEqual(
    nb.columns.map((c) => [c.name, c.wipLimit]),
    board.columns.map((c) => [c.name, c.name === 'In corso' ? 3 : null]),
  );
  assert.deepEqual(
    nb.labels.map((l) => [l.name, l.color]),
    [['Importante', '#a855f7']],
  );

  const tasks = await list(member, nb.id);
  const archivedTasks = (await member('GET', `/api/boards/${nb.id}/tasks?archived=1`)).body;
  assert.equal(tasks.length, 1);
  assert.equal(archivedTasks.length, 1);
  const p = tasks[0];
  assert.equal(p.title, 'Genitore');
  assert.equal(p.description, '**md**');
  assert.equal(p.estimateMin, 90);
  assert.equal(p.recurrence, 'weekly');
  assert.deepEqual(
    p.assignees.map((a) => a.username),
    ['carol'],
  );
  assert.deepEqual(
    p.labels.map((l) => l.name),
    ['Importante'],
  );
  assert.equal(p.checklistTotal, 1);
  assert.equal(p.commentCount, 1);
  assert.equal(p.attachmentCount, 1);
  assert.equal(archivedTasks[0].parentId, p.id, 'la gerarchia si ricollega');
  assert.equal(p.boardId, nb.id);

  // l'originale non è stato toccato
  assert.equal((await list(member, board.id)).length, 1);
  await member('DELETE', `/api/boards/${board.id}`);
  await other('DELETE', `/api/boards/${nb.id}`);
});

test('import: file non validi vengono rifiutati senza lasciare niente a metà', async () => {
  const boardsBefore = db.prepare('SELECT COUNT(*) AS n FROM boards').get().n;
  const tasksBefore = db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n;
  const good = {
    format: 'kanban-board',
    version: 1,
    board: { name: 'X' },
    columns: [{ name: 'Una', wipLimit: null, isDone: false }],
    labels: [],
    tasks: [
      { title: 'T', column: 'Una', date: '2030-01-01', startTime: '09:00', endTime: '10:00' },
    ],
  };
  const post = (body) => member('POST', '/api/boards/import', body);

  assert.equal((await post({ hello: 'world' })).status, 400);
  assert.equal((await post({ ...good, version: 2 })).status, 400);
  assert.equal((await post({ ...good, columns: [] })).status, 400);
  assert.equal((await post({ ...good, columns: [{ name: 'A' }, { name: 'A' }] })).status, 400);
  assert.equal(
    (await post({ ...good, tasks: [{ ...good.tasks[0], column: 'Inesistente' }] })).status,
    400,
  );
  const bad = await post({
    ...good,
    tasks: [good.tasks[0], { ...good.tasks[0], endTime: '08:00' }],
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Attività 2/);
  assert.equal((await post({ ...good, columns: [{ name: 'Una', wipLimit: 0 }] })).status, 400);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM boards').get().n, boardsBefore);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, tasksBefore);

  // dati ostili: cicli di genitori, utenti sconosciuti, link pericolosi, HTML nei testi
  const hostile = await post({
    ...good,
    tasks: [
      {
        ...good.tasks[0],
        ref: 1,
        parentRef: 2,
        title: '<script>alert(1)</script>',
        assignees: ['fantasma', 'bob'],
        comments: [{ author: 'fantasma', text: 'ciao' }],
        links: [{ url: 'javascript:alert(1)' }, { url: 'https://ok.example/', name: 'ok' }],
      },
      { ...good.tasks[0], ref: 2, parentRef: 1, startTime: '11:00', endTime: '12:00' },
    ],
  });
  assert.equal(hostile.status, 201);
  const imported = await list(member, hostile.body.id);
  assert.equal(imported.filter((t) => t.parentId != null).length, 1, 'il ciclo viene interrotto');
  const first = imported.find((t) => t.title.startsWith('<script>'));
  assert.deepEqual(
    first.assignees.map((a) => a.username),
    ['bob'],
  );
  assert.equal(first.attachmentCount, 1, 'solo il link http(s) sopravvive');
  const comment = (await member('GET', `/api/tasks/${first.id}/comments`)).body[0];
  assert.equal(comment.text, '[fantasma] ciao');
  assert.equal(comment.author.username, 'bob');
  await member('DELETE', `/api/boards/${hostile.body.id}`);
});

test('export CSV: formule neutralizzate e virgolette gestite', async () => {
  const board = (await member('POST', '/api/boards', { name: 'Csv, "strano"' })).body;
  await member(
    'POST',
    '/api/tasks',
    task({ columnId: board.columns[0].id, title: '=CMD()', description: 'riga 1\nriga "2", fine' }),
  );
  // fetch().text() toglie il BOM: si guardano i byte
  const csv = await fetch(`${base}/api/boards/${board.id}/export?format=csv`, {
    headers: { Cookie: await cookieOf(member) },
  });
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /filename="Csv_strano_\.csv"/);
  const bytes = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8 per Excel');
  const text = bytes.toString('utf8').slice(1);
  assert.ok(text.startsWith('Titolo,Colonna'));
  assert.ok(text.includes("'=CMD()"), 'la formula è neutralizzata');
  assert.ok(text.includes('"riga 1\nriga ""2"", fine"'));
  await member('DELETE', `/api/boards/${board.id}`);
});

// ---------------------------------------------------------------------------
// Allegati
// ---------------------------------------------------------------------------

test('allegati: link validati, file caricati e scaricati come download', async () => {
  const t = await create(member, { title: 'Con allegati', assigneeIds: [ids.carol] });
  const url = `/api/tasks/${t.id}/attachments`;

  const link = await other('POST', url, { url: 'https://example.com/pagina' });
  assert.equal(link.status, 201);
  assert.equal(link.body.kind, 'link');
  assert.equal(link.body.name, 'example.com', 'senza nome usa il dominio');
  assert.equal(link.body.url, 'https://example.com/pagina');
  for (const bad of ['javascript:alert(1)', 'ftp://x.it/f', 'non un url', '']) {
    assert.equal((await member('POST', url, { url: bad })).status, 400, bad);
  }

  const content = Buffer.from('ciao dal file');
  const file = await other('POST', url, new Uint8Array(content), {
    'Content-Type': 'application/octet-stream',
    'X-Filename': encodeURIComponent('../../etc/relazione finale.txt'),
    'X-File-Type': 'text/plain',
  });
  assert.equal(file.status, 201, JSON.stringify(file.body));
  assert.equal(file.body.kind, 'file');
  assert.equal(file.body.name, 'relazione finale.txt', 'il percorso viene tolto dal nome');
  assert.equal(file.body.size, content.length);
  assert.equal(file.body.url, `/api/attachments/${file.body.id}/download`);
  const stored = db
    .prepare('SELECT stored_name FROM attachments WHERE id = ?')
    .get(file.body.id).stored_name;
  assert.match(stored, /^[0-9a-f]{32}$/, 'sul disco con un nome casuale');
  assert.ok(fs.existsSync(`${config.uploadDir}/${stored}`));

  const dl = await fetch(base + file.body.url, { headers: { Cookie: await cookieOf(member) } });
  assert.equal(dl.status, 200);
  assert.equal(Buffer.from(await dl.arrayBuffer()).toString(), 'ciao dal file');
  assert.equal(dl.headers.get('content-type'), 'application/octet-stream');
  assert.match(
    dl.headers.get('content-disposition'),
    /^attachment; filename\*=UTF-8''relazione%20finale\.txt$/,
  );
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await client()('GET', file.body.url)).status, 401, 'serve il login');

  assert.equal(
    (await other('POST', url, new Uint8Array(0), { 'Content-Type': 'application/octet-stream' }))
      .status,
    400,
    'file vuoto',
  );
  const detail = (await member('GET', `/api/tasks/${t.id}`)).body;
  assert.equal(detail.attachments.length, 2);
  assert.equal((await list(member)).find((x) => x.id === t.id).attachmentCount, 2);

  // chi non collabora non può caricare né eliminare
  const stranger = client();
  await stranger('POST', '/api/login', { username: 'erin', password: 'password123' });
  assert.equal((await stranger('POST', url, { url: 'https://x.it' })).status, 403);
  assert.equal((await stranger('DELETE', `/api/attachments/${file.body.id}`)).status, 403);

  // elimina: il file sparisce dal disco
  assert.equal((await other('DELETE', `/api/attachments/${file.body.id}`)).status, 204);
  assert.ok(!fs.existsSync(`${config.uploadDir}/${stored}`));
  assert.equal((await member('GET', file.body.url)).status, 404);
  assert.equal((await member('DELETE', `/api/attachments/${file.body.id}`)).status, 404);

  // eliminando l'attività spariscono anche i file
  const second = await other('POST', url, new Uint8Array(content), {
    'Content-Type': 'application/octet-stream',
    'X-Filename': 'a.txt',
  });
  const stored2 = db
    .prepare('SELECT stored_name FROM attachments WHERE id = ?')
    .get(second.body.id).stored_name;
  await member('DELETE', `/api/tasks/${t.id}`);
  assert.ok(!fs.existsSync(`${config.uploadDir}/${stored2}`));
});

test('allegati: i file troppo grandi vengono rifiutati', async () => {
  const t = await create(member, { title: 'Grande' });
  const big = new Uint8Array(5 * 1024 * 1024 + 1);
  const r = await member('POST', `/api/tasks/${t.id}/attachments`, big, {
    'Content-Type': 'application/octet-stream',
  });
  assert.equal(r.status, 413);
});

// ---------------------------------------------------------------------------
// Tempo reale
// ---------------------------------------------------------------------------

test('tempo reale: una modifica arriva a chi è collegato al flusso', async () => {
  const controller = new AbortController();
  const res = await fetch(base + '/api/stream', {
    headers: { Cookie: await cookieOf(other) },
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  const read = async () => {
    const { value } = await reader.read();
    return decoder.decode(value);
  };
  assert.match(await read(), /retry:/);

  await create(member, { title: 'Cambia qualcosa' });
  assert.match(await read(), /data: {"type":"change"}/);

  // una richiesta fallita non genera messaggi
  await member('POST', '/api/tasks', task({ title: '' }));
  await create(member, { title: "Un'altra" });
  const next = await read();
  assert.equal(next.match(/data:/g).length, 1);
  controller.abort();
});

async function cookieOf(who) {
  // l'helper client() tiene il cookie in una closure: lo si ricava facendo il login di nuovo
  const names = new Map([
    [admin, 'alice'],
    [member, 'bob'],
    [other, 'carol'],
  ]);
  const c = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'kanban' },
    body: JSON.stringify({ username: names.get(who), password: 'password123' }),
  });
  return c.headers.get('set-cookie').split(';')[0];
}

test('il database è alla versione più recente delle migrazioni', async () => {
  const { SCHEMA_VERSION } = await import('./db.js');
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 5);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('WIP: ripristinare dall’archivio in una colonna piena chiede conferma', async () => {
  const board = (await member('POST', '/api/boards', { name: 'WIP archivio' })).body;
  const [, doing] = board.columns;
  await member('PUT', `/api/boards/${board.id}/columns/${doing.id}`, {
    name: doing.name,
    wipLimit: 1,
    isDone: false,
  });
  const a = (await member('POST', '/api/tasks', task({ columnId: doing.id }))).body;
  await member('POST', `/api/tasks/${a.id}/archive`, {});
  await member('POST', '/api/tasks', task({ columnId: doing.id }));

  const back = await member('POST', `/api/tasks/${a.id}/archive`, { archived: false });
  assert.equal(back.status, 409);
  assert.equal(back.body.code, 'wip_limit');
  const forced = await member('POST', `/api/tasks/${a.id}/archive`, {
    archived: false,
    force: true,
  });
  assert.equal(forced.status, 200);
  assert.equal(forced.body.archivedAt, null);
  await member('DELETE', `/api/boards/${board.id}`);
});
