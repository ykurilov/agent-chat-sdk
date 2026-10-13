import type { ModelMessage } from "ai";

/** Что видит модель вместо ответа, которого не было: ход оборвался сбоем или «Стопом» до первых слов. Текст постоянный — кэш модели цел. */
export const UNANSWERED_NOTE = "[Ответа на это сообщение нет: ход оборвался до первых слов]";

/**
 * Между сообщениями человека подряд (ответ между ними упал без текста или был из одних рассуждений) — ответ модели
 * с пометкой `UNANSWERED_NOTE`. Строгие провайдеры не принимают два сообщения человека подряд, а слитые в одно вопросы
 * модель читает как один: «Первое сообщениеВторое сообщение». Пометка встаёт после вопроса без ответа и зависит только
 * от истории: на каждом ходе те же байты, уже отправленное начало запроса не меняется.
 */
export function withUnansweredMarked(messages: ModelMessage[]): ModelMessage[] {
  return messages.flatMap((message, index) =>
    message.role === "user" && messages[index - 1]?.role === "user"
      ? [{ role: "assistant", content: [{ type: "text", text: UNANSWERED_NOTE }] }, message]
      : [message],
  );
}
