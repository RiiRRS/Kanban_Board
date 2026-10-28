import { PRIORITIES, PRIORITY_LABELS } from './constants.js';
import { isOverdue, isToday } from './format.js';

const DEBOUNCE_MS = 200;
const state = { text: '', priority: '', urgentOnly: false };

let searchInput = null;
let onSearchInput = null;
let suggestions = null;

// ignora maiuscole e accenti
function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function isUrgent(task) {
  return isOverdue(task) || (isToday(task.date) && task.status !== 'done');
}

function hasActiveFilters() {
  return state.text !== '' || state.priority !== '' || state.urgentOnly;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function initFilters(container, onChange) {
  state.text = '';
  state.priority = '';
  state.urgentOnly = false;

  const priorityLabel = el('label', 'visually-hidden', 'Filtra per priorità');
  priorityLabel.htmlFor = 'filter-priority';
  const priority = el('select', 'select');
  priority.id = 'filter-priority';
  priority.append(new Option('Tutte le priorità', ''));
  for (const p of PRIORITIES) priority.append(new Option(PRIORITY_LABELS[p], p));

  const urgentLabel = el('label', 'app-header__check');
  const urgent = el('input');
  urgent.type = 'checkbox';
  urgent.id = 'filter-urgent';
  urgentLabel.append(urgent, el('span', null, 'Solo urgenti'));

  const reset = el('button', 'btn btn--ghost', 'Azzera filtri');
  reset.type = 'button';
  reset.disabled = true;

  const refresh = () => {
    reset.disabled = !hasActiveFilters();
    onChange?.();
  };

  priority.addEventListener('change', () => {
    state.priority = priority.value;
    refresh();
  });
  urgent.addEventListener('change', () => {
    state.urgentOnly = urgent.checked;
    refresh();
  });

  // ricerca nell'input già presente in pagina, con debounce
  searchInput?.removeEventListener('input', onSearchInput);
  searchInput = document.getElementById('search-input');
  searchInput.value = '';
  suggestions = document.getElementById('search-suggestions');
  if (!suggestions) {
    suggestions = el('datalist');
    suggestions.id = 'search-suggestions';
    searchInput.after(suggestions);
  }
  searchInput.setAttribute('list', suggestions.id);
  let timer = null;
  onSearchInput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.text = normalize(searchInput.value).trim();
      refresh();
    }, DEBOUNCE_MS);
  };
  searchInput.addEventListener('input', onSearchInput);

  reset.addEventListener('click', () => {
    clearTimeout(timer);
    state.text = '';
    state.priority = '';
    state.urgentOnly = false;
    searchInput.value = '';
    priority.value = '';
    urgent.checked = false;
    refresh();
  });

  container.replaceChildren(priorityLabel, priority, urgentLabel, reset);
}

// ritorna un nuovo array con tutti i filtri applicati insieme
export function applyFilters(tasks) {
  return tasks.filter((task) => {
    if (state.priority && task.priority !== state.priority) return false;
    if (state.urgentOnly && !isUrgent(task)) return false;
    if (state.text) {
      const haystack = normalize(`${task.title} ${task.description}`);
      if (!haystack.includes(state.text)) return false;
    }
    return true;
  });
}

// suggerisce i titoli delle attività nel campo di ricerca
export function setSearchSuggestions(tasks) {
  if (!suggestions) return;
  const titles = [...new Set(tasks.map((t) => t.title))].sort((a, b) => a.localeCompare(b, 'it'));
  suggestions.replaceChildren(...titles.map((title) => new Option(title)));
}
