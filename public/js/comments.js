// Commenti di un'attività: elenco, modifica, eliminazione, @menzioni con suggerimenti

import { getComments, addComment, editComment, deleteComment, ApiError } from './api.js';
import { LIMITS } from './constants.js';
import { validateCommentText } from './validation.js';
import { formatDateTime } from './format.js';
import { renderWithMentions } from './markdown.js';
import { nameOf } from './avatar.js';
import { el, button, spinner, errorMessage } from './dom.js';
import { showToast, confirmDialog } from './ui.js';

// Mentre si scrive "@ma" propone gli utenti che iniziano così. Frecce per scegliere,
// Invio o Tab per inserire, Esc per chiudere.
export function attachMentions(textarea, users) {
  const popup = el('ul', 'mention-popup');
  popup.setAttribute('role', 'listbox');
  popup.hidden = true;
  textarea.after(popup);

  let matches = [];
  let active = 0;
  let range = null; // dove sta il testo "@ma" da sostituire

  const close = () => {
    popup.hidden = true;
    range = null;
  };

  function render() {
    popup.replaceChildren(
      ...matches.map((u, i) => {
        const item = el('li', 'mention-popup__item', `@${u.username}`);
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(i === active));
        if (u.displayName) item.append(el('span', 'mention-popup__name', ` ${nameOf(u)}`));
        // mousedown: il click farebbe perdere il focus alla textarea prima della scelta
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          choose(u);
        });
        return item;
      }),
    );
  }

  function choose(user) {
    if (!range) return;
    const before = textarea.value.slice(0, range.start);
    const after = textarea.value.slice(range.end);
    textarea.value = `${before}@${user.username} ${after}`;
    const caret = before.length + user.username.length + 2;
    textarea.setSelectionRange(caret, caret);
    close();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  }

  textarea.addEventListener('input', () => {
    const caret = textarea.selectionStart;
    const match = /(?<![\w@])@([A-Za-z0-9_]{0,30})$/.exec(textarea.value.slice(0, caret));
    if (!match) return close();
    const typed = match[1].toLowerCase();
    matches = users.filter((u) => u.username.toLowerCase().startsWith(typed)).slice(0, 5);
    if (matches.length === 0) return close();
    range = { start: caret - match[0].length, end: caret };
    active = 0;
    render();
    popup.hidden = false;
  });

  textarea.addEventListener('keydown', (e) => {
    if (popup.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      render();
    } else if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') {
      e.preventDefault();
      choose(matches[active]);
    } else if (e.key === 'Escape') {
      // chiude solo il suggerimento, non la finestra
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  textarea.addEventListener('blur', close);
}

export function createComments({ taskId, currentUser, users, onChange, onCount }) {
  const section = el('div');
  const list = el('ul', 'comment-list');
  const empty = el('p', 'detail__muted', 'Nessun commento. Scrivi il primo!');
  const box = el('div');
  let comments = [];
  let closed = false;

  function buildItem(comment) {
    const item = el('li', 'comment');
    const header = el('div', 'comment__header');
    const isMe = comment.author.id === currentUser?.id;
    header.append(el('strong', 'comment__author', comment.author.username + (isMe ? ' (tu)' : '')));
    const time = el('time', 'comment__date', formatDateTime(comment.createdAt));
    time.dateTime = comment.createdAt;
    header.append(time);
    if (comment.editedAt) {
      const edited = el('span', 'comment__edited', '(modificato)');
      edited.title = formatDateTime(comment.editedAt);
      header.append(edited);
    }

    const text = el('p', 'comment__text');
    text.append(renderWithMentions(comment.text));
    item.append(header, text);

    const canDelete = isMe || currentUser?.role === 'admin';
    if (isMe || canDelete) {
      const actions = el('div', 'comment__actions');
      if (isMe) {
        actions.append(
          button('Modifica', 'detail__link', () => startEdit(item, comment, text, actions)),
        );
      }
      if (canDelete) {
        actions.append(
          button('Elimina', 'detail__link detail__link--danger', async () => {
            const ok = await confirmDialog('Eliminare questo commento?', {
              title: 'Elimina commento',
              okLabel: 'Elimina',
              danger: true,
            });
            if (!ok) return;
            try {
              await deleteComment(taskId, comment.id);
              comments = comments.filter((c) => c.id !== comment.id);
              item.remove();
              update();
              onChange?.();
            } catch (err) {
              showToast(errorMessage(err), 'error');
            }
          }),
        );
      }
      item.append(actions);
    }
    return item;
  }

  function startEdit(item, comment, textEl, actions) {
    const form = el('form', 'comment-edit');
    const area = el('textarea', 'textarea');
    area.value = comment.text;
    area.rows = 3;
    area.maxLength = LIMITS.commentMax;
    area.setAttribute('aria-label', 'Modifica il commento');
    const error = el('p', 'form-error');
    const save = el('button', 'btn btn--primary', 'Salva');
    save.type = 'submit';
    const cancel = button('Annulla', 'btn btn--secondary', () => {
      form.replaceWith(textEl);
      actions.hidden = false;
    });
    const row = el('div', 'form-actions');
    row.append(cancel, save);
    form.append(area, error, row);
    textEl.replaceWith(form);
    actions.hidden = true;
    attachMentions(area, users);
    area.focus();

    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const problem = validateCommentText(area.value);
      if (problem) {
        error.textContent = problem;
        return;
      }
      save.disabled = true;
      try {
        const saved = await editComment(taskId, comment.id, area.value);
        comments = comments.map((c) => (c.id === saved.id ? saved : c));
        item.replaceWith(buildItem(saved));
        onChange?.();
      } catch (err) {
        error.textContent = errorMessage(err);
        save.disabled = false;
      }
    });
  }

  function update() {
    empty.hidden = comments.length > 0;
    list.hidden = comments.length === 0;
    onCount?.(comments.length);
  }

  function renderAll(items) {
    if (closed) return;
    comments = items;
    list.replaceChildren(...comments.map(buildItem));
    update();
  }

  // ===== Form per il nuovo commento =====

  const form = el('form', 'comment-form');
  form.noValidate = true;
  const label = el('label', 'visually-hidden', 'Nuovo commento');
  label.htmlFor = 'comment-text';
  const wrap = el('div', 'mention-wrap');
  const text = el('textarea', 'textarea');
  text.id = 'comment-text';
  text.maxLength = LIMITS.commentMax;
  text.rows = 3;
  text.placeholder = 'Scrivi un commento… usa @nome per citare qualcuno';
  wrap.append(text);
  const error = el('p', 'form-error');
  error.id = 'comment-text-error';
  text.setAttribute('aria-describedby', error.id);

  const footer = el('div', 'comment-form__footer');
  const counter = el('span', 'form-hint', `0/${LIMITS.commentMax}`);
  const submit = el('button', 'btn btn--primary', 'Commenta');
  submit.type = 'submit';
  submit.disabled = true;
  footer.append(counter, submit);
  form.append(label, wrap, error, footer);
  attachMentions(text, users);

  text.addEventListener('input', () => {
    counter.textContent = `${text.value.length}/${LIMITS.commentMax}`;
    submit.disabled = text.value.trim() === '';
    error.textContent = '';
    text.classList.remove('input--invalid');
  });

  // Invio va a capo, Ctrl/Cmd+Invio invia
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled) return;

    const problem = validateCommentText(text.value);
    if (problem) {
      error.textContent = problem;
      text.classList.add('input--invalid');
      return;
    }

    submit.disabled = true;
    submit.textContent = '';
    submit.append(spinner(), ' Invio…');
    try {
      const comment = await addComment(taskId, text.value);
      if (closed) return;
      const item = buildItem(comment);
      comments.push(comment);
      list.append(item);
      update();
      text.value = '';
      counter.textContent = `0/${LIMITS.commentMax}`;
      item.scrollIntoView({ block: 'nearest' });
      onChange?.();
    } catch (err) {
      // il testo scritto resta nel campo
      if (closed) return;
      error.textContent = err instanceof ApiError ? err.message : 'Errore imprevisto, riprova';
      text.classList.add('input--invalid');
    } finally {
      submit.textContent = 'Commenta';
      submit.disabled = text.value.trim() === '';
    }
  });

  function load() {
    box.replaceChildren();
    const loading = el('p', 'comments__status');
    loading.append(spinner(), 'Caricamento commenti…');
    box.append(loading);

    getComments(taskId, { onCache: renderAll })
      .then((items) => {
        if (closed) return;
        box.replaceChildren(list, empty);
        renderAll(items);
      })
      .catch(() => {
        if (closed) return;
        const failed = el('p', 'comments__status', 'Impossibile caricare i commenti ');
        failed.append(button('Riprova', 'btn btn--secondary', load));
        box.replaceChildren(failed);
      });
  }

  // se arriva la cache prima dei dati veri, la lista deve già essere nel DOM
  box.append(list, empty);
  list.hidden = true;
  section.append(box, form);
  load();

  return {
    element: section,
    close: () => {
      closed = true;
    },
  };
}
