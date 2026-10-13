/** Подписи инструмента поиска по старой переписке в ленте чата. Без кода поиска: файл безопасно подключать в браузерной сборке. */
export const historySearchTitles: Record<string, string> = {
  search_earlier_conversation: "Поиск по старой переписке",
};

/** Та же подпись по-английски. */
export const englishHistorySearchTitles: Record<string, string> = {
  search_earlier_conversation: "Searching earlier messages",
};

/** Понятная фраза поиска по старой переписке для простого вида чата (`stepPhrases` у `AgentChat`). */
export const historySearchStepPhrases: Record<string, { running: string; done: string }> = {
  search_earlier_conversation: { running: "Вспоминаю старую переписку", done: "Заглянул в старую переписку" },
};

/** Та же фраза по-английски. */
export const englishHistorySearchStepPhrases: Record<string, { running: string; done: string }> = {
  search_earlier_conversation: { running: "Looking through earlier messages", done: "Looked through earlier messages" },
};

interface ToolLabels {
  toolRunning(toolName: string): string;
  toolDone(toolName: string): string;
  toolError(toolName: string): string;
}

function titleOf(titles: Record<string, string>, toolName: string): string {
  return Object.hasOwn(titles, toolName) ? (titles[toolName] ?? toolName) : toolName;
}

/** Надписи чата, в которых поиск по старой переписке назван по-русски (или по словарю `titles`, например `englishHistorySearchTitles`); остальное не меняется. */
export function withHistorySearchTitles<Labels extends ToolLabels>(labels: Labels, titles: Record<string, string> = historySearchTitles): Labels {
  return {
    ...labels,
    toolRunning: (toolName: string) => labels.toolRunning(titleOf(titles, toolName)),
    toolDone: (toolName: string) => labels.toolDone(titleOf(titles, toolName)),
    toolError: (toolName: string) => labels.toolError(titleOf(titles, toolName)),
  };
}
