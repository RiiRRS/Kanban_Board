// Piccoli aiuti per costruire il DOM (textContent è sempre sicuro: niente innerHTML)

// crea un elemento con classe e testo
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function button(text, className = 'btn btn--secondary', onClick) {
  const b = el('button', className, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

export function spinner() {
  const s = el('span', 'spinner');
  s.setAttribute('aria-hidden', 'true');
  return s;
}

export const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// messaggio d'errore leggibile per le notifiche a schermo
export const errorMessage = (err) =>
  err?.name === 'ApiError' ? err.message : 'Errore imprevisto, riprova';
