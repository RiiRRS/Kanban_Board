// SEGNAPOSTO

export function showToast(message, type = 'info') {
  console.log(`[${type}] ${message}`);
}

export function openModal(content, { title, onClose, size = 'md', beforeClose } = {}) {
  document.body.append(content);
  return {
    element: content,
    close() {
      content.remove();
    },
  };
}

export function confirmDialog(
  message,
  { title = 'Conferma', okLabel = 'Conferma', cancelLabel = 'Annulla', danger = false } = {},
) {
  console.warn(`confirmDialog segnaposto: ${message}`);
  return Promise.resolve(false);
}
