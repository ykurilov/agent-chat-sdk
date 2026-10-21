import type { StepCall, StepPhrases, StepPhraseText } from "./step-phrases";

/**
 * Значок шага в ленте работы (договор скина 28): вид шага, а не картинка — рисует скин. Свой вид приложения — строкой;
 * незнакомый скин рисует общим значком (`tool`).
 */
export type StepIcon =
  | "thinking"
  | "read"
  | "edit"
  | "search"
  | "web"
  | "skill"
  | "mcp"
  | "image"
  | "video"
  | "check"
  | "snapshot"
  | "run"
  | "memory"
  | "helper"
  | "task"
  | "tool"
  | (string & {});

/** Инструменты пакетов SDK: их значки известны точно. */
const SDK_TOOL_ICONS: Record<string, StepIcon> = {
  use_skill: "skill",
  web_search: "web",
  read_page: "web",
  page_screenshot: "snapshot",
  manage_memory: "memory",
  search_earlier_conversation: "search",
  check_tasks: "task",
  cancel_task: "task",
  generate_images: "image",
  show_image: "image",
  show_video: "video",
};

/** Слова имени инструмента → значок; порядок важен: «run_tests» — проверка, а не запуск. */
const WORD_ICONS: Array<[StepIcon, readonly string[]]> = [
  ["snapshot", ["screenshot", "snapshot", "capture"]],
  ["image", ["image", "images", "picture", "photo", "draw"]],
  ["video", ["video"]],
  ["check", ["test", "tests", "check", "verify", "lint", "validate", "typecheck", "review"]],
  ["edit", ["edit", "write", "patch", "replace", "update", "create", "save", "apply", "delete", "remove", "rename", "move", "insert"]],
  ["search", ["search", "find", "grep", "lookup", "query"]],
  ["read", ["read", "open", "view", "look", "get", "load", "list", "cat", "show", "inspect"]],
  ["web", ["web", "browse", "browser", "url", "http", "page", "fetch"]],
  ["run", ["run", "exec", "execute", "bash", "shell", "command", "terminal", "build", "install", "deploy"]],
  ["skill", ["skill", "skills"]],
  ["memory", ["memory", "remember", "note", "notes"]],
];

/** Слова имени: `edit_file`, `edit-file`, `editFile` → «edit», «file». */
const wordsOf = (toolName: string): string[] =>
  toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Значок по имени инструмента: пакеты SDK, помощники `helper_*`, MCP `<префикс>__<имя>`, слова имени; иначе `tool`. */
export function guessStepIcon(toolName: string): StepIcon {
  const known = SDK_TOOL_ICONS[toolName];
  if (known) return known;
  if (toolName.startsWith("helper_")) return "helper";
  if (toolName.includes("__")) return "mcp";
  const words = wordsOf(toolName);
  return WORD_ICONS.find(([, keys]) => words.some((word) => keys.includes(word)))?.[0] ?? "tool";
}

const iconOfText = (value: unknown): StepIcon | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/**
 * Значок шага: значок приложения рядом с фразой (`stepPhrases`, `icon`), запасной слоя поведения (`fallback`), иначе
 * по имени (`guessStepIcon`). Ошибка функции фраз — угадывание, чат не ломается.
 */
export function stepIconOf(call: StepCall, { phrases, fallback }: { phrases?: StepPhrases | undefined; fallback?: Pick<StepPhraseText, "icon"> | undefined } = {}): StepIcon {
  const entry = phrases && Object.hasOwn(phrases, call.toolName) ? phrases[call.toolName] : undefined;
  let own: unknown;
  try {
    own = typeof entry === "function" ? entry(call)?.icon : entry?.icon;
  } catch {
    own = undefined;
  }
  return iconOfText(own) ?? iconOfText(fallback?.icon) ?? guessStepIcon(call.toolName);
}
