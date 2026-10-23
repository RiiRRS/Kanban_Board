import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUsername,
  validatePassword,
  validateCommentText,
  normalizeTaskInput,
  validateTaskInput,
  findTimeConflict,
  getDescendantIds,
  wouldCreateCycle,
} from '../public/js/validation.js';

const valid = () => ({
  title: 'Preparare slide',
  description: '',
  status: 'todo',
  date: '2026-10-28',
  startTime: '09:00',
  endTime: '10:30',
  color: '#4f8cff',
  priority: 'medium',
  parentId: null,
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
  assert.equal(input.status, 'todo');
  assert.equal(input.priority, 'medium');
  assert.equal(input.color, '#4f8cff');
  assert.equal(input.parentId, 3);
  assert.equal(normalizeTaskInput({ parentId: '' }).parentId, null);
  assert.deepEqual(Object.keys(normalizeTaskInput(null)).length, 9);
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
    description: 'x'.repeat(2001),
    status: 'boh',
    date: '2026-02-30',
    startTime: '24:00',
    endTime: '9:00',
    color: 'red',
    priority: 'urgent',
    parentId: 1.5,
  });
  assert.deepEqual(e, {
    title: 'Il titolo è obbligatorio',
    description: 'La descrizione può avere al massimo 2000 caratteri',
    status: 'Stato non valido',
    date: 'Data non valida',
    startTime: 'Ora di inizio non valida',
    endTime: 'Ora di fine non valida',
    priority: 'Priorità non valida',
    color: 'Colore non valido',
    parentId: 'Attività genitore non trovata',
  });
  assert.equal(
    validateTaskInput({ ...valid(), title: 'x'.repeat(101) }).title,
    'Il titolo può avere al massimo 100 caratteri',
  );
  assert.equal(validateTaskInput({ ...valid(), date: '2028-02-29' }).date, undefined);
});

test('conflitto di orario', () => {
  const tasks = [{ id: 1, date: '2026-10-28', startTime: '09:00' }];
  assert.equal(findTimeConflict(tasks, { date: '2026-10-28', startTime: '09:00' }).id, 1);
  assert.equal(findTimeConflict(tasks, { id: 1, date: '2026-10-28', startTime: '09:00' }), null);
  assert.equal(findTimeConflict(tasks, { date: '2026-10-29', startTime: '09:00' }), null);
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
