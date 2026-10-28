// Profilo: nome visualizzato, colore dell'avatar e cambio password

import { updateProfile, changePassword, ApiError } from './api.js';
import { LIMITS, TASK_COLORS } from './constants.js';
import { validatePassword } from './validation.js';
import { createAvatar } from './avatar.js';
import { el, button, errorMessage } from './dom.js';
import { openModal, showToast } from './ui.js';

function field(label, control, id) {
  const wrap = el('div', 'form-field');
  const l = el('label', 'form-label', label);
  l.htmlFor = id;
  control.id = id;
  const error = el('p', 'form-error');
  error.id = `${id}-error`;
  control.setAttribute('aria-describedby', error.id);
  wrap.append(l, control, error);
  return { wrap, error };
}

export function openProfile({ user, onUpdated }) {
  const root = el('div', 'profile');
  let current = user;

  // ----- Profilo -----
  const form = el('form');
  form.noValidate = true;
  const preview = el('div', 'profile__preview');
  const drawPreview = () =>
    preview.replaceChildren(
      createAvatar(
        { ...current, displayName: nameInput.value || current.username, avatarColor: color.value },
        { size: 56 },
      ),
      el('div', null, `@${current.username}`),
    );

  const nameInput = el('input', 'input');
  nameInput.type = 'text';
  nameInput.maxLength = LIMITS.displayNameMax;
  nameInput.value = current.displayName;
  nameInput.placeholder = current.username;
  const nameField = field('Nome visualizzato', nameInput, 'profile-name');
  nameField.wrap.append(
    el(
      'p',
      'form-hint',
      'Lo username (@' + current.username + ') non cambia: serve per le menzioni.',
    ),
  );

  const color = el('input', 'input');
  color.type = 'color';
  color.value = current.avatarColor;
  const palette = el('div', 'color-palette');
  for (const c of TASK_COLORS) {
    const swatch = el('button', 'color-swatch');
    swatch.type = 'button';
    swatch.style.background = c;
    swatch.setAttribute('aria-label', `Colore ${c}`);
    swatch.addEventListener('click', () => {
      color.value = c;
      drawPreview();
    });
    palette.append(swatch);
  }
  palette.append(color);
  color.setAttribute('aria-label', 'Colore personalizzato');
  nameInput.addEventListener('input', drawPreview);
  color.addEventListener('input', drawPreview);
  drawPreview();

  const save = el('button', 'btn btn--primary', 'Salva profilo');
  save.type = 'submit';
  const profileActions = el('div', 'form-actions');
  profileActions.append(save);
  const colorWrap = el('div', 'form-field');
  colorWrap.append(el('span', 'form-label', 'Colore dell’avatar'), palette);
  form.append(preview, nameField.wrap, colorWrap, profileActions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true;
    nameField.error.textContent = '';
    try {
      current = await updateProfile({ displayName: nameInput.value, avatarColor: color.value });
      showToast('Profilo aggiornato', 'success');
      onUpdated?.(current);
    } catch (err) {
      nameField.error.textContent = errorMessage(err);
    } finally {
      save.disabled = false;
    }
  });

  // ----- Password -----
  const pwForm = el('form', 'profile__password');
  pwForm.noValidate = true;
  pwForm.append(el('h3', 'detail__section-title', 'Cambia password'));
  const make = (label, id, autocomplete) => {
    const i = el('input', 'input');
    i.type = 'password';
    i.autocomplete = autocomplete;
    return { input: i, ...field(label, i, id) };
  };
  const cur = make('Password attuale', 'profile-current', 'current-password');
  const next = make('Nuova password', 'profile-new', 'new-password');
  const again = make('Ripeti la nuova password', 'profile-again', 'new-password');
  const pwSave = el('button', 'btn btn--secondary', 'Cambia password');
  pwSave.type = 'submit';
  const pwActions = el('div', 'form-actions');
  pwActions.append(pwSave);
  pwForm.append(cur.wrap, next.wrap, again.wrap, pwActions);

  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    for (const f of [cur, next, again]) f.error.textContent = '';
    const problem = validatePassword(next.input.value);
    if (problem) {
      next.error.textContent = problem;
      return next.input.focus();
    }
    if (next.input.value !== again.input.value) {
      again.error.textContent = 'Le due password non coincidono';
      return again.input.focus();
    }
    pwSave.disabled = true;
    try {
      await changePassword(cur.input.value, next.input.value);
      pwForm.reset();
      showToast('Password cambiata. Le altre sessioni sono state chiuse.', 'success');
    } catch (err) {
      const target = err instanceof ApiError && err.field === 'currentPassword' ? cur : next;
      target.error.textContent = errorMessage(err);
      target.input.focus();
    } finally {
      pwSave.disabled = false;
    }
  });

  root.append(form, pwForm);
  openModal(root, { title: 'Il tuo profilo', size: 'md' });
}
