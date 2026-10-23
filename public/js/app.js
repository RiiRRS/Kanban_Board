// Avvio della board: collega tutti i moduli tramite le loro funzioni esportate.
// Quando un modulo sostituisce il suo segnaposto, il suo lavoro compare da solo nella pagina.

import { getMe, logout, getTasks, moveTask, ApiError } from './api.js';
import { renderBoard, renderBoardLoading } from './board.js';
import { enableDragAndDrop } from './dnd.js';
import { initTheme } from './theme.js';
import { openTaskForm } from './taskForm.js';
import { openTaskDetail } from './taskDetail.js';
import { showToast } from './ui.js';

const state = { user: null, tasks: [] };
const boardEl = document.getElementById('board');

async function main() {
  initTheme(document.getElementById('theme-toggle'));
  state.user = await getMe();
  if (!state.user) return location.replace('login.html');

  document.getElementById('current-user').textContent = state.user.username;
  document.getElementById('logout-button').addEventListener('click', onLogout);
  document.getElementById('new-task-button').addEventListener('click', () => onAddTask('todo'));

  renderBoardLoading(boardEl);
  enableDragAndDrop(boardEl, { onDrop: onMove });
  await refresh();
}

async function refresh() {
  try {
    const tasks = await getTasks({ onCache: (cached) => setTasks(cached) });
    setTasks(tasks);
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : 'Errore imprevisto', 'error');
  }
}

function setTasks(tasks) {
  if (JSON.stringify(tasks) === JSON.stringify(state.tasks)) return; // niente render inutili
  state.tasks = tasks;
  render();
}

function render() {
  renderBoard(boardEl, state.tasks, { allTasks: state.tasks, onOpenTask, onAddTask, onMoveTask });
}

function onOpenTask(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
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

async function onMove(taskId, status, position) {
  try {
    await moveTask(taskId, status, position);
  } catch (err) {
    showToast(err.message, 'error');
  }
  await refresh(); // se c'è stato un errore, rimette la board come sul server
}

async function onLogout() {
  await logout();
  location.replace('login.html');
}

main();
