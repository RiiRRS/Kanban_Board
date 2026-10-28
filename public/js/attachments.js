// Allegati di un'attività: link e file (fino a 5 MB)

import { addLink, uploadFile, deleteAttachment } from './api.js';
import { LIMITS } from './constants.js';
import { el, button, spinner, errorMessage } from './dom.js';
import { showToast, confirmDialog } from './ui.js';

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function createAttachments({ taskId, items, canContribute, canDelete, onChange }) {
  const root = el('div', 'attachments');
  let list = [...items];

  const ul = el('ul', 'attachments__items');
  const empty = el('p', 'detail__muted', 'Nessun allegato');

  function refresh() {
    empty.hidden = list.length > 0;
  }

  function buildItem(att) {
    const li = el('li', 'attachment');
    const icon = el('span', 'attachment__icon', att.kind === 'link' ? '🔗' : '📎');
    icon.setAttribute('aria-hidden', 'true');

    const a = el('a', 'attachment__name', att.name);
    a.href = att.url;
    if (att.kind === 'link') {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else {
      a.download = att.name; // il server risponde comunque come download
    }
    li.append(icon, a);
    if (att.kind === 'file') li.append(el('span', 'attachment__size', formatSize(att.size ?? 0)));

    // elimina chi ha caricato o chi può modificare l'attività
    if (canDelete(att)) {
      const remove = button('×', 'btn btn--ghost btn--icon', async () => {
        const ok = await confirmDialog(`Eliminare l'allegato "${att.name}"?`, {
          title: 'Elimina allegato',
          okLabel: 'Elimina',
          danger: true,
        });
        if (!ok) return;
        remove.disabled = true;
        try {
          await deleteAttachment(att.id);
          list = list.filter((x) => x.id !== att.id);
          li.remove();
          refresh();
          onChange?.();
        } catch (err) {
          remove.disabled = false;
          showToast(errorMessage(err), 'error');
        }
      });
      remove.setAttribute('aria-label', `Elimina l'allegato "${att.name}"`);
      li.append(remove);
    }
    return li;
  }

  ul.append(...list.map(buildItem));
  root.append(ul, empty);

  if (canContribute) {
    const add = (att) => {
      list.push(att);
      ul.append(buildItem(att));
      refresh();
      onChange?.();
    };

    // link
    const form = el('form', 'attachments__form');
    form.noValidate = true;
    const url = el('input', 'input');
    url.type = 'url';
    url.placeholder = 'https://…';
    url.setAttribute('aria-label', 'Indirizzo del link');
    const name = el('input', 'input');
    name.type = 'text';
    name.maxLength = LIMITS.attachmentNameMax;
    name.placeholder = 'Nome (facoltativo)';
    name.setAttribute('aria-label', 'Nome del link');
    const submit = el('button', 'btn btn--secondary', 'Aggiungi link');
    submit.type = 'submit';
    form.append(url, name, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!url.value.trim()) return;
      submit.disabled = true;
      try {
        add(await addLink(taskId, url.value.trim(), name.value.trim()));
        url.value = name.value = '';
      } catch (err) {
        showToast(errorMessage(err), 'error');
      } finally {
        submit.disabled = false;
      }
    });

    // file
    const file = el('input');
    file.type = 'file';
    file.hidden = true;
    const upload = el('button', 'btn btn--secondary', 'Carica un file');
    upload.type = 'button';
    upload.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const chosen = file.files[0];
      file.value = '';
      if (!chosen) return;
      if (chosen.size > LIMITS.attachmentBytes) {
        showToast('Il file supera i 5 MB', 'error');
        return;
      }
      upload.disabled = true;
      upload.textContent = '';
      upload.append(spinner(), ' Caricamento…');
      try {
        add(await uploadFile(taskId, chosen));
      } catch (err) {
        showToast(errorMessage(err), 'error');
      } finally {
        upload.disabled = false;
        upload.textContent = 'Carica un file';
      }
    });

    root.append(form, upload, file);
  }

  refresh();
  return root;
}
