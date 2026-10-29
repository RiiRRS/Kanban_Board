import { PREFS_KEY } from './constants.js';
import { icon } from './icons.js';

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function writePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

const media = matchMedia('(prefers-color-scheme: dark)');
let button = null;

export function getTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  writePrefs({ ...readPrefs(), theme });
  updateButton();
}

function updateButton() {
  if (!button) return;
  const dark = getTheme() === 'dark';
  const text = document.createElement('span');
  text.className = 'nav-item__label';
  text.textContent = dark ? 'Tema chiaro' : 'Tema scuro';
  const symbol = document.createElement('span');
  symbol.className = 'nav-item__icon';
  symbol.append(icon(dark ? 'sun' : 'moon'));
  button.replaceChildren(symbol, text);
  const label = dark ? 'Attiva tema chiaro' : 'Attiva tema scuro';
  button.setAttribute('aria-label', label);
  button.title = label;
}

export function initTheme(toggleButton) {
  button = toggleButton;
  document.documentElement.dataset.theme = readPrefs().theme || (media.matches ? 'dark' : 'light');

  // se l'utente non ha mai scelto, segue il sistema anche quando cambia
  media.addEventListener('change', (e) => {
    if (!readPrefs().theme) {
      document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
      updateButton();
    }
  });

  button?.addEventListener('click', () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'));
  updateButton();
}
