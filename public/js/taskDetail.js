// Finestra di dettaglio di un'attività: dati, descrizione, tempo, gerarchia, checklist,
// allegati, commenti e cronologia

import { deleteTask, getTask, setSpentMinutes, ApiError } from './api.js';
import { PRIORITY_LABELS, RECURRENCE_LABELS } from './constants.js';
import { formatDate, formatTimeRange, formatDateTime, isOverdue } from './format.js';
import { formatMinutes } from './validation.js';
import { renderMarkdown } from './markdown.js';
import { createAvatar, nameOf } from './avatar.js';
import { createChecklist } from './checklist.js';
import { createAttachments } from './attachments.js';
import { createComments } from './comments.js';
import { createTaskHistory } from './history.js';
import { el, button, spinner, errorMessage } from './dom.js';
import { icon } from './icons.js';
import { openModal, showToast, confirmDialog } from './ui.js';

function createSection(title) {
  const section = el('section', 'detail__section');
  const heading = el('h3', 'detail__section-title', title);
  section.append(heading);
  return { section, heading };
}

// bottone testuale, con un'icona opzionale davanti
function createLink(text, onClick, iconName) {
  const link = el('button', 'detail__link');
  if (iconName) link.append(icon(iconName));
  link.append(text);
  link.type = 'button';
  link.addEventListener('click', onClick);
  return link;
}

function progressBar(done, total, { over = false } = {}) {
  const wrap = el('div', 'progress progress--wide');
  const track = el('div', 'progress__bar');
  const fill = el('div', 'progress__fill');
  fill.style.width = `${total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100))}%`;
  if (over) fill.classList.add('progress__fill--over');
  else if (total > 0 && done >= total) fill.classList.add('progress__fill--complete');
  track.append(fill);
  wrap.append(track);
  return wrap;
}

export function openTaskDetail({
  task,
  allTasks = [],
  columns = [],
  users = [],
  currentUser,
  onEdit,
  onDeleted,
  onOpenTask,
  onChanged,
  onArchive,
} = {}) {
  const content = el('div');
  let closed = false;

  const isAssignee = task.assignees.some((a) => a.id === currentUser?.id);
  const canEdit = currentUser?.role === 'admin' || task.createdBy.id === currentUser?.id;
  const canContribute = canEdit || isAssignee;
  const column = columns.find((c) => c.id === task.columnId);

  // ===== Dati =====

  const colorBar = el('div', 'detail__color');
  colorBar.style.background = task.color;

  const badges = el('div', 'detail__badges');
  badges.append(
    el('span', 'badge', column?.name ?? '—'),
    el('span', `badge badge--priority-${task.priority}`, PRIORITY_LABELS[task.priority]),
  );
  if (isOverdue(task)) badges.append(el('span', 'badge badge--danger', 'Scaduta'));
  if (task.archivedAt) badges.append(el('span', 'badge', 'Archiviata'));
  if (task.recurrence !== 'none') {
    const repeat = el('span', 'badge');
    repeat.append(icon('repeat'), RECURRENCE_LABELS[task.recurrence]);
    badges.append(repeat);
  }

  const meta = el('dl', 'detail__meta');
  const addMeta = (label, value) => {
    const dd = el('dd');
    if (value instanceof Node) dd.append(value);
    else dd.textContent = value;
    meta.append(el('dt', '', label), dd);
  };
  addMeta('Data', formatDate(task.date));
  addMeta('Orario', formatTimeRange(task.startTime, task.endTime));

  const people = el('div', 'detail__people');
  if (task.assignees.length === 0) people.append(el('span', 'detail__muted', 'Nessuno'));
  for (const a of task.assignees) {
    const person = el('span', 'person');
    person.append(createAvatar(a, { size: 22 }), el('span', null, nameOf(a)));
    people.append(person);
  }
  addMeta('Assegnata a', people);

  if (task.labels.length > 0) {
    const chips = el('div', 'chip-list');
    for (const l of task.labels) {
      const chip = el('span', 'label-chip', l.name);
      chip.style.setProperty('--label-color', l.color);
      chips.append(chip);
    }
    addMeta('Etichette', chips);
  }

  addMeta('Creata da', `${task.createdBy.username}, ${formatDateTime(task.createdAt)}`);
  if (task.updatedAt !== task.createdAt) addMeta('Ultima modifica', formatDateTime(task.updatedAt));

  const description = task.description
    ? renderMarkdown(task.description)
    : el('p', 'detail__muted', 'Nessuna descrizione');

  content.append(colorBar, badges, meta, description);

  // ===== Tempo =====

  if (task.estimateMin != null || task.spentMin > 0 || canContribute) {
    const time = createSection('Tempo');
    const summary = el('p');
    const barHolder = el('div');
    let spent = task.spentMin;

    const renderTime = () => {
      const over = task.estimateMin != null && spent > task.estimateMin;
      summary.textContent =
        task.estimateMin != null
          ? `${formatMinutes(spent)} su ${formatMinutes(task.estimateMin)} stimati${over ? ' (oltre la stima)' : ''}`
          : `${formatMinutes(spent)} registrati, nessuna stima`;
      barHolder.replaceChildren(
        task.estimateMin ? progressBar(spent, task.estimateMin, { over }) : '',
      );
    };
    renderTime();
    time.section.append(summary, barHolder);

    // aggiungere tempo è permesso anche a chi è assegnato
    if (canContribute) {
      const quick = el('div', 'quick-time');
      for (const minutes of [15, 30, 60]) {
        const add = button(`+${formatMinutes(minutes)}`, 'btn btn--secondary', async () => {
          add.disabled = true;
          try {
            const saved = await setSpentMinutes(task.id, spent + minutes);
            spent = saved.spentMin;
            task.spentMin = spent;
            renderTime();
            onChanged?.();
          } catch (err) {
            showToast(errorMessage(err), 'error');
          } finally {
            add.disabled = false;
          }
        });
        quick.append(add);
      }
      time.section.append(quick);
    }
    content.append(time.section);
  }

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
  const columnName = new Map(columns.map((c) => [c.id, c.name]));
  if (children.length > 0) {
    const doneCount = children.filter((c) => c.isDone).length;
    hierarchy.section.append(parentLine);
    hierarchy.section.append(
      el('p', 'detail__muted', `${doneCount} su ${children.length} sotto-attività completate`),
    );
    hierarchy.section.append(progressBar(doneCount, children.length));
    for (const child of children) {
      childrenList.append(
        createLink(
          `${child.title} · ${columnName.get(child.columnId) ?? ''}`,
          () => openOther(child.id),
          child.isDone ? 'check' : null,
        ),
      );
    }
  } else {
    hierarchy.section.append(parentLine);
    childrenList.append(el('span', 'detail__muted', 'Nessuna sotto-attività'));
  }
  hierarchy.section.append(childrenList);
  content.append(hierarchy.section);

  // ===== Checklist e allegati (caricati dal server insieme) =====

  const checklist = createSection('Checklist');
  const attachmentsSection = createSection('Allegati');
  const loadingChecklist = el('p', 'comments__status');
  loadingChecklist.append(spinner(), 'Caricamento…');
  checklist.section.append(loadingChecklist);
  attachmentsSection.section.append(el('p', 'comments__status', 'Caricamento…'));
  content.append(checklist.section, attachmentsSection.section);

  getTask(task.id)
    .then((full) => {
      if (closed) return;
      loadingChecklist.replaceWith(
        createChecklist({
          taskId: task.id,
          items: full.checklist,
          canContribute,
          onChange: onChanged,
        }),
      );
      attachmentsSection.section.lastElementChild.replaceWith(
        createAttachments({
          taskId: task.id,
          items: full.attachments,
          canContribute,
          // chi ha caricato un file lo toglie; chi può modificare l'attività toglie tutto
          canDelete: (att) => canEdit || att.uploadedBy === currentUser?.id,
          onChange: onChanged,
        }),
      );
    })
    .catch((err) => {
      if (closed) return;
      const message = el('p', 'detail__muted', errorMessage(err));
      loadingChecklist.replaceWith(message);
      attachmentsSection.section.lastElementChild.replaceWith(el('p', 'detail__muted', '—'));
    });

  // ===== Commenti =====

  const comments = createSection('Commenti (0)');
  const commentsUi = createComments({
    taskId: task.id,
    currentUser,
    users,
    onChange: onChanged,
    onCount: (n) => (comments.heading.textContent = `Commenti (${n})`),
  });
  comments.section.append(commentsUi.element);
  content.append(comments.section);

  content.append(createTaskHistory(task.id));

  // ===== Bottoni in fondo =====

  const footer = el('div', 'form-actions');
  footer.style.marginTop = 'var(--space-5)';

  if (canEdit) {
    footer.append(
      button('Modifica', 'btn btn--secondary', () => {
        modal.close();
        onEdit?.(task);
      }),
    );
  }
  // archiviare e ripristinare si possono annullare a vicenda: sono per tutti, come spostare
  footer.append(
    button(task.archivedAt ? 'Ripristina' : 'Archivia', 'btn btn--secondary', async () => {
      modal.close();
      onArchive?.(task.id, !task.archivedAt);
    }),
  );

  if (canEdit) {
    const deleteButton = button('Elimina', 'btn btn--danger', async () => {
      let message = `Eliminare "${task.title}"?`;
      if (children.length > 0) {
        message += ` Le sue ${children.length} sotto-attività non verranno eliminate ma resteranno senza genitore.`;
      }
      message += ' Anche commenti, checklist e allegati verranno eliminati.';

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
    footer.append(deleteButton);
  } else {
    footer.append(
      el('p', 'detail__note', 'Solo l’autore o un admin può modificare questa attività'),
    );
  }

  footer.append(button('Chiudi', 'btn btn--secondary', () => modal.close()));
  content.append(footer);

  const modal = openModal(content, {
    title: task.title,
    size: 'drawer',
    onClose: () => {
      closed = true;
      commentsUi.close();
    },
  });
}
