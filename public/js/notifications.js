// Campanella delle notifiche: contatore, elenco a comparsa, "segna come lette"

import { getNotifications, markNotificationsRead } from './api.js';
import { el, button } from './dom.js';
import { formatRelative } from './format.js';

const ICONS = { assigned: '👤', mention: '@', comment: '💬', due: '⏰' };

export function initNotifications({ bell, badge, panel, onOpenTask }) {
  let items = [];
  let unread = 0;
  let open = false;

  function drawBadge() {
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = unread === 0;
    bell.setAttribute('aria-label', unread > 0 ? `Notifiche (${unread} non lette)` : 'Notifiche');
  }

  function drawPanel() {
    panel.replaceChildren();
    const head = el('div', 'notif__head');
    head.append(el('strong', null, 'Notifiche'));
    const readAll = button('Segna tutte come lette', 'detail__link', async () => {
      await markNotificationsRead().catch(() => {});
      await refresh();
    });
    readAll.disabled = unread === 0;
    head.append(readAll);
    panel.append(head);

    if (items.length === 0) {
      panel.append(el('p', 'notif__empty', 'Nessuna notifica'));
      return;
    }
    const list = el('ul', 'notif__list');
    for (const n of items) {
      const li = el('li');
      const row = el('button', `notif${n.read ? '' : ' notif--unread'}`);
      row.type = 'button';
      const icon = el('span', 'notif__icon', ICONS[n.type] ?? '•');
      icon.setAttribute('aria-hidden', 'true');
      const text = el('span', 'notif__text');
      text.append(el('span', null, n.text), el('span', 'notif__time', formatRelative(n.createdAt)));
      row.append(icon, text);
      row.addEventListener('click', async () => {
        close();
        if (!n.read) await markNotificationsRead([n.id]).catch(() => {});
        if (n.taskId != null) onOpenTask?.(n.taskId);
        refresh();
      });
      li.append(row);
      list.append(li);
    }
    panel.append(list);
  }

  async function refresh() {
    try {
      ({ items, unread } = await getNotifications());
    } catch {
      return; // offline: resta quello che c'era
    }
    drawBadge();
    if (open) drawPanel();
  }

  function close() {
    open = false;
    panel.hidden = true;
    bell.setAttribute('aria-expanded', 'false');
  }

  async function toggle() {
    if (open) return close();
    open = true;
    await refresh();
    drawPanel();
    panel.hidden = false;
    bell.setAttribute('aria-expanded', 'true');
  }

  bell.setAttribute('aria-haspopup', 'true');
  bell.setAttribute('aria-expanded', 'false');
  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => open && close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      close();
      bell.focus();
    }
  });

  drawBadge();
  return { refresh };
}
