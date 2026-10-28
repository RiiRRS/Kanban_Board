// Scorciatoie da tastiera: N nuova attività, / ricerca, ? elenco delle scorciatoie

import { openModal } from './ui.js';

const SHORTCUTS = [
  ['N', 'Nuova attività'],
  ['/', 'Vai alla ricerca'],
  ['?', 'Mostra questo elenco'],
];

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
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    dt.append(kbd);
    const dd = document.createElement('dd');
    dd.textContent = description;
    list.append(dt, dd);
  }
  openModal(list, { title: 'Scorciatoie da tastiera', size: 'sm' });
}

export function initShortcuts({ onNewTask, onFocusSearch } = {}) {
  document.addEventListener('keydown', (e) => {
    // non partono con Ctrl, Alt o Cmd (Ctrl+N deve aprire ancora una finestra del browser),
    // mentre si scrive in un campo o con una finestra aperta
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (isTyping(e.target) || document.body.classList.contains('modal-open')) return;

    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      onNewTask?.();
    } else if (e.key === '/') {
      e.preventDefault();
      onFocusSearch?.();
    } else if (e.key === '?') {
      e.preventDefault();
      openShortcutsHelp();
    }
  });
}
