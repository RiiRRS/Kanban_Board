// Vista calendario: mese (griglia) e settimana (timeline oraria). Il filtro della board vale
// anche qui: si vedono le stesse attività.

import { el, button } from './dom.js';
import { todayISO, addDays, startOfWeek } from './format.js';

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const FIRST_HOUR = 6;
const LAST_HOUR = 22;
const HOUR_PX = 48;
const MAX_PER_CELL = 3;

const monthName = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });
const dayName = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });

const view = { mode: 'month', anchor: todayISO() };

const parse = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

function title() {
  if (view.mode === 'month') {
    const text = monthName.format(parse(view.anchor));
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const first = startOfWeek(view.anchor);
  return `${dayName.format(parse(first))} – ${dayName.format(parse(addDays(first, 6)))} ${parse(addDays(first, 6)).getFullYear()}`;
}

function shift(direction) {
  if (view.mode === 'month') {
    const d = parse(view.anchor);
    d.setDate(1);
    d.setMonth(d.getMonth() + direction);
    view.anchor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  } else {
    view.anchor = addDays(view.anchor, 7 * direction);
  }
}

function chip(task, onOpenTask) {
  const b = el('button', `cal-task${task.isDone ? ' cal-task--done' : ''}`);
  b.type = 'button';
  b.style.setProperty('--task-color', task.color);
  b.append(el('span', 'cal-task__time', task.startTime), ` ${task.title}`);
  b.title = `${task.title} (${task.startTime}–${task.endTime})`;
  b.addEventListener('click', () => onOpenTask?.(task.id));
  return b;
}

function monthGrid(tasks, { onOpenTask, onAddTask }, rerender) {
  const anchor = parse(view.anchor);
  const firstOfMonth = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}-01`;
  const start = startOfWeek(firstOfMonth);
  const today = todayISO();
  const grid = el('div', 'cal-month');
  for (const name of WEEKDAYS) grid.append(el('div', 'cal-weekday', name));

  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    const inMonth = date.slice(0, 7) === firstOfMonth.slice(0, 7);
    // l'ultima riga si salta se è tutta del mese dopo
    if (i >= 35 && !inMonth) break;

    const cell = el('div', 'cal-cell');
    if (!inMonth) cell.classList.add('cal-cell--outside');
    if (date === today) cell.classList.add('cal-cell--today');

    const head = el('div', 'cal-cell__head');
    head.append(el('span', 'cal-cell__day', String(Number(date.slice(8)))));
    const add = button('+', 'btn btn--ghost btn--icon cal-cell__add', () => onAddTask?.(date));
    add.setAttribute('aria-label', `Nuova attività il ${date}`);
    head.append(add);
    cell.append(head);

    const day = tasks
      .filter((t) => t.date === date)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (const t of day.slice(0, MAX_PER_CELL)) cell.append(chip(t, onOpenTask));
    if (day.length > MAX_PER_CELL) {
      const more = button(`+${day.length - MAX_PER_CELL} altre`, 'detail__link', () => {
        view.mode = 'week';
        view.anchor = date;
        rerender();
      });
      cell.append(more);
    }
    grid.append(cell);
  }
  return grid;
}

// attività sovrapposte nello stesso giorno: affiancate in "corsie"
function assignLanes(day) {
  const lanes = [];
  const placed = day.map((t) => {
    const start = toMinutes(t.startTime);
    let lane = lanes.findIndex((end) => end <= start);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = toMinutes(t.endTime);
    return { task: t, lane };
  });
  return { placed, count: Math.max(1, lanes.length) };
}

function weekTimeline(tasks, { onOpenTask, onAddTask }) {
  const start = startOfWeek(view.anchor);
  const today = todayISO();
  const wrap = el('div', 'cal-week');

  const hours = el('div', 'cal-week__hours');
  hours.append(el('div', 'cal-week__corner'));
  const hoursBody = el('div', 'cal-week__hours-body');
  hoursBody.style.height = `${(LAST_HOUR - FIRST_HOUR) * HOUR_PX}px`;
  for (let h = FIRST_HOUR; h < LAST_HOUR; h++) {
    const label = el('span', 'cal-week__hour', `${String(h).padStart(2, '0')}:00`);
    label.style.top = `${(h - FIRST_HOUR) * HOUR_PX}px`;
    hoursBody.append(label);
  }
  hours.append(hoursBody);
  wrap.append(hours);

  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const col = el('div', `cal-week__day${date === today ? ' cal-week__day--today' : ''}`);
    const head = el('div', 'cal-week__head');
    head.append(
      el('span', null, `${WEEKDAYS[i]} ${Number(date.slice(8))}`),
      (() => {
        const add = button('+', 'btn btn--ghost btn--icon', () => onAddTask?.(date));
        add.setAttribute('aria-label', `Nuova attività il ${date}`);
        return add;
      })(),
    );
    const body = el('div', 'cal-week__body');
    body.style.height = `${(LAST_HOUR - FIRST_HOUR) * HOUR_PX}px`;

    const day = tasks
      .filter((t) => t.date === date)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    const { placed, count } = assignLanes(day);
    for (const { task, lane } of placed) {
      const from = Math.max(toMinutes(task.startTime), FIRST_HOUR * 60);
      const to = Math.min(toMinutes(task.endTime), LAST_HOUR * 60);
      if (to <= from) continue; // fuori dall'orario mostrato
      const block = chip(task, onOpenTask);
      block.classList.add('cal-block');
      block.style.top = `${((from - FIRST_HOUR * 60) / 60) * HOUR_PX}px`;
      block.style.height = `${Math.max(22, ((to - from) / 60) * HOUR_PX - 2)}px`;
      block.style.left = `${(lane / count) * 100}%`;
      block.style.width = `calc(${100 / count}% - 2px)`;
      body.append(block);
    }
    col.append(head, body);
    wrap.append(col);
  }
  return wrap;
}

export function renderCalendar(container, tasks, handlers) {
  const render = () => renderCalendar(container, tasks, handlers);
  container.replaceChildren();
  const root = el('div', 'calendar');

  const bar = el('div', 'calendar__bar');
  const nav = el('div', 'calendar__nav');
  const prev = button('‹', 'btn btn--secondary btn--icon', () => {
    shift(-1);
    render();
  });
  prev.setAttribute(
    'aria-label',
    view.mode === 'month' ? 'Mese precedente' : 'Settimana precedente',
  );
  const next = button('›', 'btn btn--secondary btn--icon', () => {
    shift(1);
    render();
  });
  next.setAttribute(
    'aria-label',
    view.mode === 'month' ? 'Mese successivo' : 'Settimana successiva',
  );
  nav.append(
    prev,
    button('Oggi', 'btn btn--secondary', () => {
      view.anchor = todayISO();
      render();
    }),
    next,
  );
  const heading = el('h2', 'calendar__title', title());
  heading.setAttribute('aria-live', 'polite');

  const modes = el('div', 'segmented');
  for (const [mode, text] of [
    ['month', 'Mese'],
    ['week', 'Settimana'],
  ]) {
    const b = button(text, 'btn btn--secondary', () => {
      view.mode = mode;
      render();
    });
    b.setAttribute('aria-pressed', String(view.mode === mode));
    modes.append(b);
  }
  bar.append(nav, heading, modes);

  root.append(
    bar,
    view.mode === 'month' ? monthGrid(tasks, handlers, render) : weekTimeline(tasks, handlers),
  );
  container.append(root);
}
