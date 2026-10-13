import type { Chat } from "../conversation/types";

/**
 * Права человека в чате. `retry` — «Повторить» оборванный ответ, отдельно от `regenerate` («Переделать» готовый).
 * `chatList` — переименование и удаление чата и список чатов на экране. `attachments` — файлы в сообщении и адреса
 * вложений. `voice` — голосовые сообщения, микрофон и режим разговора. `reasoning` — мысли модели на экране.
 * `toolDetails` — служебные инструменты на экране (вход, выход); виджеты, браузерные инструменты, помеченные
 * `metadata: { showOnScreen: true }` и вызовы с запросом подтверждения видны всегда. Запрет `reasoning` и `toolDetails` прячет их из истории и потока, модель и
 * хранилище получают всё. `steer` — поправка к идущему ответу (`POST …/steer`). `modelDetails` — модель, провайдер,
 * уровень рассуждений, расход токенов, метаданные поставщика, владелец чата и текст сводок сжатия в истории и потоке;
 * запрет выключает и `modelChoice`: выбирать невидимую модель нельзя.
 */
export type ChatCapability =
  | "edit"
  | "regenerate"
  | "retry"
  | "branches"
  | "modelChoice"
  | "answerEditing"
  | "chatList"
  | "compact"
  | "attachments"
  | "voice"
  | "reasoning"
  | "toolDetails"
  | "steer"
  | "modelDetails";

/**
 * Права, как их отдаёт `resolveChatCapabilities`. `modelDetails` в типе необязательно (нет — `true`): свой литерал прав,
 * собранный до этого права, остаётся верным. Ядро и история заполняют его всегда.
 */
export type ChatCapabilities = Record<Exclude<ChatCapability, "modelDetails">, boolean> & { modelDetails?: boolean };

/**
 * Права в чате от приложения: частичный список, пропущенное — `true`. Тот же вход, что у `beforeTurn` (чат с данными
 * объекта). Не булево значение, неизвестное право или исключение — ошибка приложения.
 */
export type ChatCapabilitiesHandler = (input: {
  userId: string;
  chat: Chat;
}) => Partial<ChatCapabilities> | void | Promise<Partial<ChatCapabilities> | void>;

export const CHAT_CAPABILITIES: readonly ChatCapability[] = [
  "edit",
  "regenerate",
  "retry",
  "branches",
  "modelChoice",
  "answerEditing",
  "chatList",
  "compact",
  "attachments",
  "voice",
  "reasoning",
  "toolDetails",
  "steer",
  "modelDetails",
];

/**
 * Все права разрешены и дополнены ответом приложения; `modelDetails: false` выключает и `modelChoice`. Не булево значение
 * или неизвестное право — `TypeError`.
 */
export function resolveChatCapabilities(given: Partial<ChatCapabilities> | void | null): Required<ChatCapabilities> {
  const resolved = Object.fromEntries(CHAT_CAPABILITIES.map((capability) => [capability, true])) as Required<ChatCapabilities>;
  if (given === undefined || given === null) return resolved;
  if (typeof given !== "object") throw new TypeError("Права чата — объект { право: boolean }");
  // Опечатка в названии права иначе молча оставила бы действие разрешённым.
  const unknown = Object.keys(given).find((key) => !(CHAT_CAPABILITIES as readonly string[]).includes(key));
  if (unknown !== undefined) throw new TypeError(`Неизвестное право «${unknown}»: есть только ${CHAT_CAPABILITIES.join(", ")}`);
  for (const capability of CHAT_CAPABILITIES) {
    const value = given[capability];
    if (value === undefined) continue;
    if (typeof value !== "boolean") throw new TypeError(`Право «${capability}» — true или false`);
    resolved[capability] = value;
  }
  if (!resolved.modelDetails) resolved.modelChoice = false;
  return resolved;
}

/** Действие запрещено правами чата: сервер отвечает 403 `action_forbidden`. */
export class ActionForbiddenError extends Error {
  readonly action: ChatCapability;

  constructor(action: ChatCapability) {
    super("Это действие в этом чате недоступно.");
    this.name = "ActionForbiddenError";
    this.action = action;
  }
}
