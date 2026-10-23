// Costanti condivise da browser e server

export const STATUSES = ['todo', 'doing', 'review', 'done'];
export const STATUS_LABELS = {
  todo: 'Da fare',
  doing: 'In corso',
  review: 'In revisione',
  done: 'Fatto',
};
export const PRIORITIES = ['low', 'medium', 'high'];
export const PRIORITY_LABELS = { low: 'Bassa', medium: 'Media', high: 'Alta' };
export const TASK_COLORS = [
  '#4f8cff',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#a855f7',
  '#14b8a6',
  '#ec4899',
  '#64748b',
];
export const DEFAULT_COLOR = '#4f8cff';
export const LIMITS = {
  usernameMin: 3,
  usernameMax: 30,
  passwordMin: 8,
  titleMax: 100,
  descriptionMax: 2000,
  commentMax: 1000,
};
export const PREFS_KEY = 'kanban.prefs';
