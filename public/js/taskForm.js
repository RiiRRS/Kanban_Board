// Finestra per creare o modificare un'attività

import { createTask, updateTask, createLabel, ApiError } from './api.js';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  RECURRENCES,
  RECURRENCE_LABELS,
  TASK_COLORS,
  DEFAULT_COLOR,
  LIMITS,
} from './constants.js';
import {
  normalizeTaskInput,
  validateTaskInput,
  getDescendantIds,
  formatMinutes,
} from './validation.js';
import { openModal, showToast, confirmDialog } from './ui.js';
import { withConfirmation, Cancelled } from './confirmFlow.js';
import { todayISO } from './format.js';
import { renderMarkdown } from './markdown.js';
import { createAvatar, nameOf } from './avatar.js';
import { el, spinner, errorMessage } from './dom.js';

// campo di TaskInput → id del controllo nel form (nell'ordine del form)
const FIELD_IDS = {
  title: 'task-title',
  description: 'task-description',
  date: 'task-date',
  startTime: 'task-start',
  endTime: 'task-end',
  columnId: 'task-column',
  priority: 'task-priority',
  assigneeIds: 'task-assignees',
  labelIds: 'task-labels',
  estimateMin: 'task-estimate',
  spentMin: 'task-spent',
  recurrence: 'task-recurrence',
  color: 'task-color',
  parentId: 'task-parent',
};

const pad = (n) => String(n).padStart(2, '0');

// prossima ora piena (14:20 → 15:00); dopo le 23 → 09:00
function defaultStartTime() {
  const hour = new Date().getHours() + 1;
  return hour > 23 ? '09:00' : `${pad(hour)}:00`;
}

// un'ora dopo, al massimo 23:59
function addOneHour(time) {
  const [h, m] = time.split(':').map(Number);
  return h + 1 > 23 ? '23:59' : `${pad(h + 1)}:${pad(m)}`;
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// crea div.form-field > label + controllo + p.form-error
function createField(label, control, { required = false, labelFor = true } = {}) {
  const field = el('div', 'form-field');

  const labelEl = el('label', 'form-label', label);
  if (labelFor) labelEl.htmlFor = control.id;
  labelEl.id = `${control.id}-label`;
  if (required) {
    const star = el('span', null, ' *');
    star.setAttribute('aria-hidden', 'true');
    labelEl.append(star);
  }

  const error = el('p', 'form-error');
  error.id = `${control.id}-error`;
  control.setAttribute('aria-describedby', error.id);

  field.append(labelEl, control, error);
  return field;
}

function createInput(id, type, value) {
  const input = el('input', 'input');
  input.id = id;
  input.type = type;
  input.value = value;
  return input;
}

function createSelect(id, options, value) {
  const select = el('select', 'select');
  select.id = id;
  for (const [optionValue, text] of options) select.add(new Option(text, optionValue));
  select.value = value;
  return select;
}

// campo numerico in minuti, con la durata leggibile accanto ("90" → "1h 30m")
function createMinutesInput(id, value) {
  const input = createInput(id, 'number', value == null ? '' : String(value));
  input.min = '0';
  input.max = String(LIMITS.minutesMax);
  input.step = '5';
  input.inputMode = 'numeric';
  input.placeholder = 'minuti';
  const hint = el('p', 'form-hint');
  const update = () => {
    const n = Number(input.value);
    hint.textContent =
      input.value !== '' && Number.isInteger(n) && n >= 0 ? `= ${formatMinutes(n)}` : '';
  };
  input.addEventListener('input', update);
  update();
  return { input, hint };
}

export function openTaskForm({
  task = null,
  columnId = null,
  date: presetDate = null,
  columns = [],
  labels: boardLabels = [],
  users = [],
  allTasks = [],
  boardId,
  onSaved,
  onLabelCreated,
} = {}) {
  const isEdit = task !== null;
  const startTime = task?.startTime ?? defaultStartTime();
  const initial = {
    title: task?.title ?? '',
    description: task?.description ?? '',
    date: task?.date ?? presetDate ?? todayISO(),
    startTime,
    endTime: task?.endTime ?? addOneHour(startTime),
    columnId: String(task?.columnId ?? columnId ?? columns[0]?.id ?? ''),
    priority: task?.priority ?? 'medium',
    assigneeIds: (task?.assignees ?? []).map((a) => a.id).sort((a, b) => a - b),
    labelIds: (task?.labels ?? []).map((l) => l.id).sort((a, b) => a - b),
    estimateMin: task?.estimateMin == null ? '' : String(task.estimateMin),
    spentMin: String(task?.spentMin ?? 0),
    recurrence: task?.recurrence ?? 'none',
    // <input type=color> restituisce sempre minuscolo
    color: (task?.color ?? DEFAULT_COLOR).toLowerCase(),
    parentId: task?.parentId != null ? String(task.parentId) : '',
  };

  // ===== Campi =====

  const form = el('form');
  form.noValidate = true;

  const alert = el('div', 'form-alert');
  alert.setAttribute('role', 'alert');
  alert.hidden = true;

  const title = createInput('task-title', 'text', initial.title);
  title.maxLength = LIMITS.titleMax;
  title.required = true;

  // descrizione in Markdown, con anteprima
  const description = el('textarea', 'textarea');
  description.id = 'task-description';
  description.maxLength = LIMITS.descriptionMax;
  description.rows = 5;
  description.value = initial.description;
  description.placeholder = 'Supporta il Markdown: **grassetto**, elenchi, [link](https://…)';
  const preview = el('div', 'markdown-preview');
  preview.hidden = true;
  const counter = el('p', 'form-hint');
  const updateCounter = () => {
    counter.textContent = `${description.value.length}/${LIMITS.descriptionMax}`;
  };
  updateCounter();
  description.addEventListener('input', updateCounter);
  const previewToggle = el('button', 'btn btn--ghost', 'Anteprima');
  previewToggle.type = 'button';
  previewToggle.setAttribute('aria-pressed', 'false');
  previewToggle.addEventListener('click', () => {
    const show = preview.hidden;
    if (show) {
      preview.replaceChildren(
        description.value.trim()
          ? renderMarkdown(description.value)
          : el('p', 'detail__muted', 'Niente da mostrare'),
      );
    }
    preview.hidden = !show;
    description.hidden = show;
    previewToggle.textContent = show ? 'Modifica' : 'Anteprima';
    previewToggle.setAttribute('aria-pressed', String(show));
  });

  const date = createInput('task-date', 'date', initial.date);
  date.required = true;
  const start = createInput('task-start', 'time', initial.startTime);
  start.required = true;
  const end = createInput('task-end', 'time', initial.endTime);
  end.required = true;

  // se la fine non è ancora stata toccata, segue l'inizio
  let endTouched = false;
  end.addEventListener('input', () => (endTouched = true));
  start.addEventListener('input', () => {
    if (!endTouched && start.value) end.value = addOneHour(start.value);
  });

  const columnSelect = createSelect(
    'task-column',
    columns.map((c) => [String(c.id), c.name]),
    initial.columnId,
  );
  const prioritySelect = createSelect(
    'task-priority',
    PRIORITIES.map((p) => [p, PRIORITY_LABELS[p]]),
    initial.priority,
  );
  const recurrenceSelect = createSelect(
    'task-recurrence',
    RECURRENCES.map((r) => [r, RECURRENCE_LABELS[r]]),
    initial.recurrence,
  );
  const recurrenceHint = el(
    'p',
    'form-hint',
    'Quando la completi, ne nasce una nuova alla data successiva.',
  );
  const updateRecurrenceHint = () => (recurrenceHint.hidden = recurrenceSelect.value === 'none');
  recurrenceSelect.addEventListener('change', updateRecurrenceHint);
  updateRecurrenceHint();

  // assegnatari: una casella per persona
  const assignees = el('div', 'check-list');
  assignees.id = 'task-assignees';
  assignees.setAttribute('role', 'group');
  assignees.setAttribute('aria-labelledby', 'task-assignees-label');
  const assigneeBoxes = users.map((u) => {
    const row = el('label', 'check-list__item');
    const box = el('input');
    box.type = 'checkbox';
    box.value = String(u.id);
    box.checked = initial.assigneeIds.includes(u.id);
    row.append(box, createAvatar(u, { size: 20 }), el('span', null, nameOf(u)));
    assignees.append(row);
    return box;
  });
  if (users.length === 0) assignees.append(el('p', 'detail__muted', 'Nessun utente'));

  // etichette: pulsanti a scelta multipla + creazione al volo
  const labels = el('div', 'chip-list');
  labels.id = 'task-labels';
  labels.setAttribute('role', 'group');
  labels.setAttribute('aria-labelledby', 'task-labels-label');
  const selectedLabels = new Set(initial.labelIds);
  const labelButtons = new Map();
  const addLabelChip = (label) => {
    const chip = el('button', 'label-chip label-chip--toggle', label.name);
    chip.type = 'button';
    chip.style.setProperty('--label-color', label.color);
    chip.setAttribute('aria-pressed', String(selectedLabels.has(label.id)));
    chip.addEventListener('click', () => {
      if (selectedLabels.has(label.id)) selectedLabels.delete(label.id);
      else selectedLabels.add(label.id);
      chip.setAttribute('aria-pressed', String(selectedLabels.has(label.id)));
      clearFieldError('labelIds');
    });
    labelButtons.set(label.id, chip);
    labels.insertBefore(chip, newLabel);
  };
  const newLabel = el('div', 'chip-add');
  const newLabelName = el('input', 'input');
  newLabelName.type = 'text';
  newLabelName.maxLength = LIMITS.labelNameMax;
  newLabelName.placeholder = 'Nuova etichetta';
  newLabelName.setAttribute('aria-label', 'Nome della nuova etichetta');
  const newLabelButton = el('button', 'btn btn--secondary', 'Aggiungi');
  newLabelButton.type = 'button';
  const createNewLabel = async () => {
    const name = newLabelName.value.trim();
    if (!name) return;
    newLabelButton.disabled = true;
    try {
      const label = await createLabel(boardId, {
        name,
        color: TASK_COLORS[(boardLabels.length + labelButtons.size) % TASK_COLORS.length],
      });
      selectedLabels.add(label.id);
      addLabelChip(label);
      onLabelCreated?.(label);
      newLabelName.value = '';
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      newLabelButton.disabled = false;
    }
  };
  newLabelButton.addEventListener('click', createNewLabel);
  // Invio nel campo crea l'etichetta invece di salvare l'attività
  newLabelName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createNewLabel();
    }
  });
  newLabel.append(newLabelName, newLabelButton);
  labels.append(newLabel);
  boardLabels.forEach(addLabelChip);

  const estimate = createMinutesInput('task-estimate', task?.estimateMin);
  const spent = createMinutesInput('task-spent', task?.spentMin ?? 0);

  // colore: palette di palline + input type=color che tiene il valore vero
  const color = createInput('task-color', 'color', initial.color);
  const palette = el('div', 'color-palette');
  palette.setAttribute('role', 'radiogroup');
  palette.setAttribute('aria-label', 'Colore');
  const swatches = TASK_COLORS.map((c) => {
    const swatch = el('button', 'color-swatch');
    swatch.type = 'button';
    swatch.setAttribute('role', 'radio');
    swatch.setAttribute('aria-label', `Colore ${c}`);
    swatch.style.background = c;
    swatch.dataset.color = c;
    swatch.addEventListener('click', () => {
      color.value = c;
      updateSwatches();
    });
    return swatch;
  });
  const updateSwatches = () => {
    for (const s of swatches) {
      s.setAttribute('aria-checked', String(s.dataset.color === color.value.toLowerCase()));
    }
  };
  color.addEventListener('input', updateSwatches);
  updateSwatches();
  palette.append(...swatches, color);

  // genitore: tutte tranne l'attività stessa e i suoi discendenti (niente cicli)
  const excluded = isEdit ? getDescendantIds(allTasks, task.id).add(task.id) : new Set();
  const columnName = new Map(columns.map((c) => [c.id, c.name]));
  const parentOptions = allTasks
    .filter((t) => !excluded.has(t.id))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((t) => [String(t.id), `${truncate(t.title, 50)} (${columnName.get(t.columnId) ?? '?'})`]);
  const parent = createSelect(
    'task-parent',
    [['', '— Nessuna —'], ...parentOptions],
    initial.parentId,
  );

  const timeRow = el('div', 'form-row');
  timeRow.append(
    createField('Inizio', start, { required: true }),
    createField('Fine', end, { required: true }),
  );

  const selectRow = el('div', 'form-row');
  selectRow.append(createField('Colonna', columnSelect), createField('Priorità', prioritySelect));

  const effortRow = el('div', 'form-row');
  const estimateField = createField('Stima (minuti)', estimate.input);
  estimateField.append(estimate.hint);
  const spentField = createField('Tempo effettivo (minuti)', spent.input);
  spentField.append(spent.hint);
  effortRow.append(estimateField, spentField);

  const descriptionField = createField('Descrizione', description);
  descriptionField.querySelector('.form-label').after(previewToggle);
  description.after(preview);
  descriptionField.append(counter);

  const colorField = createField('Colore', color, { labelFor: false });
  color.setAttribute('aria-label', 'Colore personalizzato');
  palette.setAttribute('aria-labelledby', 'task-color-label');
  colorField.insertBefore(palette, color);

  const recurrenceField = createField('Ripetizione', recurrenceSelect);
  recurrenceField.append(recurrenceHint);

  // ===== Bottoni =====

  const actions = el('div', 'form-actions');
  const cancelButton = el('button', 'btn btn--secondary', 'Annulla');
  cancelButton.type = 'button';
  const saveButton = el('button', 'btn btn--primary', isEdit ? 'Salva modifiche' : 'Crea attività');
  saveButton.type = 'submit';
  actions.append(cancelButton, saveButton);

  form.append(
    alert,
    createField('Titolo', title, { required: true }),
    descriptionField,
    createField('Data', date, { required: true }),
    timeRow,
    selectRow,
    createField('Assegnata a', assignees, { labelFor: false }),
    createField('Etichette', labels, { labelFor: false }),
    effortRow,
    recurrenceField,
    colorField,
    createField('Genitore', parent),
    actions,
  );

  // ===== Stato del form =====

  const controls = {
    title,
    description,
    date,
    startTime: start,
    endTime: end,
    columnId: columnSelect,
    priority: prioritySelect,
    assigneeIds: assignees,
    labelIds: labels,
    estimateMin: estimate.input,
    spentMin: spent.input,
    recurrence: recurrenceSelect,
    color,
    parentId: parent,
  };

  const readValues = () => ({
    title: title.value,
    description: description.value,
    date: date.value,
    startTime: start.value,
    endTime: end.value,
    columnId: columnSelect.value,
    priority: prioritySelect.value,
    assigneeIds: assigneeBoxes
      .filter((b) => b.checked)
      .map((b) => Number(b.value))
      .sort((a, b) => a - b),
    labelIds: [...selectedLabels].sort((a, b) => a - b),
    estimateMin: estimate.input.value,
    spentMin: spent.input.value,
    recurrence: recurrenceSelect.value,
    color: color.value,
    parentId: parent.value,
  });

  const isDirty = () => JSON.stringify(readValues()) !== JSON.stringify(initial);

  let saving = false;

  const askDiscard = () =>
    confirmDialog('Hai modifiche non salvate. Vuoi chiudere senza salvare?', {
      okLabel: 'Chiudi senza salvare',
      danger: true,
    });

  const modal = openModal(form, {
    title: isEdit ? 'Modifica attività' : 'Nuova attività',
    size: 'drawer',
    beforeClose: () => {
      if (saving) return false;
      return isDirty() ? askDiscard() : true;
    },
  });

  cancelButton.addEventListener('click', async () => {
    if (saving) return;
    if (!isDirty() || (await askDiscard())) modal.close();
  });

  // ===== Errori =====

  function showFieldError(field, message) {
    const control = controls[field];
    control.classList.add('input--invalid');
    control.setAttribute('aria-invalid', 'true');
    document.getElementById(`${FIELD_IDS[field]}-error`).textContent = message;
  }

  function clearFieldError(field) {
    const control = controls[field];
    control.classList.remove('input--invalid');
    control.removeAttribute('aria-invalid');
    document.getElementById(`${FIELD_IDS[field]}-error`).textContent = '';
  }

  function clearErrors() {
    for (const field of Object.keys(controls)) clearFieldError(field);
    alert.textContent = '';
    alert.hidden = true;
  }

  // porta il cursore sul campo con l'errore (nei gruppi, sul primo elemento dentro)
  const focusField = (field) =>
    (controls[field].matches('input, select, textarea')
      ? controls[field]
      : controls[field].querySelector('input, button')
    )?.focus();

  // l'errore di un campo sparisce quando lo si corregge
  for (const [field, control] of Object.entries(controls)) {
    control.addEventListener('input', () => clearFieldError(field));
    control.addEventListener('change', () => clearFieldError(field));
  }

  // ===== Salvataggio =====

  // nella descrizione Invio va a capo, Ctrl+Invio salva
  description.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  function setSaving(value) {
    saving = value;
    saveButton.disabled = value;
    cancelButton.disabled = value;
    if (value) {
      saveButton.textContent = '';
      saveButton.append(spinner(), ' Salvataggio…');
    } else {
      saveButton.textContent = isEdit ? 'Salva modifiche' : 'Crea attività';
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return;
    clearErrors();

    const input = normalizeTaskInput(readValues());
    const errors = validateTaskInput(input);

    const fields = Object.keys(FIELD_IDS).filter((f) => errors[f]);
    if (fields.length > 0) {
      fields.forEach((f) => showFieldError(f, errors[f]));
      focusField(fields[0]);
      return;
    }

    setSaving(true);
    let keepDisabled = false;
    try {
      // conflitto d'orario e limite WIP: il server avvisa, qui si chiede conferma
      const saved = await withConfirmation((flags) =>
        isEdit ? updateTask(task.id, input, flags) : createTask(input, flags),
      );
      modal.close();
      showToast(isEdit ? 'Attività aggiornata' : 'Attività creata', 'success');
      onSaved?.(saved);
      return;
    } catch (err) {
      if (!(err instanceof Cancelled)) {
        const message = errorMessage(err);
        if (err instanceof ApiError && err.field && controls[err.field]) {
          showFieldError(err.field, message);
          focusField(err.field);
        } else {
          alert.textContent = message;
          alert.hidden = false;
        }
        keepDisabled = err instanceof ApiError && err.status === 403;
      }
    }
    setSaving(false);
    // senza permessi non ha senso riprovare
    if (keepDisabled) saveButton.disabled = true;
  });
}
