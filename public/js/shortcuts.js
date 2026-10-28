// Scorciatoie da tastiera. Non si attivano mentre scrivi in un campo o con una finestra aperta,
// e non interferiscono con Ctrl, Alt e Cmd.

import { openModal } from './ui.js';

const SHORTCUTS = [
  ['N', 'Nuova attività'],
  ['/', 'Vai alla ricerca'],
  ['1 2 3 4', 'Board, calendario, dashboard, attività'],
  ['C', 'Vista compatta'],
  ['T', 'Tema chiaro/scuro'],
  ['?', 'Mostra questo elenco'],
  ['← ↑ ↓ →', 'Muoviti tra le card (con una card selezionata)'],
  ['Invio', 'Apri la card selezionata'],
  ['E', 'Modifica la card selezionata'],
  ['[  ]', 'Sposta la card nella colonna prima/dopo'],
  ['A', 'Archivia (o ripristina) la card selezionata'],
];

const VIEWS = { 1: 'board', 2: 'calendar', 3: 'dashboard', 4: 'activity' };

// true se l'utente sta scrivendo in un campo
function isTyping(target) {
  return (
    target instanceof Element &&
    (target.closest('input, textarea, select') !== null || target.isContentEditable)
  );
}

function openShortcutsHelp() {
  const list = document.createElement('dl');
  list.className = 'detail__meta';
  for (const [key, description] of SHORTCUTS) {
    const dt = document.createElement('dt');
    for (const part of key.split(/\s{1,}/).filter(Boolean)) {
      const kbd = document.createElement('kbd');
      kbd.textContent = part;
      dt.append(kbd, ' ');
    }
    const dd = document.createElement('dd');
    dd.textContent = description;
    list.append(dt, dd);
  }
  openModal(list, { title: 'Scorciatoie da tastiera', size: 'sm' });
}

// card successiva nella direzione indicata: su/giù nella colonna, destra/sinistra nelle colonne vicine
function neighbourCard(card, key) {
  const list = card.closest('.column__list');
  const cards = [...list.querySelectorAll('.card')];
  const index = cards.indexOf(card);
  if (key === 'ArrowDown') return cards[index + 1] ?? null;
  if (key === 'ArrowUp') return cards[index - 1] ?? null;

  const step = key === 'ArrowRight' ? 1 : -1;
  const lists = [...card.closest('.board').querySelectorAll('.column__list')];
  for (let i = lists.indexOf(list) + step; i >= 0 && i < lists.length; i += step) {
    const there = [...lists[i].querySelectorAll('.card')];
    if (there.length > 0) return there[Math.min(index, there.length - 1)];
  }
  return null;
}

export function initShortcuts({
  onNewTask,
  onFocusSearch,
  onSwitchView,
  onToggleCompact,
  onToggleTheme,
  onEditTask,
  onMoveTaskBy,
  onArchiveTask,
} = {}) {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (isTyping(e.target) || document.body.classList.contains('modal-open')) return;

    // con il focus su una card (non su un suo bottone interno)
    const card =
      e.target instanceof Element && e.target.classList.contains('card') ? e.target : null;
    if (card && !card.classList.contains('card--skeleton')) {
      const id = Number(card.dataset.taskId);
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        neighbourCard(card, e.key)?.focus();
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        return onEditTask?.(id);
      }
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        return onMoveTaskBy?.(id, e.key === ']' ? 1 : -1);
      }
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        return onArchiveTask?.(id);
      }
    }

    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      onNewTask?.();
    } else if (e.key === '/') {
      e.preventDefault();
      onFocusSearch?.();
    } else if (e.key === 'c' || e.key === 'C') {
      onToggleCompact?.();
    } else if (e.key === 't' || e.key === 'T') {
      onToggleTheme?.();
    } else if (VIEWS[e.key]) {
      onSwitchView?.(VIEWS[e.key]);
    } else if (e.key === '?') {
      e.preventDefault();
      openShortcutsHelp();
    }
  });
}
