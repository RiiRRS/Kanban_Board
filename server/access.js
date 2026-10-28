// Chi può fare cosa su un'attività (le regole sono applicate qui, non nella UI)

// modificare ed eliminare: autore o admin
export const canEdit = (user, task) => user.role === 'admin' || task.createdBy.id === user.id;

// collaborare (checklist, allegati, tempo): anche chi è assegnato
export const canContribute = (user, task) =>
  canEdit(user, task) || task.assignees.some((a) => a.id === user.id);

// gestire una board (colonne, nome, eliminazione): chi l'ha creata o un admin
export const canManageBoard = (user, board) => user.role === 'admin' || board.createdBy === user.id;

export const displayName = (user) => user.displayName || user.username;
