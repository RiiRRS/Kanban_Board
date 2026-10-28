// Finestra per creare o modificare un'attività

import { createTask, updateTask, ApiError } from './api.js';
import {
  STATUSES,
  STATUS_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  TASK_COLORS,
  DEFAULT_COLOR,
  LIMITS,
} from './constants.js';
import {
  normalizeTaskInput,
  validateTaskInput,
  findTimeConflict,
  getDescendantIds,
} from './validation.js';
import { openModal, showToast, confirmDialog } from './ui.js';
import { todayISO } from './format.js';

// campo di TaskInput → id del controllo nel form (nell'ordine del form)
const FIELD_IDS = {
  title: 'task-title',
  description: 'task-description',
  date: 'task-date',
  startTime: 'task-start',
  endTime: 'task-end',
  status: 'task-status',
  priority: 'task-priority',
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
function createField(label, control, { required = false } = {}) {
  const field = document.createElement('div');
  field.className = 'form-field';

  const labelEl = document.createElement('label');
  labelEl.className = 'form-label';
  labelEl.htmlFor = control.id;
  labelEl.textContent = label;
  if (required) {
    const star = document.createElement('span');
    star.setAttribute('aria-hidden', 'true');
    star.textContent = ' *';
    labelEl.append(star);
  }

  const error = document.createElement('p');
  error.className = 'form-error';
  error.id = `${control.id}-error`;
  control.setAttribute('aria-describedby', error.id);

  field.append(labelEl, control, error);
  return field;
}

function createInput(id, type, value) {
  const input = document.createElement('input');
  input.id = id;
  input.className = 'input';
  input.type = type;
  input.value = value;
  return input;
}

function createSelect(id, options, value) {
  const select = document.createElement('select');
  select.id = id;
  select.className = 'select';
  for (const [optionValue, text] of options) select.add(new Option(text, optionValue));
  select.value = value;
  return select;
}

export function openTaskForm({ task = null, status = 'todo', allTasks = [], onSaved } = {}) {
  const isEdit = task !== null;
  const startTime = task?.startTime ?? defaultStartTime();
  const initial = {
    title: task?.title ?? '',
    description: task?.description ?? '',
    date: task?.date ?? todayISO(),
    startTime,
    endTime: task?.endTime ?? addOneHour(startTime),
    status: task?.status ?? status,
    priority: task?.priority ?? 'medium',
    color: task?.color ?? DEFAULT_COLOR,
    parentId: task?.parentId != null ? String(task.parentId) : '',
  };

  // ===== Campi =====

  const form = document.createElement('form');
  form.noValidate = true;

  const alert = document.createElement('div');
  alert.className = 'form-alert';
  alert.setAttribute('role', 'alert');
  alert.hidden = true;

  const title = createInput('task-title', 'text', initial.title);
  title.maxLength = LIMITS.titleMax;
  title.required = true;

  const description = document.createElement('textarea');
  description.id = 'task-description';
  description.className = 'textarea';
  description.maxLength = LIMITS.descriptionMax;
  description.value = initial.description;
  const counter = document.createElement('p');
  counter.className = 'form-hint';
  const updateCounter = () => {
    counter.textContent = `${description.value.length}/${LIMITS.descriptionMax}`;
  };
  updateCounter();
  description.addEventListener('input', updateCounter);

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

  const statusSelect = createSelect(
    'task-status',
    STATUSES.map((s) => [s, STATUS_LABELS[s]]),
    initial.status,
  );
  const prioritySelect = createSelect(
    'task-priority',
    PRIORITIES.map((p) => [p, PRIORITY_LABELS[p]]),
    initial.priority,
  );

  // colore: palette di palline + input type=color che tiene il valore vero
  const color = createInput('task-color', 'color', initial.color);
  const palette = document.createElement('div');
  palette.className = 'color-palette';
  palette.setAttribute('role', 'radiogroup');
  palette.setAttribute('aria-label', 'Colore');
  const swatches = TASK_COLORS.map((c) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch';
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
  const parentOptions = allTasks
    .filter((t) => !excluded.has(t.id))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((t) => [String(t.id), `${truncate(t.title, 50)} (${STATUS_LABELS[t.status]})`]);
  const parent = createSelect(
    'task-parent',
    [['', '— Nessuna —'], ...parentOptions],
    initial.parentId,
  );

  const timeRow = document.createElement('div');
  timeRow.className = 'form-row';
  timeRow.append(
    createField('Inizio', start, { required: true }),
    createField('Fine', end, { required: true }),
  );

  const selectRow = document.createElement('div');
  selectRow.className = 'form-row';
  selectRow.append(createField('Stato', statusSelect), createField('Priorità', prioritySelect));

  const descriptionField = createField('Descrizione', description);
  descriptionField.append(counter);

  const colorField = createField('Colore', color);
  colorField.querySelector('.form-label').removeAttribute('for');
  colorField.querySelector('.form-label').id = 'task-color-label';
  palette.setAttribute('aria-labelledby', 'task-color-label');
  color.setAttribute('aria-label', 'Colore personalizzato');
  colorField.insertBefore(palette, color);

  // ===== Bottoni =====

  const actions = document.createElement('div');
  actions.className = 'form-actions';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--secondary';
  cancelButton.textContent = 'Annulla';
  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = isEdit ? 'Salva modifiche' : 'Crea attività';
  actions.append(cancelButton, saveButton);

  form.append(
    alert,
    createField('Titolo', title, { required: true }),
    descriptionField,
    createField('Data', date, { required: true }),
    timeRow,
    selectRow,
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
    status: statusSelect,
    priority: prioritySelect,
    color,
    parentId: parent,
  };

  const readValues = () =>
    Object.fromEntries(Object.entries(controls).map(([key, el]) => [key, el.value]));

  const isDirty = () => JSON.stringify(readValues()) !== JSON.stringify(initial);

  let saving = false;

  const askDiscard = () =>
    confirmDialog('Hai modifiche non salvate. Vuoi chiudere senza salvare?', {
      okLabel: 'Chiudi senza salvare',
      danger: true,
    });

  const modal = openModal(form, {
    title: isEdit ? 'Modifica attività' : 'Nuova attività',
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

  function clearErrors() {
    for (const field of Object.keys(controls)) {
      controls[field].classList.remove('input--invalid');
      controls[field].removeAttribute('aria-invalid');
      document.getElementById(`${FIELD_IDS[field]}-error`).textContent = '';
    }
    alert.textContent = '';
    alert.hidden = true;
  }

  // l'errore di un campo sparisce quando lo si corregge
  for (const [field, control] of Object.entries(controls)) {
    control.addEventListener('input', () => {
      control.classList.remove('input--invalid');
      control.removeAttribute('aria-invalid');
      document.getElementById(`${FIELD_IDS[field]}-error`).textContent = '';
    });
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
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      saveButton.append(spinner, ' Salvataggio…');
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
    if (!errors.startTime && !errors.date) {
      const conflict = findTimeConflict(allTasks, {
        id: task?.id ?? null,
        date: input.date,
        startTime: input.startTime,
      });
      if (conflict) {
        errors.startTime = `Esiste già un'attività che inizia alle ${input.startTime} in questo giorno`;
      }
    }

    const fields = Object.keys(FIELD_IDS).filter((f) => errors[f]);
    if (fields.length > 0) {
      fields.forEach((f) => showFieldError(f, errors[f]));
      controls[fields[0]].focus();
      return;
    }

    setSaving(true);
    let keepDisabled = false;
    try {
      const saved = isEdit ? await updateTask(task.id, input) : await createTask(input);
      modal.close();
      showToast(isEdit ? 'Attività aggiornata' : 'Attività creata', 'success');
      onSaved?.(saved);
      return;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Errore imprevisto, riprova';
      if (err instanceof ApiError && err.field && controls[err.field]) {
        showFieldError(err.field, message);
        controls[err.field].focus();
      } else {
        alert.textContent = message;
        alert.hidden = false;
      }
      keepDisabled = err instanceof ApiError && err.status === 403;
    }
    setSaving(false);
    // senza permessi non ha senso riprovare
    if (keepDisabled) saveButton.disabled = true;
  });
}
