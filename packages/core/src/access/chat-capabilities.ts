import type { Chat } from "../conversation/types";

/**
 * Права человека в чате. `retry` — «Повторить» оборванный ответ, отдельно от `regenerate` («Переделать» готовый).
 * `chatList` — переименование и удаление чата и список чатов на экране. `attachments` — файлы в сообщении и адреса
 * вложений. `voice` — голосовые сообщения, микрофон и режим разговора. `reasoning` — мысли модели на экране.
 * `toolDetails` — служебные инструменты на экране (вход, выход); виджеты, браузерные инструменты, помеченные
 * `metadata: { showOnScreen: true }` и вызовы с запросом подтверждения видны всегда. Запрет `reasoning` и `toolDetails` прячет их из истории и потока, модель и
 * хранилище получают всё. `steer` — поправка к идущему ответу (`POST …/steer`). `modelDetails` — модель, провайдер,
 * уровень рассуждений, расход токенов, метаданные поставщика, владелец чата и текст сводок сжатия в истории и потоке;
 * запрет выключает и `modelChoice`: выбирать невидимую модель нельзя. `errorDetails` — подробности сбоя провайдера
 * (провайдер, модель, код, причина, когда снимут предел) в истории и потоке; единственное право, выключенное по
 * умолчанию: подробности видны любому через инструменты разработчика, открывать их — только админу. При
 * `modelDetails: false` выключено и оно.
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
  | "modelDetails"
  | "errorDetails";

/**
 * Права, как их отдаёт `resolveChatCapabilities`. `modelDetails` (нет — `true`) и `errorDetails` (нет — `false`) в типе
 * необязательны: свой литерал прав, собранный до этих прав, остаётся верным. Ядро и история заполняют их всегда.
 */
export type ChatCapabilities = Record<Exclude<ChatCapability, "modelDetails" | "errorDetails">, boolean> & {
  modelDetails?: boolean;
  errorDetails?: boolean;
};

/**
 * Права в чате от приложения: частичный список, пропущенное — `true` (`errorDetails` — `false`). Тот же вход, что у `beforeTurn` (чат с данными
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
  "errorDetails",
];

/** Права, выключенные, пока приложение их не дало. */
const OFF_BY_DEFAULT: ReadonlySet<ChatCapability> = new Set(["errorDetails"]);

/**
 * Все права, кроме `errorDetails`, разрешены и дополнены ответом приложения; `modelDetails: false` выключает и
 * `modelChoice`, и `errorDetails`. Не булево значение или неизвестное право — `TypeError`.
 */
export function resolveChatCapabilities(given: Partial<ChatCapabilities> | void | null): Required<ChatCapabilities> {
  const resolved = Object.fromEntries(CHAT_CAPABILITIES.map((capability) => [capability, !OFF_BY_DEFAULT.has(capability)])) as Required<ChatCapabilities>;
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
  if (!resolved.modelDetails) {
    resolved.modelChoice = false;
    resolved.errorDetails = false;
  }
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
