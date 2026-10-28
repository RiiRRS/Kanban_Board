// Disegno della board: colonne, card, menu "Sposta in…" e segnaposto di caricamento

import { PRIORITY_LABELS } from './constants.js';
import { formatShortDate, formatTimeRange, isOverdue, isToday } from './format.js';
import { formatMinutes } from './validation.js';
import { el, plural } from './dom.js';
import { createAvatarStack } from './avatar.js';

/* Menu "Sposta in..." */

let openMenu = null;

function closeMenu({ returnFocus = false } = {}) {
  if (!openMenu) return;
  const { menu, button } = openMenu;
  menu.hidden = true;
  menu.style.top = '';
  menu.style.left = '';
  button.setAttribute('aria-expanded', 'false');
  openMenu = null;
  if (returnFocus) button.focus();
}

// il menu è position: fixed (la lista scorre e taglierebbe un popup assoluto)
function positionMenu(menu, button) {
  const gap = 4;
  const margin = 8;
  const b = button.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const left = Math.min(Math.max(b.right - m.width, margin), window.innerWidth - m.width - margin);
  let top = b.bottom + gap;
  if (top + m.height > window.innerHeight - margin) {
    top = Math.max(b.top - gap - m.height, margin);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function showMenu(menu, button) {
  closeMenu();
  menu.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  positionMenu(menu, button);
  openMenu = { menu, button };
  menu.querySelector('button')?.focus();
}

function moveMenuFocus(menu, key) {
  const items = [...menu.querySelectorAll('button')];
  const index = items.indexOf(document.activeElement);
  let next = index;
  if (key === 'ArrowDown') next = (index + 1) % items.length;
  if (key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
  if (key === 'Home') next = 0;
  if (key === 'End') next = items.length - 1;
  items[next]?.focus();
}

// listener globali registrati una sola volta
document.addEventListener('click', (e) => {
  if (openMenu && !openMenu.menu.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openMenu) {
    e.preventDefault();
    closeMenu({ returnFocus: true });
  }
});
window.addEventListener('resize', () => closeMenu());
window.addEventListener('scroll', () => closeMenu(), true);

// voci: [{ label, onSelect, moveTo? }]
function buildMenu(entries) {
  const menu = el('ul', 'card__menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  for (const entry of entries) {
    const item = el('li');
    item.setAttribute('role', 'none');
    const choice = el('button', null, entry.label);
    choice.type = 'button';
    choice.setAttribute('role', 'menuitem');
    if (entry.moveTo != null) choice.dataset.moveTo = entry.moveTo;
    choice.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
      entry.onSelect();
    });
    item.append(choice);
    menu.append(item);
  }

  menu.addEventListener('click', (e) => e.stopPropagation());
  menu.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      moveMenuFocus(menu, e.key);
    } else if (e.key === 'Tab') {
      closeMenu();
    }
  });
  return menu;
}

/* Card e colonne */

// barra di avanzamento sottile con un'etichetta (es. "1/3")
function progress(label, done, total, title) {
  const wrap = el('div', 'progress');
  wrap.title = title;
  const bar = el('div', 'progress__bar');
  const fill = el('div', 'progress__fill');
  fill.style.width = `${total === 0 ? 0 : Math.round((done / total) * 100)}%`;
  if (done === total) fill.classList.add('progress__fill--complete');
  bar.append(fill);
  wrap.append(el('span', 'progress__label', label), bar);
  return wrap;
}

function buildCard(task, byId, columns, { onOpenTask, onMoveTask, onArchiveTask, archivedView }) {
  const overdue = isOverdue(task);
  const done = task.isDone;
  const today = isToday(task.date) && !done && !overdue;
  const range = formatTimeRange(task.startTime, task.endTime);
  const shortDate = formatShortDate(task.date);

  const card = el('article', 'card');
  if (overdue) card.classList.add('card--overdue');
  if (today) card.classList.add('card--today');
  if (done) card.classList.add('card--done');
  // le attività in archivio si guardano e si ripristinano, ma non si trascinano
  if (archivedView) card.classList.add('card--static');
  card.dataset.taskId = task.id;
  card.draggable = !archivedView;
  card.tabIndex = 0;
  card.setAttribute('aria-label', `${task.title}, ${shortDate} ${range}`);

  const color = el('div', 'card__color');
  color.style.background = task.color;

  const body = el('div', 'card__body');
  body.append(el('h3', 'card__title', task.title));
  body.append(el('p', 'card__meta', `${shortDate} · ${range}`));

  const parent = task.parentId != null ? byId.get(task.parentId) : null;
  if (parent) body.append(el('p', 'card__parent', `↑ ${parent.title}`));

  if (task.labels.length > 0) {
    const labels = el('div', 'card__labels');
    for (const label of task.labels) {
      const chip = el('span', 'label-chip', label.name);
      chip.style.setProperty('--label-color', label.color);
      labels.append(chip);
    }
    body.append(labels);
  }

  if (task.checklistTotal > 0) {
    body.append(
      progress(
        `☑ ${task.checklistDone}/${task.checklistTotal}`,
        task.checklistDone,
        task.checklistTotal,
        `Checklist: ${task.checklistDone} voci su ${task.checklistTotal}`,
      ),
    );
  }
  if (task.childCount > 0) {
    body.append(
      progress(
        `⤷ ${task.childDoneCount}/${task.childCount}`,
        task.childDoneCount,
        task.childCount,
        `Sotto-attività: ${task.childDoneCount} completate su ${task.childCount}`,
      ),
    );
  }

  const badges = el('div', 'card__badges');
  badges.append(
    el('span', `badge badge--priority-${task.priority}`, PRIORITY_LABELS[task.priority]),
  );
  if (overdue) badges.append(el('span', 'badge badge--danger', 'Scaduta'));
  if (task.recurrence !== 'none') {
    const repeat = el('span', 'badge', '↻');
    repeat.title = 'Attività ricorrente';
    badges.append(repeat);
  }
  if (task.estimateMin != null || task.spentMin > 0) {
    const over = task.estimateMin != null && task.spentMin > task.estimateMin;
    const time = el(
      'span',
      `badge${over ? ' badge--danger' : ''}`,
      `⏱ ${formatMinutes(task.spentMin)}${task.estimateMin != null ? ` / ${formatMinutes(task.estimateMin)}` : ''}`,
    );
    time.title = over ? 'Tempo oltre la stima' : 'Tempo effettivo / stima';
    badges.append(time);
  }
  if (task.commentCount > 0) {
    badges.append(el('span', 'badge', plural(task.commentCount, 'commento', 'commenti')));
  }
  if (task.attachmentCount > 0) {
    badges.append(el('span', 'badge', `📎 ${task.attachmentCount}`));
  }
  body.append(badges);

  if (task.assignees.length > 0) {
    const footer = el('div', 'card__footer');
    footer.append(createAvatarStack(task.assignees));
    body.append(footer);
  }

  const menuButton = el('button', 'card__menu-button btn btn--ghost btn--icon', '⋯');
  menuButton.type = 'button';
  menuButton.draggable = false;
  menuButton.setAttribute('aria-label', 'Azioni');
  menuButton.setAttribute('aria-haspopup', 'menu');
  menuButton.setAttribute('aria-expanded', 'false');

  const entries = [];
  if (!archivedView) {
    for (const column of columns) {
      if (column.id === task.columnId) continue;
      entries.push({
        label: `Sposta in: ${column.name}`,
        moveTo: column.id,
        onSelect: () => onMoveTask?.(task.id, column.id),
      });
    }
  }
  entries.push({
    label: archivedView ? 'Ripristina dall’archivio' : 'Archivia',
    onSelect: () => onArchiveTask?.(task.id, !archivedView),
  });
  const menu = buildMenu(entries);

  menuButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openMenu && openMenu.menu === menu) closeMenu();
    else showMenu(menu, menuButton);
  });

  card.addEventListener('click', () => onOpenTask?.(task.id));
  card.addEventListener('keydown', (e) => {
    if (e.target !== card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenTask?.(task.id);
    }
  });

  card.append(color, body, menuButton, menu);
  return card;
}

function buildColumn(column, tasks, byId, columns, handlers) {
  const { archivedView } = handlers;
  const section = el('section', 'column');
  section.dataset.columnId = column.id;
  if (column.isDone) section.classList.add('column--done');
  section.setAttribute('aria-labelledby', `column-title-${column.id}`);

  const header = el('div', 'column__header');
  const title = el('h2', 'column__title', column.name);
  title.id = `column-title-${column.id}`;

  // con il limite WIP il contatore diventa "3/4" e le tacche sotto si riempiono fino al limite
  const limit = column.wipLimit;
  const wip = limit && !archivedView;
  const count = el('span', 'column__count', String(tasks.length));
  if (limit) count.append(el('span', 'column__limit', `/${limit}`));
  if (wip) {
    if (tasks.length > limit) count.classList.add('column__count--over');
    count.title = `Limite WIP: ${limit}`;
  }
  count.setAttribute(
    'aria-label',
    `${plural(tasks.length, 'attività', 'attività')}${limit ? `, limite ${limit}` : ''}`,
  );

  const meter = el('div', 'column__meter');
  meter.setAttribute('aria-hidden', 'true');
  const cells = wip ? Math.max(limit, tasks.length) : 1;
  for (let i = 0; i < cells; i++) {
    const on = wip ? i < tasks.length : tasks.length > 0;
    meter.append(el('span', `column__meter-cell${on ? ' column__meter-cell--on' : ''}`));
  }
  if (wip && tasks.length > limit) meter.classList.add('column__meter--over');
  else if (wip && tasks.length === limit) meter.classList.add('column__meter--full');

  const actions = el('div', 'column__actions');
  if (!archivedView) {
    if (column.isDone && tasks.length > 0) {
      const archive = el('button', 'column__archive btn btn--ghost', 'Archivia');
      archive.type = 'button';
      archive.title = 'Archivia tutte le attività completate';
      archive.addEventListener('click', () => handlers.onArchiveDone?.());
      actions.append(archive);
    }
    const add = el('button', 'column__add btn btn--ghost btn--icon', '+');
    add.type = 'button';
    add.dataset.columnId = column.id;
    add.setAttribute('aria-label', `Aggiungi attività in ${column.name}`);
    add.addEventListener('click', () => handlers.onAddTask?.(column.id));
    actions.append(add);
  }
  header.append(title, count, actions, meter);

  const list = el('div', 'column__list');
  list.dataset.columnId = column.id;
  if (tasks.length === 0) {
    list.append(
      el('p', 'column__empty', archivedView ? 'Nessuna attività archiviata' : 'Nessuna attività'),
    );
  }
  for (const task of tasks) list.append(buildCard(task, byId, columns, handlers));

  section.append(header, list);
  return section;
}

export function renderBoard(
  container,
  tasks,
  {
    columns = [],
    allTasks = tasks,
    archivedView = false,
    onOpenTask,
    onAddTask,
    onMoveTask,
    onArchiveTask,
    onArchiveDone,
  } = {},
) {
  closeMenu();
  container.replaceChildren();
  container.removeAttribute('aria-busy');

  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const handlers = {
    onOpenTask,
    onAddTask,
    onMoveTask,
    onArchiveTask,
    onArchiveDone,
    archivedView,
  };
  const fragment = document.createDocumentFragment();

  for (const column of columns) {
    const columnTasks = tasks
      .filter((t) => t.columnId === column.id)
      .sort((a, b) => a.position - b.position || a.id - b.id);
    fragment.append(buildColumn(column, columnTasks, byId, columns, handlers));
  }
  container.append(fragment);
}

export function renderBoardLoading(
  container,
  names = ['Da fare', 'In corso', 'In revisione', 'Fatto'],
) {
  closeMenu();
  container.replaceChildren();
  container.setAttribute('aria-busy', 'true');

  const fragment = document.createDocumentFragment();
  for (const name of names) {
    const column = el('section', 'column');
    const header = el('div', 'column__header');
    header.append(el('h2', 'column__title', name));
    const list = el('div', 'column__list');
    for (let i = 0; i < 3; i++) list.append(el('div', 'card card--skeleton'));
    column.append(header, list);
    fragment.append(column);
  }
  fragment.append(el('p', 'visually-hidden', 'Caricamento…'));
  container.append(fragment);
}
