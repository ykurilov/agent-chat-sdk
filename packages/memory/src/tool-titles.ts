/** Названия строк вызова инструментов памяти для ленты: по-человечески, без имени инструмента. Без импортов: файл безопасно подключать в браузерной сборке. */
export const memoryToolTitles: Record<string, string> = {
  manage_memory: "Работа с памятью",
};

/** Та же подпись по-английски. */
export const englishMemoryToolTitles: Record<string, string> = {
  manage_memory: "Working with memory",
};

type MemoryPhrase = { running: string; done: string };
type MemoryAction = "create" | "update" | "delete" | "search";

/** Фраза памяти по действию из входа; входа нет (права, вход ещё пишется) — общая. */
function memoryPhrase(byAction: Record<MemoryAction, MemoryPhrase>, general: MemoryPhrase) {
  return ({ input }: { input?: unknown }): MemoryPhrase => {
    const action = typeof input === "object" && input !== null ? (input as { action?: unknown }).action : undefined;
    return typeof action === "string" && Object.hasOwn(byAction, action) ? byAction[action as MemoryAction] : general;
  };
}

/** Понятные фразы памяти для простого вида чата (`stepPhrases` у `AgentChat`): по действию — запомнить, вспомнить… */
export const memoryStepPhrases: Record<string, (call: { input?: unknown }) => MemoryPhrase> = {
  manage_memory: memoryPhrase(
    {
      create: { running: "Запоминаю", done: "Запомнил" },
      update: { running: "Обновляю память", done: "Обновил память" },
      delete: { running: "Забываю лишнее", done: "Забыл лишнее" },
      search: { running: "Вспоминаю", done: "Вспомнил" },
    },
    { running: "Работаю с памятью", done: "Поработал с памятью" },
  ),
};

/** Те же фразы по-английски. */
export const englishMemoryStepPhrases: Record<string, (call: { input?: unknown }) => MemoryPhrase> = {
  manage_memory: memoryPhrase(
    {
      create: { running: "Remembering", done: "Remembered" },
      update: { running: "Updating memory", done: "Updated memory" },
      delete: { running: "Forgetting what’s outdated", done: "Forgot what’s outdated" },
      search: { running: "Recalling", done: "Recalled" },
    },
    { running: "Working with memory", done: "Worked with memory" },
  ),
};

interface ToolLabels {
  toolRunning(toolName: string): string;
  toolDone(toolName: string): string;
  toolError(toolName: string): string;
}

function titleOf(titles: Record<string, string>, toolName: string): string {
  return Object.hasOwn(titles, toolName) ? (titles[toolName] ?? toolName) : toolName;
}

/** Надписи чата, в которых инструмент памяти назван по-русски (или по словарю `titles`, например `englishMemoryToolTitles`); остальное не меняется. */
export function withMemoryToolTitles<Labels extends ToolLabels>(labels: Labels, titles: Record<string, string> = memoryToolTitles): Labels {
  return {
    ...labels,
    toolRunning: (toolName: string) => labels.toolRunning(titleOf(titles, toolName)),
    toolDone: (toolName: string) => labels.toolDone(titleOf(titles, toolName)),
    toolError: (toolName: string) => labels.toolError(titleOf(titles, toolName)),
  };
}
