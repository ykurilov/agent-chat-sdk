import { isStateMessage } from "../app-state/state-messages";
import type { AbandonedAnswers } from "../turn-hooks/turn-hooks";
import type { StoredMessage } from "./types";

/**
 * Ответы агента, которые уйдут с ветки `branch`: переделка ответа `messageId` (`regenerate`) или правка вопроса
 * `messageId` (`edit`). Сообщения нет на ветке, оно не того вида или перед ответом нет вопроса человека (одни служебные
 * сообщения импорта) — пусто: ход и так не начнётся. Проверки те же, что у `regenerate` и `editMessage` службы.
 */
export function abandonedAnswersOf(branch: readonly StoredMessage[], action: "regenerate" | "edit", messageId: string): AbandonedAnswers {
  const index = branch.findIndex((message) => message.id === messageId);
  const target = branch[index];
  if (!target) return {};
  if (action === "regenerate" && (target.role !== "assistant" || branch.slice(0, index).every(isStateMessage))) return {};
  if (action === "edit" && (target.role !== "user" || isStateMessage(target))) return {};
  const below = branch.slice(action === "regenerate" ? index : index + 1);
  const previous = action === "regenerate" ? target : below.find((message) => message.role === "assistant" && message.parentId === target.id);
  return {
    abandonedAnswerIds: below.filter((message) => message.role === "assistant").map((message) => message.id),
    ...(previous && { previousAnswerId: previous.id }),
  };
}

/** Ответ, который можно повторить: оборван (ошибка, «Стоп», прерван) или закончен без единого слова. */
export function isRetryableAnswer(answer: StoredMessage): boolean {
  if (answer.status === "error" || answer.status === "stopped" || answer.status === "interrupted") return true;
  if (answer.status !== "complete") return false;
  // Пустой ответ: модель не написала ни слова, хотя могла вызывать инструменты.
  const text = answer.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
  return text.trim().length === 0;
}

/**
 * Ответ, который уйдёт с ветки при «Повторить» (`retry`): последний ответ ветки (служебные записи состояния после него
 * не в счёт), его заменит новый ответ-сосед — и когда ответ пишется заново, и когда продолжается с выполненных шагов.
 * Вопрос без ответа или ответ, который повторить нельзя, — пусто. Проверки те же, что у `retry` службы.
 */
export function abandonedOnRetry(branch: readonly StoredMessage[]): AbandonedAnswers {
  let end = branch.length;
  while (end > 0 && isStateMessage(branch[end - 1]!)) end--;
  const last = branch[end - 1];
  if (!last || last.role !== "assistant" || branch[end - 2]?.role !== "user" || !isRetryableAnswer(last)) return {};
  return { abandonedAnswerIds: [last.id], previousAnswerId: last.id };
}
