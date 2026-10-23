// SEGNAPOSTO

export function renderBoard(
  container,
  tasks,
  { allTasks = tasks, onOpenTask, onAddTask, onMoveTask } = {},
) {
  const list = document.createElement('ul');
  for (const task of tasks) {
    const item = document.createElement('li');
    item.textContent = task.title;
    list.append(item);
  }
  container.replaceChildren(list);
}

export function renderBoardLoading(container) {
  container.textContent = 'Caricamento…';
}
