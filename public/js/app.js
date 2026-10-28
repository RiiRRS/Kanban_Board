// Avvio della board: collega tutti i moduli tramite le loro funzioni esportate.
// Quando un modulo sostituisce il suo segnaposto, il suo lavoro compare da solo nella pagina.

import { getMe, logout, getTasks, moveTask, ApiError } from './api.js';
import { renderBoard, renderBoardLoading } from './board.js';
import { enableDragAndDrop } from './dnd.js';
import { initTheme } from './theme.js';
import { openTaskForm } from './taskForm.js';
import { openTaskDetail } from './taskDetail.js';
import { showToast } from './ui.js';
import { initFilters, applyFilters, setSearchSuggestions } from './filters.js';
import { initShortcuts } from './shortcuts.js';

const state = { user: null, tasks: [] };
const boardEl = document.getElementById('board');
const bannerEl = document.getElementById('status-banner');

let refreshing = null; // ricaricamento in corso: un secondo ricaricamento aspetta il primo

async function main() {
  initTheme(document.getElementById('theme-toggle'));
  state.user = await getMe();
  if (!state.user) return location.replace('login.html');

  document.title = `Kanban Board · ${state.user.username}`;
  document.getElementById('current-user').textContent = state.user.username;
  document.getElementById('logout-button').addEventListener('click', onLogout);
  document.getElementById('new-task-button').addEventListener('click', () => onAddTask('todo'));

  initFilters(document.getElementById('filters'), render);
  initShortcuts({
    onNewTask: () => onAddTask('todo'),
    onFocusSearch: () => document.getElementById('search-input').focus(),
  });

  window.addEventListener('offline', showOfflineBanner);
  window.addEventListener('online', () => {
    hideBanner();
    refresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  if (!navigator.onLine) showOfflineBanner();

  renderBoardLoading(boardEl);
  enableDragAndDrop(boardEl, { onDrop });
  await refresh();
}

function showOfflineBanner() {
  bannerEl.textContent = 'Sei offline: le modifiche non verranno salvate.';
  bannerEl.dataset.type = 'warning';
  bannerEl.hidden = false;
}

function hideBanner() {
  bannerEl.hidden = true;
  bannerEl.textContent = '';
  delete bannerEl.dataset.type;
}

function refresh() {
  refreshing ??= load().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function load() {
  try {
    const tasks = await getTasks({ onCache: (cached) => setTasks(cached) });
    setTasks(tasks);
    if (navigator.onLine) hideBanner();
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) showOfflineBanner();
    showToast(err instanceof ApiError ? err.message : 'Errore imprevisto', 'error');
  }
}

function setTasks(tasks) {
  if (JSON.stringify(tasks) === JSON.stringify(state.tasks)) return; // niente render inutili
  state.tasks = tasks;
  render();
}

function render() {
  setSearchSuggestions(state.tasks);
  renderBoard(boardEl, applyFilters(state.tasks), {
    allTasks: state.tasks,
    onOpenTask,
    onAddTask,
    onMoveTask,
  });
}

function onOpenTask(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) {
    showToast('Attività non trovata', 'error');
    refresh();
    return;
  }
  openTaskDetail({
    task,
    allTasks: state.tasks,
    currentUser: state.user,
    onEdit: (t) => openTaskForm({ task: t, allTasks: state.tasks, onSaved: refresh }),
    onDeleted: refresh,
    onOpenTask,
    onCommentAdded: refresh,
  });
}

function onAddTask(status) {
  openTaskForm({ status, allTasks: state.tasks, onSaved: refresh });
}

// "Sposta in…" mette l'attività in fondo alla colonna
function onMoveTask(taskId, status) {
  const position = state.tasks.filter((t) => t.status === status && t.id !== taskId).length;
  return onMove(taskId, status, position);
}

// posizione tra TUTTE le attività della colonna (i filtri nascondono delle card):
// prima della card successiva, oppure in fondo
function toServerPosition(taskId, status, afterId) {
  const column = state.tasks
    .filter((t) => t.status === status && t.id !== taskId)
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const index = afterId == null ? -1 : column.findIndex((t) => t.id === afterId);
  return index === -1 ? column.length : index;
}

async function onDrop(taskId, status, _visiblePosition, afterId) {
  return onMove(taskId, status, toServerPosition(taskId, status, afterId));
}

async function onMove(taskId, status, position) {
  try {
    await moveTask(taskId, status, position);
  } catch (err) {
    showToast(err.message, 'error');
  }
  await refreshing; // un ricaricamento già partito sarebbe precedente allo spostamento
  await refresh(); // se c'è stato un errore, rimette la board come sul server
}

async function onLogout() {
  await logout();
  location.replace('login.html');
}

main();
