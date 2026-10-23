// SEGNAPOSTO

export const USE_STUBS = true;

export class ApiError extends Error {
  constructor(message, status = 0, field = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
  }
}

export async function register(username, password) {
  throw new Error('TODO');
}

export async function login(username, password) {
  throw new Error('TODO');
}

export async function logout() {
  throw new Error('TODO');
}

export async function getMe() {
  throw new Error('TODO');
}

export async function getTasks({ onCache } = {}) {
  throw new Error('TODO');
}

export async function createTask(input) {
  throw new Error('TODO');
}

export async function updateTask(id, input) {
  throw new Error('TODO');
}

export async function moveTask(id, status, position) {
  throw new Error('TODO');
}

export async function deleteTask(id) {
  throw new Error('TODO');
}

export async function getComments(taskId, { onCache } = {}) {
  throw new Error('TODO');
}

export async function addComment(taskId, text) {
  throw new Error('TODO');
}

export async function resetStubs() {
  throw new Error('TODO');
}
