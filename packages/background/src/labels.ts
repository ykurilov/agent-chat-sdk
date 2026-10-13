/** Понятные фразы инструментов фоновых задач для простого вида чата (`stepPhrases` у `AgentChat`). Без импортов: файл безопасно подключать в браузерной сборке. */
export const backgroundStepPhrases: Record<string, { running: string; done: string }> = {
  check_tasks: { running: "Проверяю фоновые задачи", done: "Проверил фоновые задачи" },
  cancel_task: { running: "Отменяю задачу", done: "Отменил задачу" },
};

/** Те же фразы по-английски. */
export const englishBackgroundStepPhrases: Record<string, { running: string; done: string }> = {
  check_tasks: { running: "Checking background tasks", done: "Checked background tasks" },
  cancel_task: { running: "Canceling a task", done: "Canceled a task" },
};
