// Pagina di login e registrazione

import { getMe, login, register, ApiError } from './api.js';
import { validateUsername, validatePassword } from './validation.js';
import { initTheme } from './theme.js';

const tabs = {
  login: document.getElementById('tab-login'),
  register: document.getElementById('tab-register'),
};
const forms = {
  login: document.getElementById('login-form'),
  register: document.getElementById('register-form'),
};

// ===== Errori sotto i campi =====

function showFieldError(input, message) {
  input.classList.add('input--invalid');
  input.setAttribute('aria-invalid', 'true');
  document.getElementById(`${input.id}-error`).textContent = message;
}

function clearFieldError(input) {
  input.classList.remove('input--invalid');
  input.removeAttribute('aria-invalid');
  document.getElementById(`${input.id}-error`).textContent = '';
}

function clearErrors(form) {
  form.querySelectorAll('.input').forEach(clearFieldError);
  const alert = form.querySelector('.form-alert');
  alert.textContent = '';
  alert.hidden = true;
}

function showAlert(form, message) {
  const alert = form.querySelector('.form-alert');
  alert.textContent = message;
  alert.hidden = false;
}

// mostra tutti gli errori { input, message } e mette il focus sul primo
function showErrors(errors) {
  errors.forEach(({ input, message }) => showFieldError(input, message));
  errors[0].input.focus();
}

// ===== Bottone in attesa =====

function setLoading(button, loading, text) {
  button.disabled = loading;
  if (loading) {
    button.dataset.label = button.textContent;
    button.textContent = '';
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    button.append(spinner, ` ${text}`);
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
}

// ===== Schede =====

function showTab(name) {
  for (const key of ['login', 'register']) {
    const active = key === name;
    tabs[key].classList.toggle('tab--active', active);
    tabs[key].setAttribute('aria-selected', String(active));
    tabs[key].tabIndex = active ? 0 : -1;
    forms[key].hidden = !active;
    clearErrors(forms[key]);
  }
  forms[name].querySelector('.input').focus();
}

tabs.login.addEventListener('click', () => showTab('login'));
tabs.register.addEventListener('click', () => showTab('register'));

// frecce sinistra/destra per cambiare scheda
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const next = forms.login.hidden ? 'login' : 'register';
  showTab(next);
  tabs[next].focus();
});

// quando l'utente corregge un campo, il suo errore sparisce
document.querySelectorAll('.input').forEach((input) => {
  input.addEventListener('input', () => clearFieldError(input));
});

// ===== Errori dal server =====

function handleApiError(form, err, fieldInputs, passwordInput) {
  const input = err instanceof ApiError && err.field ? fieldInputs[err.field] : null;
  if (input) {
    showFieldError(input, err.message);
  } else {
    showAlert(form, err instanceof ApiError ? err.message : 'Errore imprevisto, riprova');
  }
  passwordInput.value = '';
  (input && input !== passwordInput ? input : passwordInput).focus();
}

// ===== Accedi =====

forms.login.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = forms.login;
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return; // niente doppio invio

  const username = document.getElementById('login-username');
  const password = document.getElementById('login-password');
  clearErrors(form);

  const errors = [];
  if (!username.value.trim()) errors.push({ input: username, message: 'Inserisci uno username' });
  if (!password.value) errors.push({ input: password, message: 'Inserisci la password' });
  if (errors.length > 0) return showErrors(errors);

  setLoading(button, true, 'Accesso…');
  try {
    await login(username.value.trim(), password.value);
    location.replace('/');
  } catch (err) {
    handleApiError(form, err, { username, password }, password);
  } finally {
    setLoading(button, false);
  }
});

// ===== Registrati =====

forms.register.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = forms.register;
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;

  const username = document.getElementById('register-username');
  const password = document.getElementById('register-password');
  const confirm = document.getElementById('register-password-confirm');
  clearErrors(form);

  const errors = [];
  const usernameError = validateUsername(username.value);
  if (usernameError) errors.push({ input: username, message: usernameError });
  const passwordError = validatePassword(password.value);
  if (passwordError) errors.push({ input: password, message: passwordError });
  if (password.value !== confirm.value) {
    errors.push({ input: confirm, message: 'Le password non coincidono' });
  }
  if (errors.length > 0) return showErrors(errors);

  setLoading(button, true, 'Creazione…');
  try {
    await register(username.value.trim(), password.value);
    location.replace('/');
  } catch (err) {
    // 409 = username già in uso: va sotto lo username
    if (err instanceof ApiError && err.status === 409) err.field = 'username';
    handleApiError(form, err, { username, password }, password);
    confirm.value = '';
  } finally {
    setLoading(button, false);
  }
});

// ===== Avvio =====

async function main() {
  initTheme(null);
  try {
    if (await getMe()) return location.replace('/');
  } catch {
    // server irraggiungibile: si mostra comunque il form, l'errore arriverà al login
  }

  forms.login.querySelector('button[type="submit"]').disabled = false;
  forms.register.querySelector('button[type="submit"]').disabled = false;
  showTab(location.hash === '#register' ? 'register' : 'login');
}

main();
