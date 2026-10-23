// SEGNAPOSTO

export function validateUsername(username) {
  return null;
}

export function validatePassword(password) {
  return null;
}

export function validateCommentText(text) {
  return null;
}

export function normalizeTaskInput(raw = {}) {
  return raw;
}

export function validateTaskInput(input) {
  return {};
}

export function findTimeConflict(tasks, { id = null, date, startTime }) {
  return null;
}

export function getDescendantIds(tasks, id) {
  return new Set();
}

export function wouldCreateCycle(tasks, id, parentId) {
  return false;
}
