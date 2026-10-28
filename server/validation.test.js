import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUsername,
  validatePassword,
  validateCommentText,
  normalizeTaskInput,
  validateTaskInput,
  findTimeConflicts,
  nextOccurrence,
  formatMinutes,
  validateName,
  getDescendantIds,
  wouldCreateCycle,
} from '../public/js/validation.js';

const valid = () => ({
  title: 'Preparare slide',
  description: '',
  columnId: 1,
  date: '2026-10-28',
  startTime: '09:00',
  endTime: '10:30',
  color: '#4f8cff',
  priority: 'medium',
  parentId: null,
  assigneeIds: [],
  labelIds: [],
  estimateMin: null,
  spentMin: 0,
  recurrence: 'none',
});

test('username', () => {
  assert.equal(validateUsername(''), 'Inserisci uno username');
  assert.equal(validateUsername('   '), 'Inserisci uno username');
  assert.equal(validateUsername(undefined), 'Inserisci uno username');
  const msg = 'Lo username deve avere 3-30 caratteri: lettere, numeri o _';
  assert.equal(validateUsername('ab'), msg);
  assert.equal(validateUsername('a'.repeat(31)), msg);
  assert.equal(validateUsername('mario rossi'), msg);
  assert.equal(validateUsername('mario-rossi'), msg);
  assert.equal(validateUsername('mario_rossi_99'), null);
});

test('password', () => {
  assert.equal(validatePassword('1234567'), 'La password deve avere almeno 8 caratteri');
  assert.equal(validatePassword(12345678), 'La password deve avere almeno 8 caratteri');
  assert.equal(validatePassword('password123'), null);
});

test('testo del commento', () => {
  assert.equal(validateCommentText('   '), 'Il commento non può essere vuoto');
  assert.equal(validateCommentText(null), 'Il commento non può essere vuoto');
  assert.equal(
    validateCommentText('a'.repeat(1001)),
    'Il commento può avere al massimo 1000 caratteri',
  );
  assert.equal(validateCommentText('  Fatto  '), null);
});

test('normalizeTaskInput applica trim e default', () => {
  const input = normalizeTaskInput({ title: '  Ciao  ', parentId: '3', color: '' });
  assert.equal(input.title, 'Ciao');
  assert.equal(input.description, '');
  assert.equal(input.columnId, null);
  assert.equal(input.priority, 'medium');
  assert.equal(input.color, '#4f8cff');
  assert.equal(input.parentId, 3);
  assert.equal(normalizeTaskInput({ parentId: '' }).parentId, null);
  assert.deepEqual(Object.keys(normalizeTaskInput(null)).length, 14);

  const rich = normalizeTaskInput({
    columnId: '4',
    assigneeIds: [2, '3', 2, 0],
    labelIds: 'no',
    estimateMin: '90',
    spentMin: '',
    recurrence: 'weekly',
  });
  assert.equal(rich.columnId, 4);
  assert.deepEqual(rich.assigneeIds, [2, 3]);
  assert.deepEqual(rich.labelIds, []);
  assert.equal(rich.estimateMin, 90);
  assert.equal(rich.spentMin, 0);
  assert.equal(rich.recurrence, 'weekly');
  assert.equal(normalizeTaskInput({ estimateMin: '' }).estimateMin, null);
  assert.ok(Number.isNaN(normalizeTaskInput({ estimateMin: '1.5' }).estimateMin));
});

test('attività valida', () => {
  assert.deepEqual(validateTaskInput(valid()), {});
});

test('fine prima di inizio', () => {
  const e = validateTaskInput({ ...valid(), startTime: '10:00', endTime: '09:00' });
  assert.equal(e.endTime, "L'ora di fine deve essere dopo l'ora di inizio");
  const same = validateTaskInput({ ...valid(), startTime: '10:00', endTime: '10:00' });
  assert.equal(same.endTime, "L'ora di fine deve essere dopo l'ora di inizio");
});

test('campi non validi', () => {
  const e = validateTaskInput({
    title: '',
    description: 'x'.repeat(5001),
    columnId: 0,
    date: '2026-02-30',
    startTime: '24:00',
    endTime: '9:00',
    color: 'red',
    priority: 'urgent',
    parentId: 1.5,
    assigneeIds: [1, 'x'],
    labelIds: [-1],
    estimateMin: -5,
    spentMin: 1.5,
    recurrence: 'yearly',
  });
  assert.deepEqual(e, {
    title: 'Il titolo è obbligatorio',
    description: 'La descrizione può avere al massimo 5000 caratteri',
    columnId: 'Colonna non valida',
    date: 'Data non valida',
    startTime: 'Ora di inizio non valida',
    endTime: 'Ora di fine non valida',
    priority: 'Priorità non valida',
    color: 'Colore non valido',
    parentId: 'Attività genitore non trovata',
    assigneeIds: 'Assegnatari non validi',
    labelIds: 'Etichette non valide',
    estimateMin: 'Stima non valida',
    spentMin: 'Tempo non valido',
    recurrence: 'Ripetizione non valida',
  });
  assert.equal(
    validateTaskInput({ ...valid(), title: 'x'.repeat(101) }).title,
    'Il titolo può avere al massimo 100 caratteri',
  );
  assert.equal(validateTaskInput({ ...valid(), date: '2028-02-29' }).date, undefined);
});

test('conflitti: orari che si sovrappongono tra gli stessi assegnatari', () => {
  const task = (over) => ({
    id: 1,
    date: '2026-10-28',
    startTime: '09:00',
    endTime: '10:00',
    isDone: false,
    archived: false,
    assigneeIds: [7],
    ...over,
  });
  const probe = { date: '2026-10-28', startTime: '09:30', endTime: '10:30', assigneeIds: [7] };
  assert.equal(findTimeConflicts([task()], probe).length, 1);
  // orari che si toccano soltanto non si sovrappongono
  assert.equal(
    findTimeConflicts([task()], { ...probe, startTime: '10:00', endTime: '11:00' }).length,
    0,
  );
  // anche se iniziano a ore diverse: contano le sovrapposizioni, non solo l'inizio uguale
  assert.equal(
    findTimeConflicts([task({ startTime: '08:00', endTime: '12:00' })], probe).length,
    1,
  );
  // altro giorno, altra persona, attività fatta o archiviata, stessa attività: nessun conflitto
  assert.equal(findTimeConflicts([task({ date: '2026-10-29' })], probe).length, 0);
  assert.equal(findTimeConflicts([task({ assigneeIds: [8] })], probe).length, 0);
  assert.equal(findTimeConflicts([task({ isDone: true })], probe).length, 0);
  assert.equal(findTimeConflicts([task({ archived: true })], probe).length, 0);
  assert.equal(findTimeConflicts([task()], { ...probe, id: 1 }).length, 0);
  // senza assegnatari nessuno è doppiamente impegnato
  assert.equal(
    findTimeConflicts([task({ assigneeIds: [] })], { ...probe, assigneeIds: [] }).length,
    0,
  );
  assert.equal(
    findTimeConflicts([task({ assigneeIds: [7, 8] })], { ...probe, assigneeIds: [8, 9] }).length,
    1,
  );
});

test('prossima occorrenza di un task ricorrente', () => {
  assert.equal(nextOccurrence('2026-10-28', 'daily'), '2026-10-29');
  assert.equal(nextOccurrence('2026-12-31', 'daily'), '2027-01-01');
  assert.equal(nextOccurrence('2026-10-28', 'weekly'), '2026-11-04');
  assert.equal(nextOccurrence('2026-10-28', 'monthly'), '2026-11-28');
  assert.equal(nextOccurrence('2026-12-15', 'monthly'), '2027-01-15');
  // il mese corto ferma il giorno all'ultimo disponibile
  assert.equal(nextOccurrence('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(nextOccurrence('2028-01-31', 'monthly'), '2028-02-29');
  assert.equal(nextOccurrence('2026-10-28', 'none'), null);
});

test('formatMinutes e validateName', () => {
  assert.equal(formatMinutes(null), '—');
  assert.equal(formatMinutes(0), '0m');
  assert.equal(formatMinutes(45), '45m');
  assert.equal(formatMinutes(120), '2h');
  assert.equal(formatMinutes(90), '1h 30m');
  assert.equal(validateName('  ', 30, 'Colonna'), 'Colonna: il nome è obbligatorio');
  assert.equal(validateName('x'.repeat(31), 30, 'Colonna'), 'Colonna: al massimo 30 caratteri');
  assert.equal(validateName(' Bug ', 30, 'Etichetta'), null);
});

test('gerarchia e cicli', () => {
  // 1 → 2 → 3, 4 da sola
  const tasks = [
    { id: 1, parentId: null },
    { id: 2, parentId: 1 },
    { id: 3, parentId: 2 },
    { id: 4, parentId: null },
  ];
  assert.deepEqual([...getDescendantIds(tasks, 1)].sort(), [2, 3]);
  assert.equal(wouldCreateCycle(tasks, 1, 3), true);
  assert.equal(wouldCreateCycle(tasks, 1, 1), true);
  assert.equal(wouldCreateCycle(tasks, 3, 4), false);
  assert.equal(wouldCreateCycle(tasks, 1, null), false);
  // dati sporchi con un ciclo già presente: non va in loop
  const dirty = [
    { id: 1, parentId: 2 },
    { id: 2, parentId: 1 },
  ];
  assert.deepEqual([...getDescendantIds(dirty, 1)], [2]);
});
