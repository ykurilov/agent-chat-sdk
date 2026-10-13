import { normalizeTurnRefusal } from "../turn-hooks/turn-hooks";

/** Почему чат закрыт: код для программы, текст для человека (те же правила, что у отказа хода). */
export interface ChatClosure {
  /** Латиница в нижнем регистре, цифры и `.`, `_`, `-`; от 1 до 64 знаков. */
  code: string;
  /** До 300 знаков; длиннее — обрезается. */
  message: string;
}

/** Транзитный кусок потока ответа: инструмент закрыл чат, вкладке пора закрыть поле ввода. В истории его нет. */
export const CHAT_CLOSED_PART_TYPE = "data-chat-closed";

/** Закрытие по правилам: код проверен (иначе `TypeError`), текст обрезан до 300 знаков. */
export function normalizeChatClosure(closure: ChatClosure): ChatClosure {
  return normalizeTurnRefusal(closure);
}

/** Чат закрыт: ходы и правки не идут. Сервер отвечает 409 `chat_closed`. */
export class ChatClosedError extends Error {
  readonly code: string;

  constructor(closure: ChatClosure) {
    super(closure.message);
    this.name = "ChatClosedError";
    this.code = closure.code;
  }
}
