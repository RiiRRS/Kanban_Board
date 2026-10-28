// Registro delle attività della board, con "Carica altre" per scorrere indietro

import { getBoardEvents } from './api.js';
import { createEventList } from './history.js';
import { el, button, spinner, errorMessage } from './dom.js';

const PAGE = 50;

export async function renderActivity(container, boardId, { onOpenTask, existingTaskIds }) {
  container.replaceChildren();
  const root = el('div', 'activity');
  root.append(el('h2', 'activity__title', 'Attività recenti'));
  const body = el('div');
  const more = el('div', 'activity__more');
  root.append(body, more);
  container.append(root);

  const loading = el('p', 'comments__status');
  loading.append(spinner(), 'Caricamento…');
  body.append(loading);

  let last = null;
  async function load() {
    more.replaceChildren();
    try {
      const events = await getBoardEvents(boardId, { limit: PAGE, before: last });
      loading.remove();
      if (events.length === 0 && last === null) {
        body.append(el('p', 'detail__muted', 'Ancora nessuna attività.'));
        return;
      }
      // si può aprire solo un'attività che esiste ancora
      body.append(
        createEventList(events, {
          onOpenTask: (id) => existingTaskIds().has(id) && onOpenTask(id),
        }),
      );
      last = events.at(-1)?.id ?? last;
      if (events.length === PAGE) more.append(button('Carica altre', 'btn btn--secondary', load));
    } catch (err) {
      loading.remove();
      body.append(el('p', 'detail__muted', errorMessage(err)));
    }
  }
  await load();
}
