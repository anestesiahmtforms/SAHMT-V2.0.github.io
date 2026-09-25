export function runKeyedTask(tasks, key, createTask) {
  if (tasks.has(key)) return tasks.get(key);
  const task = Promise.resolve().then(createTask);
  tasks.set(key, task);
  task.finally(() => {
    if (tasks.get(key) === task) tasks.delete(key);
  }).catch(() => {});
  return task;
}
