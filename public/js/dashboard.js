// Dashboard: numeri e grafici della board. Barre in CSS (nessuna libreria): i valori sono
// sempre scritti accanto alle barre e c'è una tabella con gli stessi dati.

import { el, plural } from './dom.js';
import { createAvatar, nameOf } from './avatar.js';
import { formatMinutes } from './validation.js';
import { formatShortDate } from './format.js';
import { PRIORITY_LABELS } from './constants.js';

// riga con etichetta, barra e valore a fine barra
function barRow(label, value, max, { color = 'open', note = '', title } = {}) {
  const row = el('li', 'bar-row');
  row.append(el('span', 'bar-row__label', label));
  const track = el('span', 'bar-row__track');
  const bar = el('span', `bar bar--${color}`);
  bar.style.width = `${max === 0 ? 0 : Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100))}%`;
  track.append(bar);
  row.append(track, el('span', 'bar-row__value', String(value)));
  if (note) row.append(el('span', 'bar-row__note', note));
  row.title = title ?? `${label}: ${value}`;
  return row;
}

function card(title, subtitle) {
  const section = el('section', 'viz-card');
  section.append(el('h3', 'viz-card__title', title));
  if (subtitle) section.append(el('p', 'viz-card__subtitle', subtitle));
  return section;
}

function tile(label, value, { tone = '', hint = '' } = {}) {
  const t = el('div', `tile${tone ? ` tile--${tone}` : ''}`);
  t.append(el('span', 'tile__value', String(value)), el('span', 'tile__label', label));
  if (hint) t.title = hint;
  return t;
}

function legend() {
  const l = el('p', 'viz-legend');
  for (const [cls, text] of [
    ['open', 'Aperte'],
    ['done', 'Completate'],
  ]) {
    const item = el('span', 'viz-legend__item');
    item.append(el('span', `swatch swatch--${cls}`), text);
    l.append(item);
  }
  return l;
}

export function renderDashboard(container, stats) {
  container.replaceChildren();
  const root = el('div', 'dashboard viz-root');
  const { totals } = stats;

  // numeri chiave: niente grafico, un numero grande per ciascuno
  const tiles = el('div', 'tiles');
  tiles.append(
    tile('Aperte', totals.open),
    tile('Completate', totals.done),
    tile('Scadute', totals.overdue, { tone: totals.overdue > 0 ? 'danger' : '' }),
    tile('Scadono oggi', totals.dueToday),
    tile('Archiviate', totals.archived),
    tile(
      'Tempo / stima',
      `${formatMinutes(totals.spentMin)} / ${formatMinutes(totals.estimateMin)}`,
      { tone: totals.estimateMin > 0 && totals.spentMin > totals.estimateMin ? 'danger' : '' },
    ),
  );
  root.append(tiles);

  const grid = el('div', 'viz-grid');

  // per colonna
  const byColumn = card('Attività per colonna', 'Attività non archiviate');
  const list = el('ul', 'bar-list');
  const maxColumn = Math.max(1, ...stats.perColumn.map((c) => c.count));
  for (const c of stats.perColumn) {
    const note = c.wipLimit
      ? c.count > c.wipLimit
        ? `limite ${c.wipLimit} superato`
        : `limite ${c.wipLimit}`
      : '';
    list.append(barRow(c.name, c.count, maxColumn, { color: c.isDone ? 'done' : 'open', note }));
  }
  byColumn.append(list);

  // per priorità (solo le aperte)
  const byPriority = card('Priorità', 'Attività aperte');
  const plist = el('ul', 'bar-list');
  const maxPriority = Math.max(1, ...Object.values(stats.perPriority));
  for (const p of ['high', 'medium', 'low']) {
    plist.append(barRow(PRIORITY_LABELS[p], stats.perPriority[p], maxPriority));
  }
  byPriority.append(plist);

  // completate negli ultimi 14 giorni: colonne con il valore sopra
  const perDay = card('Completate negli ultimi 14 giorni');
  const max = Math.max(1, ...stats.completedPerDay.map((d) => d.count));
  const total = stats.completedPerDay.reduce((n, d) => n + d.count, 0);
  perDay.append(
    el('p', 'viz-card__subtitle', plural(total, 'attività completata', 'attività completate')),
  );
  const columns = el('ol', 'col-chart');
  for (const day of stats.completedPerDay) {
    const item = el('li', 'col-chart__item');
    item.title = `${formatShortDate(day.date)}: ${day.count}`;
    item.append(el('span', 'col-chart__value', day.count > 0 ? String(day.count) : ''));
    const track = el('span', 'col-chart__track');
    const bar = el('span', 'bar bar--done');
    bar.style.height = `${day.count === 0 ? 0 : Math.max(6, Math.round((day.count / max) * 100))}%`;
    track.append(bar);
    item.append(track, el('span', 'col-chart__label', day.date.slice(8)));
    columns.append(item);
  }
  perDay.append(columns);

  // carico per persona: barra impilata (aperte + completate) e tabella
  const byPerson = card(
    'Carico per persona',
    'Attività non archiviate; una attività con più assegnatari conta per ciascuno',
  );
  byPerson.classList.add('viz-card--wide');
  byPerson.append(legend());
  const maxPerson = Math.max(1, ...stats.perAssignee.map((p) => p.open + p.done));
  const table = el('table', 'viz-table');
  const head = el('tr');
  for (const h of ['Persona', 'Aperte', 'Completate', 'Tempo', 'Stima'])
    head.append(el('th', null, h));
  const thead = el('thead');
  thead.append(head);
  table.append(thead);
  const body = el('tbody');
  for (const p of stats.perAssignee) {
    const row = el('tr');
    const who = el('td', 'viz-table__who');
    if (p.user) who.append(createAvatar(p.user, { size: 20 }), el('span', null, nameOf(p.user)));
    else who.append(el('span', 'detail__muted', 'Non assegnate'));
    const stack = el('span', 'stack');
    stack.style.width = `${Math.round(((p.open + p.done) / maxPerson) * 100)}%`;
    for (const [cls, n] of [
      ['open', p.open],
      ['done', p.done],
    ]) {
      if (n === 0) continue;
      const seg = el('span', `bar bar--${cls} stack__seg`);
      seg.style.flexGrow = String(n);
      seg.title = `${cls === 'open' ? 'Aperte' : 'Completate'}: ${n}`;
      stack.append(seg);
    }
    who.append(stack);
    row.append(
      who,
      el('td', null, String(p.open)),
      el('td', null, String(p.done)),
      el('td', null, formatMinutes(p.spentMin)),
      el('td', null, p.estimateMin ? formatMinutes(p.estimateMin) : '—'),
    );
    body.append(row);
  }
  if (stats.perAssignee.length === 0) {
    const empty = el('tr');
    const cell = el('td', 'detail__muted', 'Nessuna attività');
    cell.colSpan = 5;
    empty.append(cell);
    body.append(empty);
  }
  table.append(body);
  byPerson.append(table);

  grid.append(byColumn, byPriority, perDay, byPerson);
  root.append(grid);
  container.append(root);
}
