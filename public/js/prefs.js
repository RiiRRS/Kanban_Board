// Preferenze dell'interfaccia (tema, board scelta, vista compatta) nel localStorage.
// Se il browser lo blocca, si va avanti senza ricordare nulla.

import { PREFS_KEY } from './constants.js';

export function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

export function setPref(key, value) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), [key]: value }));
  } catch {
    // preferenza facoltativa
  }
}
