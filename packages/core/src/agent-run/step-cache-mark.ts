import type { ModelMessage } from "ai";
import type { ProviderOptionsByProvider } from "../models/model-catalog";
import { estimateTextTokens } from "./turn-usage";

export interface StepCacheMarks {
  /**
   * Сообщения шага до снимка и пометок: метка прошлого шага снята, новая — на последнем сообщении. Шаг 0 и провайдер
   * без явных меток — тот же массив.
   */
  messagesFor(input: { messages: ModelMessage[]; stepNumber: number }): ModelMessage[];
}

/**
 * Метка кэша на конце шага (FR-012) — только у провайдера, который читает кэш до явной метки
 * (`lastMessageProviderOptions`): без неё шаги хода в кэш не попадут, и следующий ход прочитает их мимо кэша. На шаге 0
 * метка уже стоит на последнем сообщении истории. AI SDK переносит подменённые сообщения шага в следующие шаги, поэтому
 * помеченная копия прошлого шага по ссылке меняется обратно на исходное сообщение: меток всего три — инструкция,
 * последнее сообщение истории, конец шага. Провайдер с автоматическим кэшем — сообщения не трогаются вовсе.
 */
export function createStepCacheMarks(mark: ProviderOptionsByProvider | undefined): StepCacheMarks {
  let previous: { marked: ModelMessage; original: ModelMessage } | undefined;
  return {
    messagesFor({ messages, stepNumber }) {
      if (!mark || stepNumber === 0 || messages.length === 0) return messages;
      const carried = previous;
      const unmarked = carried ? messages.map((message) => (message === carried.marked ? carried.original : message)) : messages;
      const original = unmarked[unmarked.length - 1]!;
      const marked = withCacheMark(original, mark);
      previous = { marked, original };
      return [...unmarked.slice(0, -1), marked];
    },
  };
}

/**
 * Сообщение с меткой кэша на конце. У результатов инструментов метка — на последнем результате, а не на сообщении:
 * провайдер OpenRouter переносит метку сообщения на каждый результат, и после трёх параллельных вызовов в запросе
 * Claude пять меток вместо трёх — Anthropic отвергает запрос (больше 4 нельзя). Один результат — тело то же, что с
 * меткой на сообщении.
 */
export function withCacheMark(message: ModelMessage, mark: ProviderOptionsByProvider): ModelMessage {
  if (message.role === "tool") {
    const index = message.content.findLastIndex((part) => part.type === "tool-result");
    const part = message.content[index];
    if (part?.type === "tool-result") {
      return { ...message, content: message.content.with(index, { ...part, providerOptions: { ...part.providerOptions, ...mark } }) };
    }
  }
  return { ...message, providerOptions: { ...message.providerOptions, ...mark } };
}

/** Оценка текста служебных сообщений концовки шага (пометки попытки и итога), токенов: для журнала промахов кэша. */
export function estimateMessagesTokens(messages: readonly ModelMessage[]): number {
  return messages.reduce((sum, message) => {
    const text = typeof message.content === "string" ? message.content : message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    return sum + estimateTextTokens(text);
  }, 0);
}
