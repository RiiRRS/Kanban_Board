// Avatar tondo con le iniziali, nel colore scelto dall'utente

import { el } from './dom.js';

export const nameOf = (user) => user?.displayName || user?.username || '?';

function initials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// bianco o quasi nero, a seconda di quanto è chiaro lo sfondo (luminanza percepita)
function readableOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1f2328' : '#ffffff';
}

export function createAvatar(user, { size = 24 } = {}) {
  const avatar = el('span', 'avatar', initials(nameOf(user)));
  const color = /^#[0-9a-fA-F]{6}$/.test(user?.avatarColor) ? user.avatarColor : '#4f8cff';
  avatar.style.background = color;
  avatar.style.color = readableOn(color);
  avatar.style.width = avatar.style.height = `${size}px`;
  avatar.style.fontSize = `${Math.round(size * 0.42)}px`;
  avatar.title = nameOf(user);
  avatar.setAttribute('role', 'img');
  avatar.setAttribute('aria-label', nameOf(user));
  return avatar;
}

// fila di avatar sovrapposti: oltre `max` mostra "+N"
export function createAvatarStack(users, { size = 22, max = 3 } = {}) {
  const stack = el('span', 'avatar-stack');
  for (const u of users.slice(0, max)) stack.append(createAvatar(u, { size }));
  if (users.length > max) {
    const more = el('span', 'avatar avatar--more', `+${users.length - max}`);
    more.style.width = more.style.height = `${size}px`;
    more.style.fontSize = `${Math.round(size * 0.42)}px`;
    more.title = users.slice(max).map(nameOf).join(', ');
    stack.append(more);
  }
  return stack;
}
