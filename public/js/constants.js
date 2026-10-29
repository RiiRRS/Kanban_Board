// Costanti condivise da browser e server

export const PRIORITIES = ['low', 'medium', 'high'];
export const PRIORITY_LABELS = { low: 'Bassa', medium: 'Media', high: 'Alta' };
export const RECURRENCES = ['none', 'daily', 'weekly', 'monthly'];
export const RECURRENCE_LABELS = {
  none: 'Non si ripete',
  daily: 'Ogni giorno',
  weekly: 'Ogni settimana',
  monthly: 'Ogni mese',
};
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
// colonne di una board nuova: [nome, è la colonna dei completati]
export const DEFAULT_COLUMNS = [
  ['Da fare', false],
  ['In corso', false],
  ['In revisione', false],
  ['Fatto', true],
];
export const LIMITS = {
  usernameMin: 3,
  usernameMax: 30,
  passwordMin: 8,
  passwordMaxBytes: 72, // bcrypt ignora il resto
  displayNameMax: 40,
  titleMax: 100,
  descriptionMax: 5000,
  commentMax: 1000,
  boardNameMax: 50,
  columnNameMax: 30,
  wipMax: 999,
  labelNameMax: 30,
  checklistTextMax: 200,
  minutesMax: 99999,
  assigneesMax: 20,
  labelsMax: 20,
  attachmentNameMax: 120,
  attachmentBytes: 5 * 1024 * 1024,
};
export const PREFS_KEY = 'kanban.prefs';
