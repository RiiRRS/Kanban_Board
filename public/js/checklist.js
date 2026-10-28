// Checklist di un'attività: spunta, aggiungi, rinomina, elimina

import { addChecklistItem, updateChecklistItem, deleteChecklistItem } from './api.js';
import { LIMITS } from './constants.js';
import { el, button, errorMessage } from './dom.js';
import { showToast } from './ui.js';

// items: voci già caricate; canContribute: può modificarle; onChange: avvisa chi ha aperto la finestra
export function createChecklist({ taskId, items, canContribute, onChange }) {
  const root = el('div', 'checklist');
  let list = [...items];

  const bar = el('div', 'progress progress--wide');
  const fill = el('div', 'progress__fill');
  const label = el('span', 'progress__label');
  const track = el('div', 'progress__bar');
  track.append(fill);
  bar.append(label, track);

  const ul = el('ul', 'checklist__items');
  const empty = el('p', 'detail__muted', 'Nessuna voce');

  function refreshBar() {
    const done = list.filter((i) => i.done).length;
    label.textContent = `${done}/${list.length}`;
    fill.style.width = `${list.length ? Math.round((done / list.length) * 100) : 0}%`;
    fill.classList.toggle('progress__fill--complete', list.length > 0 && done === list.length);
    bar.hidden = list.length === 0;
    empty.hidden = list.length > 0;
  }

  function buildItem(item) {
    const li = el('li', 'checklist__item');
    const id = `check-${item.id}`;

    const box = el('input');
    box.type = 'checkbox';
    box.id = id;
    box.checked = item.done;
    box.disabled = !canContribute;
    box.addEventListener('change', async () => {
      const wanted = box.checked;
      try {
        const saved = await updateChecklistItem(taskId, item.id, { done: wanted });
        item.done = saved.done;
        text.classList.toggle('checklist__text--done', item.done);
        refreshBar();
        onChange?.();
      } catch (err) {
        box.checked = !wanted;
        showToast(errorMessage(err), 'error');
      }
    });

    const text = el('label', 'checklist__text', item.text);
    text.htmlFor = id;
    text.classList.toggle('checklist__text--done', item.done);

    li.append(box, text);

    if (canContribute) {
      const remove = button('×', 'btn btn--ghost btn--icon', async () => {
        remove.disabled = true;
        try {
          await deleteChecklistItem(taskId, item.id);
          list = list.filter((i) => i.id !== item.id);
          li.remove();
          refreshBar();
          onChange?.();
        } catch (err) {
          remove.disabled = false;
          showToast(errorMessage(err), 'error');
        }
      });
      remove.setAttribute('aria-label', `Elimina la voce "${item.text}"`);
      li.append(remove);
    }
    return li;
  }

  ul.append(...list.map(buildItem));
  root.append(bar, ul, empty);

  if (canContribute) {
    const form = el('form', 'checklist__form');
    form.noValidate = true;
    const input = el('input', 'input');
    input.type = 'text';
    input.maxLength = LIMITS.checklistTextMax;
    input.placeholder = 'Aggiungi una voce…';
    input.setAttribute('aria-label', 'Nuova voce della checklist');
    const add = el('button', 'btn btn--secondary', 'Aggiungi');
    add.type = 'submit';
    form.append(input, add);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      add.disabled = true;
      try {
        const item = await addChecklistItem(taskId, text);
        list.push(item);
        ul.append(buildItem(item));
        input.value = '';
        refreshBar();
        onChange?.();
        input.focus();
      } catch (err) {
        showToast(errorMessage(err), 'error');
      } finally {
        add.disabled = false;
      }
    });
    root.append(form);
  }

  refreshBar();
  return root;
}
