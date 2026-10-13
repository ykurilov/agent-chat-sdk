/*
 * Слова договора виджетов (docs/contracts/agent-widgets/data-model.md, «Ответы»): так ответ выглядит в результате вызова,
 * который видит модель. Слой поведения пишет код без кириллицы (scripts/check-rules.mjs), поэтому слова записаны
 * кодами символов, а по-русски — в комментарии рядом.
 */

/** «выбрано» — ответ `ask_choice` и `ask_multi_choice`. */
export const CHOSEN_KEY = "\u0432\u044b\u0431\u0440\u0430\u043d\u043e";
/** «оценка» — ответ `ask_rating`. */
export const RATING_KEY = "\u043e\u0446\u0435\u043d\u043a\u0430";
/** «поля» — ответ `ask_form`. */
export const FIELDS_KEY = "\u043f\u043e\u043b\u044f";
/** «ответ» — ключ пометки «закрыт сообщением». */
export const BY_MESSAGE_KEY = "\u043e\u0442\u0432\u0435\u0442";
/** «сообщением» — значение пометки «закрыт сообщением»: `{ "ответ": "сообщением" }`. */
export const BY_MESSAGE_VALUE = "\u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435\u043c";
/** «Задавай один вопрос за раз» — ошибка лишнего ждущего вызова в шаге: такой виджет не показывается. */
export const ONE_QUESTION_AT_A_TIME =
  "\u0417\u0430\u0434\u0430\u0432\u0430\u0439 \u043e\u0434\u0438\u043d \u0432\u043e\u043f\u0440\u043e\u0441 \u0437\u0430 \u0440\u0430\u0437";

/** Результат вызова — пометка «человек ответил сообщением, а не виджетом». */
export function isAnsweredByMessage(output: unknown): boolean {
  if (typeof output !== "object" || output === null || Array.isArray(output)) return false;
  const entries = Object.entries(output);
  return entries.length === 1 && entries[0]![0] === BY_MESSAGE_KEY && entries[0]![1] === BY_MESSAGE_VALUE;
}
