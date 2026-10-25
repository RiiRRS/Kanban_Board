// Cache in localStorage. È solo un aiuto: ogni errore (JSON rotto, storage bloccato) vale "non c'è".

const PREFIX = 'kanban.v1.';
const MAX_COMMENT_TASKS = 20;

export function getCache(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCache(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // cache facoltativa
  }
}

export function removeCache(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // cache facoltativa
  }
}

// cancella tutto quello che inizia con il prefisso; kanban.prefs e i dati finti restano
export function clearUserCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // cache facoltativa
  }
}

export const tasksKey = (userId) => `u${userId}.tasks`;
export const commentsKey = (userId, taskId) => `u${userId}.comments.${taskId}`;

// tiene gli ultimi 20 taskId con commenti in cache (l'ultimo usato va in fondo)
// e cancella i commenti delle attività che escono dalla lista
export function rememberCommentsTask(userId, taskId) {
  const indexKey = `u${userId}.commentsIndex`;
  const stored = getCache(indexKey);
  const index = (Array.isArray(stored) ? stored : []).filter((id) => id !== taskId);
  index.push(taskId);
  while (index.length > MAX_COMMENT_TASKS) {
    removeCache(commentsKey(userId, index.shift()));
  }
  setCache(indexKey, index);
}
