import type { ModelMessage } from "ai";
import type { AgentChatMessage } from "../conversation/types";

/**
 * Служебное сообщение человека перед ответом агента, с которого начинается история (приветствие или импорт): строгие
 * провайдеры не принимают разговор, начатый агентом. Постоянное — без дат и подстановок, чтобы начало запроса было
 * одинаковым на каждом ходе и попадало в кэш модели.
 */
export const GREETING_LEAD = "[Разговор начат приложением: первым пишет агент.]";

/** История начинается с ответа агента — перед ним служебная строка; иначе тот же массив. */
export function withGreetingLead(messages: ModelMessage[]): ModelMessage[] {
  if (messages[0]?.role !== "assistant") return messages;
  return [{ role: "user", content: [{ type: "text", text: GREETING_LEAD }] }, ...messages];
}

/**
 * Картинки в ответах агента (импорт переписки) модели уходят текстом «[картинка: имя]»: модели не принимают файлы в
 * ответе ассистента. Картинки человека не трогаются. Нечего менять — то же сообщение.
 */
export function withAssistantFilesAsText(message: AgentChatMessage): AgentChatMessage {
  if (message.role !== "assistant" || !message.parts.some((part) => part.type === "file")) return message;
  return {
    ...message,
    parts: message.parts.map((part) =>
      part.type === "file" ? { type: "text" as const, text: part.filename ? `[картинка: ${part.filename}]` : "[картинка]" } : part,
    ),
  };
}
