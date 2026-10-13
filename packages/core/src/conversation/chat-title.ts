const DERIVED_TITLE_LENGTH = 60;
const MAX_TITLE_LENGTH = 100;

/** Название не подходит: пустое или слишком длинное. Прежнее название остаётся. */
export class InvalidChatTitleError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidChatTitleError";
  }
}

/** Символ с кодом ноль выбрасывается: Postgres не принимает его в тексте, а название лежит в колонке `text`. */
function collapseWhitespace(text: string): string {
  return text.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

/** Название чата по первому сообщению собеседника: пробелы схлопнуты, не длиннее 60 знаков (с «…»). Пусто — `null`. */
export function deriveChatTitle(text: string): string | null {
  const collapsed = collapseWhitespace(text);
  if (collapsed.length === 0) return null;
  // По знакам, а не по кодовым единицам: пара эмодзи не режется пополам.
  const characters = [...collapsed];
  if (characters.length <= DERIVED_TITLE_LENGTH) return collapsed;
  return `${characters.slice(0, DERIVED_TITLE_LENGTH).join("").trimEnd()}…`;
}

/**
 * Название, которое ввёл человек: пробелы схлопнуты, не пустое, не длиннее 100 знаков.
 * @throws InvalidChatTitleError название не подходит.
 */
export function normalizeChatTitle(title: string): string {
  if (typeof title !== "string") throw new InvalidChatTitleError("Название должно быть строкой");
  const collapsed = collapseWhitespace(title);
  if (collapsed.length === 0) throw new InvalidChatTitleError("Название пустое");
  if ([...collapsed].length > MAX_TITLE_LENGTH) {
    throw new InvalidChatTitleError(`Название длиннее ${MAX_TITLE_LENGTH} знаков`);
  }
  return collapsed;
}
