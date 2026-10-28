import { STATUSES, STATUS_LABELS, PRIORITY_LABELS } from './constants.js';
import { formatShortDate, formatTimeRange, isOverdue, isToday } from './format.js';

// crea un elemento con classe e testo (textContent è sempre sicuro)
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

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

function buildMenu(task, button, onMoveTask) {
  const menu = el('ul', 'card__menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  for (const status of STATUSES) {
    if (status === task.status) continue;
    const item = el('li');
    item.setAttribute('role', 'none');
    const choice = el('button', null, `Sposta in: ${STATUS_LABELS[status]}`);
    choice.type = 'button';
    choice.setAttribute('role', 'menuitem');
    choice.dataset.moveTo = status;
    choice.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
      onMoveTask?.(task.id, status);
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

function buildCard(task, byId, { onOpenTask, onMoveTask }) {
  const overdue = isOverdue(task);
  const done = task.status === 'done';
  const today = isToday(task.date) && !done && !overdue;
  const range = formatTimeRange(task.startTime, task.endTime);
  const shortDate = formatShortDate(task.date);

  const card = el('article', 'card');
  if (overdue) card.classList.add('card--overdue');
  if (today) card.classList.add('card--today');
  if (done) card.classList.add('card--done');
  card.dataset.taskId = task.id;
  card.draggable = true;
  card.tabIndex = 0;
  card.setAttribute('aria-label', `${task.title}, ${shortDate} ${range}`);

  const color = el('div', 'card__color');
  color.style.background = task.color;

  const body = el('div', 'card__body');
  body.append(el('h3', 'card__title', task.title));
  body.append(el('p', 'card__meta', `${shortDate} · ${range}`));

  const parent = task.parentId != null ? byId.get(task.parentId) : null;
  if (parent) body.append(el('p', 'card__parent', `↑ ${parent.title}`));

  const badges = el('div', 'card__badges');
  badges.append(
    el('span', `badge badge--priority-${task.priority}`, PRIORITY_LABELS[task.priority]),
  );
  if (overdue) badges.append(el('span', 'badge badge--danger', 'Scaduta'));
  if (task.commentCount > 0) {
    badges.append(el('span', 'badge', plural(task.commentCount, 'commento', 'commenti')));
  }
  if (task.childCount > 0) {
    badges.append(el('span', 'badge', plural(task.childCount, 'sotto-attività', 'sotto-attività')));
  }
  body.append(badges);

  const menuButton = el('button', 'card__menu-button btn btn--ghost btn--icon', '⋯');
  menuButton.type = 'button';
  menuButton.draggable = false;
  menuButton.setAttribute('aria-label', 'Azioni');
  menuButton.setAttribute('aria-haspopup', 'menu');
  menuButton.setAttribute('aria-expanded', 'false');

  const menu = buildMenu(task, menuButton, onMoveTask);

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

function buildColumn(status, tasks, byId, handlers) {
  const column = el('section', 'column');
  column.dataset.status = status;
  column.setAttribute('aria-labelledby', `column-title-${status}`);

  const header = el('div', 'column__header');
  const title = el('h2', 'column__title', STATUS_LABELS[status]);
  title.id = `column-title-${status}`;
  const count = el('span', 'column__count', String(tasks.length));
  count.setAttribute('aria-label', `${tasks.length} attività`);
  const add = el('button', 'column__add btn btn--ghost btn--icon', '+');
  add.type = 'button';
  add.dataset.status = status;
  add.setAttribute('aria-label', `Aggiungi attività in ${STATUS_LABELS[status]}`);
  add.addEventListener('click', () => handlers.onAddTask?.(status));
  header.append(title, count, add);

  const list = el('div', 'column__list');
  list.dataset.status = status;
  if (tasks.length === 0) {
    list.append(el('p', 'column__empty', 'Nessuna attività'));
  }
  for (const task of tasks) list.append(buildCard(task, byId, handlers));

  column.append(header, list);
  return column;
}

export function renderBoard(
  container,
  tasks,
  { allTasks = tasks, onOpenTask, onAddTask, onMoveTask } = {},
) {
  closeMenu();
  container.replaceChildren();
  container.removeAttribute('aria-busy');

  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const handlers = { onOpenTask, onAddTask, onMoveTask };
  const fragment = document.createDocumentFragment();

  for (const status of STATUSES) {
    const columnTasks = tasks
      .filter((t) => t.status === status)
      .sort((a, b) => a.position - b.position || a.id - b.id);
    fragment.append(buildColumn(status, columnTasks, byId, handlers));
  }
  container.append(fragment);
}

export function renderBoardLoading(container) {
  closeMenu();
  container.replaceChildren();
  container.setAttribute('aria-busy', 'true');

  const fragment = document.createDocumentFragment();
  for (const status of STATUSES) {
    const column = el('section', 'column');
    column.dataset.status = status;
    const header = el('div', 'column__header');
    header.append(el('h2', 'column__title', STATUS_LABELS[status]));
    const list = el('div', 'column__list');
    for (let i = 0; i < 3; i++) list.append(el('div', 'card card--skeleton'));
    column.append(header, list);
    fragment.append(column);
  }
  fragment.append(el('p', 'visually-hidden', 'Caricamento…'));
  container.append(fragment);
}
