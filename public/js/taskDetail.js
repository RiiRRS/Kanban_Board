// Finestra di dettaglio di un'attività: dati, gerarchia, eliminazione e commenti

import { deleteTask, getComments, addComment, ApiError } from './api.js';
import { STATUS_LABELS, PRIORITY_LABELS, LIMITS } from './constants.js';
import { validateCommentText } from './validation.js';
import { formatDate, formatTimeRange, formatDateTime, isOverdue } from './format.js';
import { openModal, showToast, confirmDialog } from './ui.js';

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createSpinner() {
  const spinner = el('span', 'spinner');
  spinner.setAttribute('aria-hidden', 'true');
  return spinner;
}

function createSection(title) {
  const section = el('section', 'detail__section');
  const heading = el('h3', 'detail__section-title', title);
  section.append(heading);
  return { section, heading };
}

// bottone che sembra un link
function createLink(text, onClick) {
  const link = el('button', 'detail__link', text);
  link.type = 'button';
  link.addEventListener('click', onClick);
  return link;
}

export function openTaskDetail({
  task,
  allTasks = [],
  currentUser,
  onEdit,
  onDeleted,
  onOpenTask,
  onCommentAdded,
} = {}) {
  const content = el('div');
  let closed = false;

  // ===== Dati =====

  const colorBar = el('div', 'detail__color');
  colorBar.style.background = task.color;

  const badges = el('div', 'detail__badges');
  badges.append(
    el('span', 'badge', STATUS_LABELS[task.status]),
    el('span', `badge badge--priority-${task.priority}`, PRIORITY_LABELS[task.priority]),
  );
  if (isOverdue(task)) badges.append(el('span', 'badge badge--danger', 'Scaduta'));

  const meta = el('dl', 'detail__meta');
  const addMeta = (label, value) => meta.append(el('dt', '', label), el('dd', '', value));
  addMeta('Data', formatDate(task.date));
  addMeta('Orario', formatTimeRange(task.startTime, task.endTime));
  addMeta('Creata da', `${task.createdBy.username}, ${formatDateTime(task.createdAt)}`);
  if (task.updatedAt !== task.createdAt) addMeta('Ultima modifica', formatDateTime(task.updatedAt));

  const description = task.description
    ? el('p', 'detail__description', task.description)
    : el('p', 'detail__muted', 'Nessuna descrizione');

  content.append(colorBar, badges, meta, description);

  // ===== Gerarchia =====

  // si chiude questa finestra prima di aprire l'altra attività
  const openOther = (id) => {
    modal.close();
    onOpenTask?.(id);
  };

  const hierarchy = createSection('Gerarchia');

  const parentTask = task.parentId != null ? allTasks.find((t) => t.id === task.parentId) : null;
  const parentLine = el('p');
  parentLine.append('Genitore: ');
  if (parentTask) parentLine.append(createLink(parentTask.title, () => openOther(parentTask.id)));
  else parentLine.append(el('span', 'detail__muted', 'Nessuna'));

  const children = allTasks.filter((t) => t.parentId === task.id);
  const childrenList = el('div', 'detail__children');
  if (children.length > 0) {
    for (const child of children) {
      childrenList.append(
        createLink(`${child.title} · ${STATUS_LABELS[child.status]}`, () => openOther(child.id)),
      );
    }
  } else {
    childrenList.append(el('span', 'detail__muted', 'Nessuna sotto-attività'));
  }

  hierarchy.section.append(parentLine, childrenList);
  content.append(hierarchy.section);

  // ===== Commenti =====

  const comments = createSection('Commenti (0)');
  const commentsBox = el('div');
  const commentList = el('ul', 'comment-list');
  const emptyMessage = el('p', 'detail__muted', 'Nessun commento. Scrivi il primo!');
  commentList.hidden = true;
  let commentCount = 0;

  function updateCommentCount() {
    comments.heading.textContent = `Commenti (${commentCount})`;
    emptyMessage.hidden = commentCount > 0;
    commentList.hidden = commentCount === 0;
  }

  function createCommentItem(comment) {
    const item = el('li', 'comment');
    const header = el('div', 'comment__header');
    const isMe = comment.author.id === currentUser?.id;
    header.append(el('strong', 'comment__author', comment.author.username + (isMe ? ' (tu)' : '')));
    const time = el('time', 'comment__date', formatDateTime(comment.createdAt));
    time.dateTime = comment.createdAt;
    header.append(time);
    item.append(header, el('p', 'comment__text', comment.text));
    return item;
  }

  function renderComments(list) {
    if (closed) return;
    commentList.replaceChildren(...list.map(createCommentItem));
    commentCount = list.length;
    updateCommentCount();
  }

  // form per il nuovo commento
  const commentForm = el('form', 'comment-form');
  commentForm.noValidate = true;

  const commentLabel = el('label', 'visually-hidden', 'Nuovo commento');
  commentLabel.htmlFor = 'comment-text';
  const commentText = el('textarea', 'textarea');
  commentText.id = 'comment-text';
  commentText.maxLength = LIMITS.commentMax;
  commentText.rows = 3;
  commentText.placeholder = 'Scrivi un commento…';
  const commentError = el('p', 'form-error');
  commentError.id = 'comment-text-error';
  commentText.setAttribute('aria-describedby', commentError.id);

  const commentFooter = el('div', 'comment-form__footer');
  const commentCounter = el('span', 'form-hint', `0/${LIMITS.commentMax}`);
  const commentButton = el('button', 'btn btn--primary', 'Commenta');
  commentButton.type = 'submit';
  commentButton.disabled = true;
  commentFooter.append(commentCounter, commentButton);
  commentForm.append(commentLabel, commentText, commentError, commentFooter);

  commentText.addEventListener('input', () => {
    commentCounter.textContent = `${commentText.value.length}/${LIMITS.commentMax}`;
    commentButton.disabled = commentText.value.trim() === '';
    commentError.textContent = '';
    commentText.classList.remove('input--invalid');
  });

  // Invio va a capo, Ctrl/Cmd+Invio invia
  commentText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commentForm.requestSubmit();
    }
  });

  commentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (commentButton.disabled) return;

    const text = commentText.value;
    const error = validateCommentText(text);
    if (error) {
      commentError.textContent = error;
      commentText.classList.add('input--invalid');
      return;
    }

    commentButton.disabled = true;
    commentButton.textContent = '';
    commentButton.append(createSpinner(), ' Invio…');
    try {
      const comment = await addComment(task.id, text);
      if (closed) return;
      const item = createCommentItem(comment);
      commentList.append(item);
      commentCount++;
      updateCommentCount();
      commentText.value = '';
      commentCounter.textContent = `0/${LIMITS.commentMax}`;
      item.scrollIntoView({ block: 'nearest' });
      onCommentAdded?.(task.id);
    } catch (err) {
      // il testo scritto resta nel campo
      if (closed) return;
      commentError.textContent =
        err instanceof ApiError ? err.message : 'Errore imprevisto, riprova';
      commentText.classList.add('input--invalid');
    } finally {
      commentButton.textContent = 'Commenta';
      commentButton.disabled = commentText.value.trim() === '';
    }
  });

  function loadComments() {
    commentsBox.replaceChildren();
    const loading = el('p', 'comments__status');
    loading.append(createSpinner(), 'Caricamento commenti…');
    commentsBox.append(loading);

    getComments(task.id, { onCache: renderComments })
      .then((list) => {
        if (closed) return;
        commentsBox.replaceChildren(commentList, emptyMessage);
        renderComments(list);
      })
      .catch(() => {
        if (closed) return;
        const failed = el('p', 'comments__status', 'Impossibile caricare i commenti ');
        const retry = el('button', 'btn btn--secondary', 'Riprova');
        retry.type = 'button';
        retry.addEventListener('click', loadComments);
        failed.append(retry);
        commentsBox.replaceChildren(failed);
      });
  }

  // se arriva la cache prima dei dati veri, la lista deve già essere nel DOM
  commentsBox.append(commentList, emptyMessage);
  comments.section.append(commentsBox, commentForm);
  content.append(comments.section);

  // ===== Bottoni in fondo =====

  const canEdit = currentUser?.role === 'admin' || task.createdBy.id === currentUser?.id;

  const footer = el('div', 'form-actions');
  footer.style.marginTop = 'var(--space-5)';

  if (canEdit) {
    const editButton = el('button', 'btn btn--secondary', 'Modifica');
    editButton.type = 'button';
    editButton.addEventListener('click', () => {
      modal.close();
      onEdit?.(task);
    });

    const deleteButton = el('button', 'btn btn--danger', 'Elimina');
    deleteButton.type = 'button';
    deleteButton.addEventListener('click', async () => {
      let message = `Eliminare "${task.title}"?`;
      if (children.length > 0) {
        message += ` Le sue ${children.length} sotto-attività non verranno eliminate ma resteranno senza genitore.`;
      }
      message += ' Anche i commenti verranno eliminati.';

      const ok = await confirmDialog(message, {
        title: 'Elimina attività',
        okLabel: 'Elimina',
        danger: true,
      });
      if (!ok) return;

      deleteButton.disabled = true;
      try {
        await deleteTask(task.id);
        modal.close();
        showToast('Attività eliminata', 'success');
        onDeleted?.(task.id);
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'Errore imprevisto, riprova', 'error');
        deleteButton.disabled = false;
      }
    });

    footer.append(editButton, deleteButton);
  } else {
    footer.append(
      el('p', 'detail__note', 'Solo l’autore o un admin può modificare questa attività'),
    );
  }

  const closeButton = el('button', 'btn btn--secondary', 'Chiudi');
  closeButton.type = 'button';
  closeButton.addEventListener('click', () => modal.close());
  footer.append(closeButton);
  content.append(footer);

  const modal = openModal(content, {
    title: task.title,
    size: 'lg',
    onClose: () => {
      closed = true;
    },
  });

  loadComments();
}
