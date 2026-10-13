import type { InferToolInput, ToolSet } from "ai";

/** Где сейчас человек в приложении. Форма совпадает с `ScreenPlace` из `@ykurilov/agent-chat-core`: ядро браузеру не нужно. */
export interface ScreenPlace {
  description: string;
  data?: Record<string, unknown>;
}

/** Сообщение «данные приложения изменены»; `id` один на сообщение, повторы с тем же `id` игнорируются. */
export interface AppDataChange {
  id: string;
  tag: string;
  details?: unknown;
}

/** Тип куска потока ответа «данные изменены»; совпадает с `APP_CHANGE_PART_TYPE` ядра. */
export const APP_CHANGE_PART_TYPE = "data-app-change";

/** Вызов браузерного инструмента, который сервер просит выполнить на этой вкладке. */
export interface BrowserCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/** Итог вызова: результат или текст ошибки для модели. */
export type BrowserCallResult = { output: unknown } | { error: string };

/** Функция браузерного инструмента: делает действие на странице. `signal` обрывает её (срок вышел, «стоп»). */
export type BrowserToolFunction<Input = any> = (input: Input, context: { signal: AbortSignal }) => unknown;

/**
 * Функции браузерных инструментов по именам. С описаниями из общего модуля (`tool({ description, inputSchema })`)
 * вход каждой функции выводится из схемы: `BrowserToolImplementations<typeof browserToolDescriptions>`.
 */
export type BrowserToolImplementations<Descriptions extends ToolSet = ToolSet> = {
  [Name in keyof Descriptions]: BrowserToolFunction<InferToolInput<Descriptions[Name]>>;
};

/** Связь чата с приложением: место на экране, номер вкладки, сообщения об изменении данных, браузерные вызовы. */
export interface AgentAppBridge {
  /** Номер вкладки; сервер по нему отдаёт браузерные вызовы той вкладке, где идёт ответ. */
  tabId: string;
  /** Место на момент запроса; `null` — места нет. */
  currentPlace(): ScreenPlace | null;
  /** Раздаёт сообщение подписчикам; повтор `id` игнорирует. */
  dataChanged(change: AppDataChange): void;
  /** Исполняет функцию приложения по имени с `signal`; нет функции — `{ error: "Инструмент недоступен на этой странице" }`, брошенная ошибка — `{ error: её текст }`. */
  browserCall(call: BrowserCall, options?: { signal?: AbortSignal }): Promise<BrowserCallResult>;
}
