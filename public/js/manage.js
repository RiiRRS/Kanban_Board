// Impostazioni della board: nome, colonne (ordine, limite WIP, "completati"), etichette,
// export e import. Chi non gestisce la board vede le impostazioni ma non le può cambiare.

import {
  getBoard,
  renameBoard,
  deleteBoard,
  createColumn,
  updateColumn,
  reorderColumns,
  deleteColumn,
  createLabel,
  updateLabel,
  deleteLabel,
  exportUrl,
  importBoard,
  ApiError,
} from './api.js';
import { LIMITS, TASK_COLORS } from './constants.js';
import { el, button, errorMessage } from './dom.js';
import { openModal, showToast, confirmDialog } from './ui.js';

function section(title, hint) {
  const s = el('section', 'detail__section');
  s.append(el('h3', 'detail__section-title', title));
  if (hint) s.append(el('p', 'form-hint', hint));
  return s;
}

function input(type, value, label, extra = {}) {
  const i = el('input', 'input');
  i.type = type;
  i.value = value ?? '';
  i.setAttribute('aria-label', label);
  Object.assign(i, extra);
  return i;
}

// chiede dove spostare le attività di una colonna che si sta eliminando
function askMoveTarget(columns, count, name) {
  return new Promise((resolve) => {
    const box = el('div');
    box.append(
      el(
        'p',
        null,
        `"${name}" contiene ${count} ${count === 1 ? 'attività' : 'attività'}. Dove le sposto?`,
      ),
    );
    const select = el('select', 'select');
    select.setAttribute('aria-label', 'Colonna di destinazione');
    for (const c of columns) select.append(new Option(c.name, String(c.id)));
    const actions = el('div', 'form-actions');
    actions.style.marginTop = 'var(--space-4)';
    let picked = null;
    const modal = openModal(box, {
      title: 'Elimina colonna',
      size: 'sm',
      onClose: () => resolve(picked),
    });
    actions.append(
      button('Annulla', 'btn btn--secondary', () => modal.close()),
      button('Sposta ed elimina', 'btn btn--danger', () => {
        picked = Number(select.value);
        modal.close();
      }),
    );
    box.append(select, actions);
  });
}

export function openBoardSettings({
  board,
  user,
  boardCount,
  onChanged,
  onBoardDeleted,
  onImported,
}) {
  const canManage = user.role === 'admin' || board.createdBy === user.id;
  const root = el('div', 'settings');
  let current = board;

  async function reload() {
    current = await getBoard(board.id);
    render();
    onChanged?.();
  }

  // esegue un'operazione, poi ricarica; gli errori vanno a schermo
  async function run(op, done) {
    try {
      await op();
      if (done) showToast(done, 'success');
      await reload();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  }

  function render() {
    root.replaceChildren();

    // ----- Nome -----
    const nameSection = section('Board');
    const nameRow = el('div', 'settings__row');
    const name = input('text', current.name, 'Nome della board', {
      maxLength: LIMITS.boardNameMax,
    });
    name.disabled = !canManage;
    nameRow.append(name);
    if (canManage) {
      nameRow.append(
        button('Rinomina', 'btn btn--secondary', () =>
          run(() => renameBoard(current.id, name.value), 'Board rinominata'),
        ),
      );
    }
    nameSection.append(nameRow);
    if (!canManage) {
      nameSection.append(
        el('p', 'detail__note', 'Solo chi ha creato la board o un admin può modificarla.'),
      );
    }
    root.append(nameSection);

    // ----- Colonne -----
    const columnsSection = section(
      'Colonne',
      'Il limite WIP segnala quando una colonna ha troppe attività. "Completata" indica le colonne del lavoro finito (contano per i progressi, le scadenze e le ricorrenze).',
    );
    const list = el('ul', 'settings__list');
    current.columns.forEach((column, index) => {
      const row = el('li', 'settings__item');
      const colName = input('text', column.name, `Nome della colonna ${index + 1}`, {
        maxLength: LIMITS.columnNameMax,
      });
      const wip = input('number', column.wipLimit ?? '', `Limite WIP di ${column.name}`, {
        min: '1',
        max: String(LIMITS.wipMax),
        placeholder: 'Limite',
      });
      wip.classList.add('settings__wip');
      const doneLabel = el('label', 'settings__check');
      const done = el('input');
      done.type = 'checkbox';
      done.checked = column.isDone;
      doneLabel.append(done, el('span', null, 'Completata'));
      for (const c of [colName, wip, done]) c.disabled = !canManage;
      row.append(colName, wip, doneLabel);

      if (canManage) {
        const up = button('↑', 'btn btn--ghost btn--icon', () => move(index, -1));
        up.setAttribute('aria-label', `Sposta ${column.name} a sinistra`);
        up.disabled = index === 0;
        const down = button('↓', 'btn btn--ghost btn--icon', () => move(index, 1));
        down.setAttribute('aria-label', `Sposta ${column.name} a destra`);
        down.disabled = index === current.columns.length - 1;
        const save = button('Salva', 'btn btn--secondary', () =>
          run(
            () =>
              updateColumn(current.id, column.id, {
                name: colName.value,
                wipLimit: wip.value === '' ? null : Number(wip.value),
                isDone: done.checked,
              }),
            'Colonna salvata',
          ),
        );
        const remove = button('Elimina', 'btn btn--ghost detail__link--danger', () =>
          removeColumn(column),
        );
        remove.disabled = current.columns.length <= 1;
        row.append(up, down, save, remove);
      }
      list.append(row);
    });
    columnsSection.append(list);

    if (canManage) {
      const addRow = el('div', 'settings__row');
      const newName = input('text', '', 'Nome della nuova colonna', {
        maxLength: LIMITS.columnNameMax,
        placeholder: 'Nuova colonna',
      });
      addRow.append(
        newName,
        button('Aggiungi colonna', 'btn btn--secondary', () => {
          if (newName.value.trim())
            run(() => createColumn(current.id, { name: newName.value }), 'Colonna aggiunta');
        }),
      );
      columnsSection.append(addRow);
    }
    root.append(columnsSection);

    // ----- Etichette -----
    const labelsSection = section(
      'Etichette',
      'Tutti possono crearne; modificarle o eliminarle spetta a chi gestisce la board.',
    );
    const labelList = el('ul', 'settings__list');
    for (const label of current.labels) {
      const row = el('li', 'settings__item');
      const color = input('color', label.color, `Colore di ${label.name}`);
      const text = input('text', label.name, `Nome dell'etichetta ${label.name}`, {
        maxLength: LIMITS.labelNameMax,
      });
      color.disabled = text.disabled = !canManage;
      row.append(color, text);
      if (canManage) {
        row.append(
          button('Salva', 'btn btn--secondary', () =>
            run(
              () => updateLabel(current.id, label.id, { name: text.value, color: color.value }),
              'Etichetta salvata',
            ),
          ),
          button('Elimina', 'btn btn--ghost detail__link--danger', async () => {
            const ok = await confirmDialog(
              `Eliminare l'etichetta "${label.name}"? Verrà tolta da tutte le attività.`,
              { title: 'Elimina etichetta', okLabel: 'Elimina', danger: true },
            );
            if (ok) run(() => deleteLabel(current.id, label.id), 'Etichetta eliminata');
          }),
        );
      }
      labelList.append(row);
    }
    if (current.labels.length === 0)
      labelList.append(el('p', 'detail__muted', 'Nessuna etichetta'));
    labelsSection.append(labelList);
    const addLabel = el('div', 'settings__row');
    const newColor = input(
      'color',
      TASK_COLORS[current.labels.length % TASK_COLORS.length],
      'Colore della nuova etichetta',
    );
    const newLabel = input('text', '', 'Nome della nuova etichetta', {
      maxLength: LIMITS.labelNameMax,
      placeholder: 'Nuova etichetta',
    });
    addLabel.append(
      newColor,
      newLabel,
      button('Aggiungi etichetta', 'btn btn--secondary', () => {
        if (newLabel.value.trim())
          run(
            () => createLabel(current.id, { name: newLabel.value, color: newColor.value }),
            'Etichetta aggiunta',
          );
      }),
    );
    labelsSection.append(addLabel);
    root.append(labelsSection);

    // ----- Dati -----
    const data = section(
      'Dati',
      'L’export contiene colonne, etichette, attività, commenti e link (non i file allegati). L’import crea sempre una board nuova.',
    );
    const links = el('div', 'settings__row');
    for (const [format, text] of [
      ['json', 'Esporta JSON'],
      ['csv', 'Esporta CSV'],
    ]) {
      const a = el('a', 'btn btn--secondary', text);
      a.href = exportUrl(current.id, format);
      a.download = '';
      links.append(a);
    }
    const file = el('input');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.hidden = true;
    file.addEventListener('change', async () => {
      const chosen = file.files[0];
      file.value = '';
      if (!chosen) return;
      try {
        const created = await importBoard(JSON.parse(await chosen.text()));
        showToast(`Board "${created.name}" importata`, 'success');
        modal.close();
        onImported?.(created);
      } catch (err) {
        showToast(
          err instanceof SyntaxError ? 'Il file non è un JSON valido' : errorMessage(err),
          'error',
        );
      }
    });
    links.append(
      button('Importa JSON…', 'btn btn--secondary', () => file.click()),
      file,
    );
    data.append(links);
    root.append(data);

    // ----- Elimina board -----
    if (canManage) {
      const danger = section('Zona pericolosa');
      const del = button('Elimina la board', 'btn btn--danger', async () => {
        const ok = await confirmDialog(
          `Eliminare "${current.name}" con tutte le sue attività, commenti e allegati? Non si può annullare.`,
          { title: 'Elimina board', okLabel: 'Elimina', danger: true },
        );
        if (!ok) return;
        try {
          await deleteBoard(current.id);
          showToast('Board eliminata', 'success');
          modal.close();
          onBoardDeleted?.(current.id);
        } catch (err) {
          showToast(errorMessage(err), 'error');
        }
      });
      del.disabled = boardCount <= 1;
      if (boardCount <= 1)
        danger.append(el('p', 'detail__note', 'È l’ultima board: non si può eliminare.'));
      danger.append(del);
      root.append(danger);
    }
  }

  function move(index, delta) {
    const ids = current.columns.map((c) => c.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    run(() => reorderColumns(current.id, ids));
  }

  async function removeColumn(column) {
    try {
      await deleteColumn(current.id, column.id);
      showToast('Colonna eliminata', 'success');
      await reload();
    } catch (err) {
      // con attività dentro il server chiede dove metterle
      if (err instanceof ApiError && err.code === 'column_not_empty') {
        const others = current.columns.filter((c) => c.id !== column.id);
        const target = await askMoveTarget(others, err.details.count, column.name);
        if (target) run(() => deleteColumn(current.id, column.id, target), 'Colonna eliminata');
      } else {
        showToast(errorMessage(err), 'error');
      }
    }
  }

  render();
  const modal = openModal(root, { title: 'Impostazioni della board', size: 'lg' });
}
