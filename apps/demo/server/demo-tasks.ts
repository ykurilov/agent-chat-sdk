/*
 * Задачи демо-страницы с панелью агента (`/panel-app`): свои у каждого человека, в памяти сервера.
 * Список и карточка — то, что человек видит на странице и о чём спрашивает агента.
 */

export interface DemoTask {
  id: string;
  title: string;
  note: string;
}

const startingTasks: readonly DemoTask[] = [
  { id: "1", title: "Подготовить отчёт", note: "Собрать цифры за квартал." },
  { id: "2", title: "Позвонить клиенту", note: "Уточнить сроки поставки." },
  { id: "3", title: "Заказать торт", note: "Ко дню рождения в пятницу." },
];

export interface DemoTasks {
  list(ownerId: string): DemoTask[];
  find(ownerId: string, taskId: string): DemoTask | undefined;
  /** Новая задача в конце списка человека. */
  create(ownerId: string, title: string): DemoTask;
}

export function createDemoTasks(): DemoTasks {
  const byOwner = new Map<string, DemoTask[]>();
  const tasksOf = (ownerId: string) => {
    let tasks = byOwner.get(ownerId);
    if (!tasks) byOwner.set(ownerId, (tasks = startingTasks.map((task) => ({ ...task }))));
    return tasks;
  };
  return {
    list: (ownerId) => [...tasksOf(ownerId)],
    find: (ownerId, taskId) => tasksOf(ownerId).find((task) => task.id === taskId),
    create(ownerId, title) {
      const tasks = tasksOf(ownerId);
      const task: DemoTask = { id: String(Math.max(0, ...tasks.map((existing) => Number(existing.id))) + 1), title, note: "" };
      tasks.push(task);
      return task;
    },
  };
}
