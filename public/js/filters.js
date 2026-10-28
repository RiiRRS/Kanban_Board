import { PRIORITIES, PRIORITY_LABELS } from './constants.js';
import { isOverdue, isToday } from './format.js';
import { el } from './dom.js';

const DEBOUNCE_MS = 200;
const state = { text: '', priority: '', labelId: '', urgentOnly: false, mineOnly: false };

let searchInput = null;
let onSearchInput = null;
let suggestions = null;
let labelSelect = null;
let currentUserId = null;

// ignora maiuscole e accenti
function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function isUrgent(task) {
  return isOverdue(task) || (isToday(task.date) && !task.isDone);
}

function hasActiveFilters() {
  return (
    state.text !== '' ||
    state.priority !== '' ||
    state.labelId !== '' ||
    state.urgentOnly ||
    state.mineOnly
  );
}

export function initFilters(container, onChange, { userId } = {}) {
  currentUserId = userId ?? null;
  Object.assign(state, { text: '', priority: '', labelId: '', urgentOnly: false, mineOnly: false });

  const priorityLabel = el('label', 'visually-hidden', 'Filtra per priorità');
  priorityLabel.htmlFor = 'filter-priority';
  const priority = el('select', 'select');
  priority.id = 'filter-priority';
  priority.append(new Option('Tutte le priorità', ''));
  for (const p of PRIORITIES) priority.append(new Option(PRIORITY_LABELS[p], p));

  const labelLabel = el('label', 'visually-hidden', 'Filtra per etichetta');
  labelLabel.htmlFor = 'filter-label';
  labelSelect = el('select', 'select');
  labelSelect.id = 'filter-label';
  labelSelect.append(new Option('Tutte le etichette', ''));

  const check = (id, text) => {
    const label = el('label', 'filter-check');
    const input = el('input');
    input.type = 'checkbox';
    input.id = id;
    label.append(input, el('span', null, text));
    return { label, input };
  };
  const mine = check('filter-mine', 'Solo miei');
  const urgent = check('filter-urgent', 'Solo urgenti');

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
  labelSelect.addEventListener('change', () => {
    state.labelId = labelSelect.value;
    refresh();
  });
  mine.input.addEventListener('change', () => {
    state.mineOnly = mine.input.checked;
    refresh();
  });
  urgent.input.addEventListener('change', () => {
    state.urgentOnly = urgent.input.checked;
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
    Object.assign(state, {
      text: '',
      priority: '',
      labelId: '',
      urgentOnly: false,
      mineOnly: false,
    });
    searchInput.value = '';
    priority.value = '';
    labelSelect.value = '';
    mine.input.checked = false;
    urgent.input.checked = false;
    refresh();
  });

  container.replaceChildren(
    priorityLabel,
    priority,
    labelLabel,
    labelSelect,
    mine.label,
    urgent.label,
    reset,
  );
}

// le etichette cambiano da una board all'altra: il filtro scelto vale solo se esiste ancora
export function setFilterLabels(labels) {
  if (!labelSelect) return;
  labelSelect.replaceChildren(new Option('Tutte le etichette', ''));
  for (const l of labels) labelSelect.append(new Option(l.name, String(l.id)));
  if (!labels.some((l) => String(l.id) === state.labelId)) state.labelId = '';
  labelSelect.value = state.labelId;
}

// ritorna un nuovo array con tutti i filtri applicati insieme
export function applyFilters(tasks) {
  return tasks.filter((task) => {
    if (state.priority && task.priority !== state.priority) return false;
    if (state.urgentOnly && !isUrgent(task)) return false;
    if (state.mineOnly && !task.assignees.some((a) => a.id === currentUserId)) return false;
    if (state.labelId && !task.labels.some((l) => String(l.id) === state.labelId)) return false;
    if (state.text) {
      const labels = task.labels.map((l) => l.name).join(' ');
      const haystack = normalize(`${task.title} ${task.description} ${labels}`);
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
