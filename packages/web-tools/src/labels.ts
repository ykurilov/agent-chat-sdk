/** Подписи веб-инструментов в ленте чата. Без кода сервисов: файл безопасно подключать в браузерной сборке. */
export const webToolTitles: Record<string, string> = {
  web_search: "Поиск в интернете",
  read_page: "Чтение страницы",
  page_screenshot: "Скриншот страницы",
};

/** Те же подписи по-английски. */
export const englishWebToolTitles: Record<string, string> = {
  web_search: "Web search",
  read_page: "Reading a page",
  page_screenshot: "Page screenshot",
};

/** Понятные фразы веб-инструментов для простого вида чата (`stepPhrases` у `AgentChat`): «идёт» и «готово». */
export const webToolStepPhrases: Record<string, { running: string; done: string }> = {
  web_search: { running: "Ищу в интернете", done: "Поискал в интернете" },
  read_page: { running: "Читаю страницу", done: "Прочитал страницу" },
  page_screenshot: { running: "Делаю снимок страницы", done: "Сделал снимок страницы" },
};

/** Те же фразы по-английски. */
export const englishWebToolStepPhrases: Record<string, { running: string; done: string }> = {
  web_search: { running: "Searching the web", done: "Searched the web" },
  read_page: { running: "Reading a page", done: "Read a page" },
  page_screenshot: { running: "Taking a page screenshot", done: "Took a page screenshot" },
};

interface ToolLabels {
  toolRunning(toolName: string): string;
  toolDone(toolName: string): string;
  toolError(toolName: string): string;
}

function titleOf(titles: Record<string, string>, toolName: string): string {
  return Object.hasOwn(titles, toolName) ? (titles[toolName] ?? toolName) : toolName;
}

/** Надписи чата, в которых веб-инструменты названы по-русски (или по словарю `titles`, например `englishWebToolTitles`); остальное не меняется. */
export function withWebToolTitles<Labels extends ToolLabels>(labels: Labels, titles: Record<string, string> = webToolTitles): Labels {
  return {
    ...labels,
    toolRunning: (toolName: string) => labels.toolRunning(titleOf(titles, toolName)),
    toolDone: (toolName: string) => labels.toolDone(titleOf(titles, toolName)),
    toolError: (toolName: string) => labels.toolError(titleOf(titles, toolName)),
  };
}
