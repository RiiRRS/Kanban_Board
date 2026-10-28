// Drag-and-drop delle card: mouse con HTML5 Drag & Drop, touch con Pointer Events.
// Si chiama una volta sola: usa la delegazione degli eventi, quindi vale anche dopo ogni renderBoard.

const LONG_PRESS_MS = 300;
const MOVE_TOLERANCE = 8;
const EDGE_SIZE = 40;
const EDGE_SCROLL_STEP = 10;

const CARD_SELECTOR = '.card:not(.card--skeleton):not(.card--static)';
const LIST_SELECTOR = '.column__list';
const IGNORED_SELECTOR = '.card__menu-button, .card__menu';

// card prima della quale inserire, oppure null = in fondo
function getCardAfter(list, y) {
  const cards = [...list.querySelectorAll('.card:not(.card--dragging)')];
  return (
    cards.find((card) => {
      const box = card.getBoundingClientRect();
      return y < box.top + box.height / 2;
    }) ?? null
  );
}

// indice di cardAfter tra le card della colonna (escluse quella trascinata); se null, il numero di card
function getPosition(list, cardAfter) {
  const cards = [...list.querySelectorAll('.card:not(.card--dragging)')];
  return cardAfter ? cards.indexOf(cardAfter) : cards.length;
}

export function enableDragAndDrop(board, { onDrop } = {}) {
  const indicator = document.createElement('div');
  indicator.className = 'drop-indicator';

  let dragged = null; // { card, id, fromColumn, fromPosition }
  let overList = null;
  let justDragged = false;
  let lastPointerType = 'mouse';

  // touch: { card, startX, startY, x, y, timer, active, ghost, offsetX, offsetY, raf }
  let touch = null;

  function begin(card) {
    const list = card.closest(LIST_SELECTOR);
    dragged = {
      card,
      id: Number(card.dataset.taskId),
      fromColumn: list.dataset.columnId,
      fromPosition: [...list.querySelectorAll('.card')].indexOf(card),
    };
    document.body.classList.add('is-dragging');
  }

  function showIndicator(list, y) {
    if (overList && overList !== list) overList.classList.remove('column__list--over');
    overList = list;
    list.classList.add('column__list--over');
    const after = getCardAfter(list, y);
    if (indicator.parentNode !== list || indicator.nextSibling !== after) {
      list.insertBefore(indicator, after);
    }
  }

  function clearIndicator() {
    indicator.remove();
    overList?.classList.remove('column__list--over');
    overList = null;
  }

  function cleanup() {
    clearIndicator();
    dragged?.card.classList.remove('card--dragging');
    document.body.classList.remove('is-dragging');
    dragged = null;
  }

  // sposta subito la card nella pagina e avvisa chi ha chiamato
  function finish(list, y) {
    if (!dragged || !list) return false;
    const { card, id, fromColumn, fromPosition } = dragged;
    const columnId = list.dataset.columnId;
    // prima di cleanup(): la card trascinata deve ancora essere esclusa dal calcolo
    const after = getCardAfter(list, y);
    const position = getPosition(list, after);
    cleanup();

    if (columnId === fromColumn && position === fromPosition) return true;
    list.querySelector('.column__empty')?.remove();
    list.insertBefore(card, after);
    // anche l'id della card successiva: con i filtri attivi l'indice visibile non basta
    onDrop?.(id, Number(columnId), position, after ? Number(after.dataset.taskId) : null);
    return true;
  }

  /* Mouse */

  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.(CARD_SELECTOR);
    // sul touch il trascinamento lo gestiscono i Pointer Events; i bottoni non trascinano
    if (!card || lastPointerType !== 'mouse' || e.target.closest(IGNORED_SELECTOR)) {
      e.preventDefault();
      return;
    }
    begin(card);
    e.dataTransfer.setData('text/plain', String(dragged.id));
    e.dataTransfer.effectAllowed = 'move';
    // dopo il frame, altrimenti anche l'immagine trascinata diventa trasparente
    requestAnimationFrame(() => card.classList.add('card--dragging'));
  });

  board.addEventListener('dragover', (e) => {
    const list = e.target.closest?.(LIST_SELECTOR);
    if (!dragged || !list) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    showIndicator(list, e.clientY);
  });

  board.addEventListener('dragleave', (e) => {
    const list = e.target.closest?.(LIST_SELECTOR);
    if (list && !list.contains(e.relatedTarget)) {
      list.classList.remove('column__list--over');
      if (indicator.parentNode === list) indicator.remove();
    }
  });

  board.addEventListener('drop', (e) => {
    const list = e.target.closest?.(LIST_SELECTOR);
    if (!dragged || !list) return;
    e.preventDefault();
    finish(list, e.clientY);
  });

  // pulisce sempre, anche se il rilascio è fuori dalle colonne
  board.addEventListener('dragend', cleanup);

  /* Touch */

  function startTouchDrag() {
    const t = touch;
    t.active = true;
    navigator.vibrate?.(30);

    const rect = t.card.getBoundingClientRect();
    t.offsetX = t.startX - rect.left;
    t.offsetY = t.startY - rect.top;
    t.ghost = t.card.cloneNode(true);
    t.ghost.classList.add('card--ghost');
    t.ghost.removeAttribute('data-task-id');
    t.ghost.style.width = `${rect.width}px`;
    document.body.append(t.ghost);

    begin(t.card);
    t.card.classList.add('card--dragging');
    try {
      t.card.setPointerCapture(t.pointerId);
    } catch {
      // il puntatore potrebbe essere già finito
    }
    updateTouch();
    t.raf = requestAnimationFrame(autoScroll);
  }

  function updateTouch() {
    const t = touch;
    t.ghost.style.transform = `translate(${t.x - t.offsetX}px, ${t.y - t.offsetY}px)`;
    const list = document.elementFromPoint(t.x, t.y)?.closest(LIST_SELECTOR);
    if (list) showIndicator(list, t.y);
    else clearIndicator();
  }

  // vicino ai bordi la board scorre da sola
  function autoScroll() {
    if (!touch?.active) return;
    const box = board.getBoundingClientRect();
    let delta = 0;
    if (touch.x < box.left + EDGE_SIZE) delta = -EDGE_SCROLL_STEP;
    else if (touch.x > box.right - EDGE_SIZE) delta = EDGE_SCROLL_STEP;
    if (delta) {
      board.scrollLeft += delta;
      updateTouch();
    }
    touch.raf = requestAnimationFrame(autoScroll);
  }

  function endTouch() {
    if (!touch) return;
    clearTimeout(touch.timer);
    cancelAnimationFrame(touch.raf);
    touch.ghost?.remove();
    touch = null;
  }

  board.addEventListener('pointerdown', (e) => {
    lastPointerType = e.pointerType;
    if (e.pointerType === 'mouse' || touch) return;
    const card = e.target.closest(CARD_SELECTOR);
    if (!card || e.target.closest(IGNORED_SELECTOR)) return;
    touch = {
      card,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      active: false,
      timer: setTimeout(startTouchDrag, LONG_PRESS_MS),
    };
  });

  board.addEventListener('pointermove', (e) => {
    if (!touch || e.pointerId !== touch.pointerId) return;
    touch.x = e.clientX;
    touch.y = e.clientY;
    if (!touch.active) {
      // il dito si è mosso prima della pressione lunga: è uno scroll
      if (Math.hypot(touch.x - touch.startX, touch.y - touch.startY) > MOVE_TOLERANCE) endTouch();
      return;
    }
    if (!touch.card.isConnected) {
      cleanup();
      endTouch();
      return;
    }
    e.preventDefault();
    updateTouch();
  });

  board.addEventListener('pointerup', (e) => {
    if (!touch || e.pointerId !== touch.pointerId) return;
    if (touch.active) {
      const list = document.elementFromPoint(e.clientX, e.clientY)?.closest(LIST_SELECTOR);
      if (!list || !finish(list, e.clientY)) cleanup();
      justDragged = true;
      setTimeout(() => (justDragged = false), 0);
    }
    endTouch();
  });

  board.addEventListener('pointercancel', (e) => {
    if (!touch || e.pointerId !== touch.pointerId) return;
    if (touch.active) cleanup();
    endTouch();
  });

  // senza questo il browser scorre la pagina mentre trascini
  board.addEventListener(
    'touchmove',
    (e) => {
      if (touch?.active) e.preventDefault();
    },
    { passive: false },
  );

  // la pressione lunga non deve aprire il menu del browser
  board.addEventListener('contextmenu', (e) => {
    if (touch && e.target.closest(CARD_SELECTOR)) e.preventDefault();
  });

  // dopo un trascinamento il click non deve aprire il dettaglio
  board.addEventListener(
    'click',
    (e) => {
      if (!justDragged) return;
      e.stopPropagation();
      e.preventDefault();
      justDragged = false;
    },
    true,
  );
}
