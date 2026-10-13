import type { ExternalChannel } from "../conversation/types";
import { normalizeTurnRefusal } from "../turn-hooks/turn-hooks";
import type { TurnRefusal } from "../turn-hooks/turn-hooks";

/** Отказ приложения в новом чате: код для программы, текст человеку. Правила те же, что у отказа хода. */
export type ChatCreationRefusal = TurnRefusal;

/**
 * Можно ли человеку завести новый чат: вернуть `{ code, message }` — чат не создаётся. Зовётся, когда чат заводит сам
 * человек: `POST {base}` и `/new` в мессенджере (и первый чат мессенджера). Чаты объектов приложения (`openSubjectChat`,
 * `importChat`) хук не спрашивает.
 */
export type BeforeCreateChatHandler = (input: {
  userId: string;
  /** Мессенджер, из которого заводят чат; нет — веб. */
  origin?: ExternalChannel;
}) => Promise<ChatCreationRefusal | void> | ChatCreationRefusal | void;

/** Приложение не дало завести чат: сервер отвечает 403 `chat_creation_refused`, мессенджер — текстом. */
export class ChatCreationRefusedError extends Error {
  readonly code: string;

  constructor(refusal: ChatCreationRefusal) {
    const normalized = normalizeTurnRefusal(refusal);
    super(normalized.message);
    this.name = "ChatCreationRefusedError";
    this.code = normalized.code;
  }

  get refusal(): ChatCreationRefusal {
    return { code: this.code, message: this.message };
  }
}
