/**
 * Права человека в чате и закрытие чата — копия договора ядра (`ChatCapabilities`, `ChatClosure`): пакет экрана от
 * ядра не зависит. Права приходят с историей (`capabilities`), закрытие — в `chat.closed` истории, в отказе 409
 * `chat_closed`, куском потока `data-chat-closed` и событиями наблюдения `chat-closed`/`chat-reopened`.
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
 * `modelDetails` — модель, провайдер, расход и владелец в истории и потоке; запрет выключает и выбор модели, меню моделей
 * экран тогда не спрашивает. В типе необязательно (нет — `true`): свой литерал прав без него остаётся верным.
 */
export type ChatCapabilities = Record<Exclude<ChatCapability, "modelDetails">, boolean> & { modelDetails?: boolean };

/** Почему чат закрыт: код для программы, текст для человека. */
export interface ChatClosure {
  code: string;
  message: string;
}

/** Что можно в открытом чате и закрыт ли он. */
export interface ChatAccess {
  capabilities: ChatCapabilities;
  /** `null` — чат открыт. */
  closed: ChatClosure | null;
}

/** Транзитный кусок потока ответа: инструмент закрыл чат. */
export const CHAT_CLOSED_PART_TYPE = "data-chat-closed";

/** Всё разрешено: сервер до 0.27 прав не присылает. */
export const ALL_CAPABILITIES: Required<ChatCapabilities> = {
  edit: true,
  regenerate: true,
  retry: true,
  branches: true,
  modelChoice: true,
  answerEditing: true,
  chatList: true,
  compact: true,
  attachments: true,
  voice: true,
  reasoning: true,
  toolDetails: true,
  steer: true,
  modelDetails: true,
};

/** Права из ответа сервера: пропущенное и не булево — разрешено. */
export function capabilitiesOf(value: unknown): Required<ChatCapabilities> {
  if (typeof value !== "object" || value === null) return ALL_CAPABILITIES;
  const given = value as Partial<Record<ChatCapability, unknown>>;
  const resolved = { ...ALL_CAPABILITIES };
  for (const capability of Object.keys(ALL_CAPABILITIES) as ChatCapability[]) {
    if (typeof given[capability] === "boolean") resolved[capability] = given[capability] as boolean;
  }
  return resolved;
}

/** Закрытие из ответа сервера; `null` — нет или неверной формы. */
export function closureOf(value: unknown): ChatClosure | null {
  if (typeof value !== "object" || value === null) return null;
  const { code, message } = value as { code?: unknown; message?: unknown };
  return typeof code === "string" && typeof message === "string" ? { code, message } : null;
}

export function sameCapabilities(a: ChatCapabilities, b: ChatCapabilities): boolean {
  return (Object.keys(a) as ChatCapability[]).every((capability) => a[capability] === b[capability]);
}
