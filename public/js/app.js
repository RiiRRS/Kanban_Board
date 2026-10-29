// Avvio della board: collega tutti i moduli tramite le loro funzioni esportate.
// Tiene lo stato (utente, board, attività, vista) e ridisegna quando cambia.

import {
  getMe,
  getUsers,
  logout,
  getBoards,
  getBoard,
  getBoardTasks,
  getStats,
  createBoard,
  moveTask,
  archiveTask,
  archiveDone,
  connectRealtime,
  ApiError,
} from './api.js';
import { renderBoard, renderBoardLoading } from './board.js';
import { enableDragAndDrop } from './dnd.js';
import { initTheme, getTheme, setTheme } from './theme.js';
import { openTaskForm } from './taskForm.js';
import { openTaskDetail } from './taskDetail.js';
import { openBoardSettings } from './manage.js';
import { initAccessibility, openAccessibility } from './accessibility.js';
import { openProfile } from './profile.js';
import { initNotifications } from './notifications.js';
import { renderCalendar } from './calendar.js';
import { renderDashboard } from './dashboard.js';
import { renderActivity } from './activity.js';
import { showToast, promptDialog, confirmDialog } from './ui.js';
import { initFilters, applyFilters, setSearchSuggestions, setFilterLabels } from './filters.js';
import { initShortcuts } from './shortcuts.js';
import { withConfirmation, Cancelled } from './confirmFlow.js';
import { createAvatar, nameOf } from './avatar.js';
import { readPrefs, setPref } from './prefs.js';
import { errorMessage } from './dom.js';
import { hydrateIcons } from './icons.js';

const state = {
  user: null,
  users: [],
  boards: [],
  boardId: null,
  board: null, // { id, name, columns, labels }
  tasks: [],
  archived: false, // mostra l'archivio invece della board
  view: 'board', // board | calendar | dashboard | activity
};

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const viewEl = $('view');
const bannerEl = $('status-banner');
const boardSelect = $('board-select');

let refreshing = null; // ricaricamento in corso: un secondo ricaricamento aspetta il primo
let notifications = null;
let renderToken = 0; // una vista che si carica in ritardo non deve sovrascrivere quella nuova

async function main() {
  hydrateIcons();
  initTheme($('theme-toggle'));
  initAccessibility();
  $('a11y-button').addEventListener('click', openAccessibility);
  state.user = await getMe();
  if (!state.user) return location.replace('login.html');

  document.title = `Kanban Board · ${state.user.username}`;
  drawUser();
  $('logout-button').addEventListener('click', onLogout);
  $('new-task-button').addEventListener('click', () => onAddTask());
  $('profile-button').addEventListener('click', () =>
    openProfile({
      user: state.user,
      onUpdated: (user) => {
        state.user = user;
        drawUser();
        refresh();
      },
    }),
  );
  $('board-settings').addEventListener('click', openSettings);
  $('board-new').addEventListener('click', onNewBoard);
  boardSelect.addEventListener('change', () => switchBoard(Number(boardSelect.value)));

  for (const tab of document.querySelectorAll('.nav-item[data-view]')) {
    tab.addEventListener('click', () => {
      switchView(tab.dataset.view);
      setNavOpen(false);
    });
  }
  $('nav-open').addEventListener('click', () => setNavOpen(true));
  $('nav-close').addEventListener('click', () => setNavOpen(false));
  document.querySelector('[data-nav-close]').addEventListener('click', () => setNavOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('nav-open')) setNavOpen(false);
  });

  const compact = $('compact-toggle');
  compact.addEventListener('click', () => setCompact(!document.body.classList.contains('compact')));
  setCompact(readPrefs().compact === true);

  const archive = $('archive-toggle');
  archive.addEventListener('change', () => {
    state.archived = archive.checked;
    $('new-task-button').disabled = state.archived;
    refresh();
  });

  initFilters($('filters'), render, { userId: state.user.id });
  initShortcuts({
    onNewTask: () => onAddTask(),
    onFocusSearch: () => $('search-input').focus(),
    onSwitchView: switchView,
    onToggleCompact: () => setCompact(!document.body.classList.contains('compact')),
    onToggleTheme: () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'),
    onEditTask: (id) => editTask(id),
    onMoveTaskBy: moveByColumns,
    onArchiveTask: (id) => onArchiveTask(id, !state.archived),
  });

  notifications = initNotifications({
    bell: $('notif-button'),
    badge: $('notif-badge'),
    panel: $('notif-panel'),
    onOpenTask: (id) => onOpenTask(id),
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

  // utenti e board in parallelo; poi la board scelta
  const [users, boards] = await Promise.all([
    getUsers().catch(() => []),
    getBoards({ onCache: (cached) => setBoards(cached) }).catch((err) => {
      showToast(errorMessage(err), 'error');
      return [];
    }),
  ]);
  state.users = users;
  setBoards(boards);
  if (boards.length === 0) return;

  const saved = readPrefs().boardId;
  state.boardId = boards.some((b) => b.id === saved) ? saved : boards[0].id;
  boardSelect.value = String(state.boardId);
  await refresh();

  // aggiornamenti in tempo reale: a ogni modifica si ricarica (con un attimo di attesa per
  // raccoglierne più di una insieme)
  let timer = null;
  connectRealtime({
    onChange: () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // durante un trascinamento la board non deve cambiare sotto le mani
        if (document.body.classList.contains('is-dragging')) return;
        refresh();
        notifications.refresh();
      }, 250);
    },
  });
  notifications.refresh();
}

// ---------------------------------------------------------------------------
// Intestazione
// ---------------------------------------------------------------------------

function drawUser() {
  const slot = $('profile-button');
  slot.replaceChildren(createAvatar(state.user, { size: 24 }));
  const name = document.createElement('span');
  name.className = 'nav-item__label';
  name.textContent = nameOf(state.user);
  slot.append(name);
  slot.title = 'Il tuo profilo';
}

function setBoards(boards) {
  state.boards = boards;
  boardSelect.replaceChildren(...boards.map((b) => new Option(b.name, String(b.id))));
  if (state.boardId != null) boardSelect.value = String(state.boardId);
}

// su telefono la barra laterale è a scomparsa
function setNavOpen(open) {
  document.body.classList.toggle('nav-open', open);
  $('nav-open').setAttribute('aria-expanded', String(open));
  if (open) $('sidebar').querySelector('select, button')?.focus();
}

function setCompact(on) {
  document.body.classList.toggle('compact', on);
  $('compact-toggle').setAttribute('aria-pressed', String(on));
  setPref('compact', on);
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

// ---------------------------------------------------------------------------
// Caricamento
// ---------------------------------------------------------------------------

function refresh() {
  refreshing ??= load().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function load() {
  try {
    const id = state.boardId;
    // l'elenco delle board cambia quando altri ne creano o rinominano
    const [boards, board, tasks] = await Promise.all([
      getBoards(),
      getBoard(id, { onCache: (cached) => setBoardDef(cached) }),
      getBoardTasks(id, { archived: state.archived, onCache: (cached) => setTasks(cached) }),
    ]);
    if (id !== state.boardId) return; // nel frattempo si è cambiata board
    const stillThere = boards.some((b) => b.id === id);
    if (!stillThere) {
      // la board è stata eliminata da qualcun altro
      showToast('La board non esiste più', 'info');
      setBoards(boards);
      return switchBoard(boards[0].id);
    }
    setBoards(boards);
    setBoardDef(board);
    setTasks(tasks, { force: true });
    if (navigator.onLine) hideBanner();
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) showOfflineBanner();
    showToast(errorMessage(err), 'error');
  }
}

function setBoardDef(board) {
  state.board = board;
  setFilterLabels(board.labels);
}

function setTasks(tasks, { force = false } = {}) {
  // dalla cache: niente render inutili se non cambia nulla (il caricamento vero ridisegna sempre
  // le viste con dati propri, come dashboard e attività)
  if (!force && JSON.stringify(tasks) === JSON.stringify(state.tasks)) return;
  state.tasks = tasks;
  render();
}

// ---------------------------------------------------------------------------
// Viste
// ---------------------------------------------------------------------------

function switchView(view) {
  if (view === state.view) return;
  state.view = view;
  for (const tab of document.querySelectorAll('.nav-item[data-view]')) {
    const active = tab.dataset.view === view;
    tab.setAttribute('aria-current', active ? 'page' : 'false');
    tab.classList.toggle('tab--active', active);
  }
  render();
}

async function switchBoard(id) {
  if (id === state.boardId) return;
  state.boardId = id;
  state.board = null;
  state.tasks = [];
  setPref('boardId', id);
  boardSelect.value = String(id);
  renderBoardLoading(boardEl);
  await refresh();
}

function visibleTasks() {
  return applyFilters(state.tasks);
}

function render() {
  if (!state.board) return;
  const token = ++renderToken;
  setSearchSuggestions(state.tasks);

  const isBoard = state.view === 'board';
  boardEl.hidden = !isBoard;
  viewEl.hidden = isBoard;
  // i filtri e l'archivio hanno senso su board e calendario
  $('toolbar').dataset.view = state.view;
  $('board-title').textContent = state.board.name;
  document.title = `${state.board.name} · Kanban Board`;

  if (isBoard) {
    // ridisegnare perde il focus: si rimette sulla stessa card
    const focusedId = document.activeElement?.closest?.('.card')?.dataset.taskId;
    renderBoard(boardEl, visibleTasks(), {
      columns: state.board.columns,
      allTasks: state.tasks,
      archivedView: state.archived,
      onOpenTask,
      onAddTask,
      onMoveTask,
      onArchiveTask,
      onArchiveDone,
    });
    if (focusedId) boardEl.querySelector(`[data-task-id="${focusedId}"]`)?.focus();
  } else if (state.view === 'calendar') {
    renderCalendar(viewEl, visibleTasks(), {
      onOpenTask,
      onAddTask: (date) => onAddTask(null, date),
    });
  } else if (state.view === 'dashboard') {
    getStats(state.boardId)
      .then((stats) => token === renderToken && renderDashboard(viewEl, stats))
      .catch((err) => showToast(errorMessage(err), 'error'));
  } else {
    renderActivity(viewEl, state.boardId, {
      onOpenTask,
      existingTaskIds: () => new Set(state.tasks.map((t) => t.id)),
    });
  }
}

// ---------------------------------------------------------------------------
// Azioni
// ---------------------------------------------------------------------------

function onOpenTask(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) {
    showToast('Attività non trovata (forse è in archivio)', 'error');
    refresh();
    return;
  }
  openTaskDetail({
    task,
    allTasks: state.tasks,
    columns: state.board.columns,
    users: state.users,
    currentUser: state.user,
    onEdit: (t) => editTask(t.id),
    onDeleted: refresh,
    onOpenTask,
    onChanged: refresh,
    onArchive: onArchiveTask,
  });
}

function formContext() {
  return {
    columns: state.board.columns,
    labels: state.board.labels,
    users: state.users,
    allTasks: state.tasks,
    boardId: state.boardId,
    onSaved: refresh,
    onLabelCreated: refresh,
  };
}

function onAddTask(columnId = null, date = null) {
  if (!state.board || state.archived) return;
  openTaskForm({ ...formContext(), columnId, date });
}

function editTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  const canEdit = state.user.role === 'admin' || task.createdBy.id === state.user.id;
  if (!canEdit) {
    showToast('Solo l’autore o un admin può modificare questa attività', 'error');
    return;
  }
  openTaskForm({ ...formContext(), task });
}

// "Sposta in…" mette l'attività in fondo alla colonna
function onMoveTask(taskId, columnId) {
  const position = state.tasks.filter((t) => t.columnId === columnId && t.id !== taskId).length;
  return onMove(taskId, columnId, position);
}

// con la tastiera: nella colonna prima/dopo, in cima
function moveByColumns(taskId, delta) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || state.archived) return;
  const columns = state.board.columns;
  const target = columns[columns.findIndex((c) => c.id === task.columnId) + delta];
  if (target) onMove(taskId, target.id, 0);
}

// posizione tra TUTTE le attività della colonna (i filtri nascondono delle card):
// prima della card successiva, oppure in fondo
function toServerPosition(taskId, columnId, afterId) {
  const column = state.tasks
    .filter((t) => t.columnId === columnId && t.id !== taskId)
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const index = afterId == null ? -1 : column.findIndex((t) => t.id === afterId);
  return index === -1 ? column.length : index;
}

async function onDrop(taskId, columnId, _visiblePosition, afterId) {
  return onMove(taskId, columnId, toServerPosition(taskId, columnId, afterId));
}

async function onMove(taskId, columnId, position) {
  try {
    // se la colonna ha il limite WIP pieno, si chiede conferma
    await withConfirmation((flags) => moveTask(taskId, columnId, position, flags));
  } catch (err) {
    if (!(err instanceof Cancelled)) showToast(errorMessage(err), 'error');
  }
  await refreshing; // un ricaricamento già partito sarebbe precedente allo spostamento
  await refresh(); // se c'è stato un errore, rimette la board come sul server
}

async function onArchiveTask(taskId, archived) {
  try {
    await archiveTask(taskId, archived);
    showToast(archived ? 'Attività archiviata' : 'Attività ripristinata', 'success');
  } catch (err) {
    showToast(errorMessage(err), 'error');
  }
  await refresh();
}

async function onArchiveDone() {
  const ok = await confirmDialog(
    'Archiviare tutte le attività completate? Spariscono dalla board ma restano consultabili e si possono ripristinare.',
    { title: 'Archivia completate', okLabel: 'Archivia' },
  );
  if (!ok) return;
  try {
    const { archived } = await archiveDone(state.boardId);
    showToast(`${archived} attività archiviate`, 'success');
  } catch (err) {
    showToast(errorMessage(err), 'error');
  }
  await refresh();
}

async function onNewBoard() {
  const name = await promptDialog('Nome della board', {
    title: 'Nuova board',
    okLabel: 'Crea',
    maxLength: 50,
  });
  if (!name) return;
  try {
    const board = await createBoard(name);
    setBoards([
      ...state.boards,
      { id: board.id, name: board.name, createdBy: board.createdBy, taskCount: 0 },
    ]);
    await switchBoard(board.id);
  } catch (err) {
    showToast(errorMessage(err), 'error');
  }
}

function openSettings() {
  if (!state.board) return;
  openBoardSettings({
    board: state.board,
    user: state.user,
    boardCount: state.boards.length,
    onChanged: refresh,
    onBoardDeleted: async () => {
      const boards = await getBoards();
      setBoards(boards);
      state.boardId = null;
      await switchBoard(boards[0].id);
    },
    onImported: async (board) => {
      setBoards(await getBoards());
      await switchBoard(board.id);
    },
  });
}

async function onLogout() {
  await logout();
  location.replace('login.html');
}

main();
