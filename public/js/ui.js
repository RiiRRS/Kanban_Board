// Notifiche (toast), finestre (modali) e finestra di conferma

const TOAST_TYPES = ['info', 'success', 'error'];
const MAX_TOASTS = 3;
const FOCUSABLE = 'input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])';

let toastContainer = null;

export function showToast(message, type = 'info') {
  if (!TOAST_TYPES.includes(type)) type = 'info';

  // il contenitore si crea una volta sola
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.setAttribute('role', 'status');
    toastContainer.setAttribute('aria-live', 'polite');
    document.body.append(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;

  const text = document.createElement('span');
  text.className = 'toast__text';
  text.textContent = message;

  const closeButton = document.createElement('button');
  closeButton.className = 'btn btn--ghost btn--icon';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Chiudi notifica');
  closeButton.textContent = '×';

  toast.append(text, closeButton);
  toastContainer.append(toast);

  // al massimo 3 visibili: la più vecchia sparisce
  while (toastContainer.children.length > MAX_TOASTS) {
    toastContainer.firstElementChild.remove();
  }

  const timer = setTimeout(() => toast.remove(), type === 'error' ? 6000 : 3000);
  closeButton.addEventListener('click', () => {
    clearTimeout(timer);
    toast.remove();
  });
}

// pila delle finestre aperte: Esc chiude solo quella in cima
const modalStack = [];
let modalCounter = 0;

export function openModal(content, { title, onClose, size = 'md', beforeClose } = {}) {
  modalCounter++;
  const titleId = `modal-title-${modalCounter}`;
  const previousFocus = document.activeElement;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = `modal modal--${size}`;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);

  const header = document.createElement('div');
  header.className = 'modal__header';

  const titleEl = document.createElement('h2');
  titleEl.className = 'modal__title';
  titleEl.id = titleId;
  titleEl.textContent = title ?? '';

  const closeButton = document.createElement('button');
  closeButton.className = 'modal__close btn btn--ghost btn--icon';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Chiudi');
  closeButton.textContent = '×';

  const body = document.createElement('div');
  body.className = 'modal__body';
  body.append(content);

  header.append(titleEl, closeButton);
  modal.append(header, body);
  backdrop.append(modal);
  document.body.append(backdrop);
  document.body.classList.add('modal-open');

  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKeydown);
    modalStack.splice(modalStack.indexOf(handle), 1);
    if (modalStack.length === 0) document.body.classList.remove('modal-open');
    previousFocus?.focus?.();
    onClose?.();
  }

  // chiusura da ×, Esc o click fuori: prima chiede a beforeClose
  async function requestClose() {
    if (beforeClose && !(await beforeClose())) return;
    close();
  }

  function onKeydown(e) {
    if (modalStack.at(-1) !== handle) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      requestClose();
      return;
    }

    // il focus gira solo dentro la finestra
    if (e.key === 'Tab') {
      const items = [...modal.querySelectorAll(FOCUSABLE)].filter(
        (el) => !el.disabled && !el.closest('[hidden]'),
      );
      const first = items[0];
      const last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  closeButton.addEventListener('click', requestClose);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) requestClose();
  });
  document.addEventListener('keydown', onKeydown);

  const handle = { element: modal, close };
  modalStack.push(handle);

  const firstField = body.querySelector('input, select, textarea, button');
  (firstField ?? closeButton).focus();

  return handle;
}

export function confirmDialog(
  message,
  { title = 'Conferma', okLabel = 'Conferma', cancelLabel = 'Annulla', danger = false } = {},
) {
  return new Promise((resolve) => {
    const content = document.createElement('div');

    const text = document.createElement('p');
    text.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'form-actions';
    actions.style.marginTop = 'var(--space-5)';

    const cancelButton = document.createElement('button');
    cancelButton.className = 'btn btn--secondary';
    cancelButton.type = 'button';
    cancelButton.textContent = cancelLabel;

    const okButton = document.createElement('button');
    okButton.className = `btn ${danger ? 'btn--danger' : 'btn--primary'}`;
    okButton.type = 'button';
    okButton.textContent = okLabel;

    actions.append(cancelButton, okButton);
    content.append(text, actions);

    // resolve chiamata più volte non fa nulla: si risolve una volta sola
    let result = false;
    const modal = openModal(content, { title, size: 'sm', onClose: () => resolve(result) });

    cancelButton.addEventListener('click', () => modal.close());
    okButton.addEventListener('click', () => {
      result = true;
      modal.close();
    });

    cancelButton.focus();
  });
}
