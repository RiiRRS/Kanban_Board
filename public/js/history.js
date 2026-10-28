// Cronologia: frasi leggibili per gli eventi registrati dal server

import { getTaskEvents } from './api.js';
import { el, spinner } from './dom.js';
import { formatRelative, formatDateTime } from './format.js';

const quote = (s) => `“${s}”`;

// frase senza il nome di chi ha agito ("ha spostato “X” da A a B")
export function describeEvent(e) {
  const d = e.data ?? {};
  switch (e.type) {
    case 'task.created':
      return `ha creato ${quote(d.title)} in ${d.column}`;
    case 'task.updated':
      return `ha modificato ${quote(d.title)}: ${(d.fields ?? []).join(', ')}`;
    case 'task.assigned': {
      const parts = [];
      if (d.added?.length) parts.push(`ha assegnato ${quote(d.title)} a ${d.added.join(', ')}`);
      if (d.removed?.length) parts.push(`ha tolto ${d.removed.join(', ')} da ${quote(d.title)}`);
      return parts.join(' e ');
    }
    case 'task.moved':
      return `ha spostato ${quote(d.title)} da ${d.from} a ${d.to}`;
    case 'task.archived':
      return `ha archiviato ${quote(d.title)}`;
    case 'task.restored':
      return `ha ripristinato ${quote(d.title)}`;
    case 'task.deleted':
      return `ha eliminato ${quote(d.title)}`;
    case 'task.recurred':
      return `ha pianificato la prossima occorrenza di ${quote(d.title)} (${d.date})`;
    case 'comment.added':
      return `ha commentato ${quote(d.title)}`;
    case 'attachment.added':
      return `ha allegato ${quote(d.name)} a ${quote(d.title)}`;
    case 'board.created':
      return `ha creato la board ${quote(d.name)}`;
    case 'board.imported':
      return `ha importato la board ${quote(d.name)} (${d.count} attività)`;
    case 'board.archived-done':
      return `ha archiviato ${d.count} attività completate`;
    default:
      return e.type;
  }
}

export function createEventList(events, { onOpenTask } = {}) {
  const ul = el('ul', 'event-list');
  for (const e of events) {
    const li = el('li', 'event');
    const who = el('strong', null, e.actor?.username ?? 'Qualcuno');
    const text = el('span', null, ` ${describeEvent(e)}`);
    const time = el('time', 'event__time', formatRelative(e.createdAt));
    time.dateTime = e.createdAt;
    time.title = formatDateTime(e.createdAt);
    li.append(who, text, time);
    // attività ancora esistente: si può aprire (il chiamante sa dire quali)
    if (onOpenTask && e.taskId != null && e.type !== 'task.deleted') {
      li.classList.add('event--link');
      li.tabIndex = 0;
      const open = () => onOpenTask(e.taskId);
      li.addEventListener('click', open);
      li.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') open();
      });
    }
    ul.append(li);
  }
  return ul;
}

// cronologia di una sola attività: si carica quando si apre la sezione
export function createTaskHistory(taskId) {
  const box = el('details', 'history');
  box.append(el('summary', null, 'Cronologia'));
  const body = el('div', 'history__body');
  box.append(body);
  let loaded = false;
  box.addEventListener('toggle', async () => {
    if (!box.open || loaded) return;
    loaded = true;
    const loading = el('p', 'comments__status');
    loading.append(spinner(), 'Caricamento…');
    body.replaceChildren(loading);
    try {
      const events = await getTaskEvents(taskId);
      body.replaceChildren(
        events.length ? createEventList(events) : el('p', 'detail__muted', 'Nessun evento'),
      );
    } catch {
      loaded = false;
      body.replaceChildren(el('p', 'detail__muted', 'Impossibile caricare la cronologia'));
    }
  });
  return box;
}
