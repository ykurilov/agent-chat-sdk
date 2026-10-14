import type { ChatClosure } from "../access/chat-closure";
import type { AppStateValues } from "../app-state/app-state";
import type { StateChangeReason } from "../app-state/state-changed";
import type { AgentChannel, AnswerStatus } from "../conversation/types";
import type { AppEvent } from "../turn-hooks/turn-hooks";

/** Кто начал ход: человек или сервер (служебное сообщение, например результат фона). */
export type ChatTurnTrigger = "human" | "notice";

/** События чата вне потока ответа: по ним открытая вкладка и пакеты расширений узнают о ходах и задачах. */
export type ChatEvent =
  | {
      type: "turn-started";
      ownerId: string;
      chatId: string;
      messageId: string;
      trigger: ChatTurnTrigger;
      channel: AgentChannel;
      /**
       * Ответ доставит приложение само (`deliverNotices` с `awaitAnswer`): каналы SDK такой ход не провожают и в
       * мессенджер его не шлют. Нет — доставляют каналы, как прежде.
       */
      deliveredByApp?: true;
    }
  | {
      type: "turn-finished";
      ownerId: string;
      chatId: string;
      messageId: string;
      status: AnswerStatus;
      trigger: ChatTurnTrigger;
      channel: AgentChannel;
    }
  | { type: "tasks-changed"; ownerId: string; chatId: string }
  /**
   * Сообщение человека записано без хода: `beforeTurn` сказал «записать и промолчать» (`{ hold: true }`). Агент ответит
   * позже — когда приложение разбудит его (`deliverNotices`).
   */
  | { type: "turn-held"; ownerId: string; chatId: string; messageId: string; trigger: ChatTurnTrigger }
  /** Служебное сообщение записано без хода (например, «задача отменена»): вкладке пора перечитать историю. */
  | { type: "notice-added"; ownerId: string; chatId: string; messageId: string }
  /**
   * Сообщение записано без хода — сообщение пачки ждёт окна тишины (`sendBurstMessage`) или «Стоп» отменил пачку:
   * вкладке пора перечитать историю. Ход на пачку придёт потом своим `turn-started`.
   */
  | { type: "message-added"; ownerId: string; chatId: string; messageId: string }
  /**
   * Данные чата изменены (`service.updateChatData`). Самих данных в событии нет, вкладке оно не пересылается: данные
   * чата остаются на сервере. Новое значение видят инструменты и хуки со следующего хода.
   */
  | { type: "chat-data-changed"; ownerId: string; chatId: string }
  /** Хук итога хода не отработал после всех попыток. */
  | { type: "after-turn-failed"; ownerId: string; chatId: string; messageId: string }
  /**
   * Событие приложения вне потока ответа: открытая вкладка получает его живьём. `messageId` — у события хука итога,
   * доделанного после «Стопа»: оно уже дописано в этот ответ. У `publishAppEvent` его нет.
   */
  | { type: "app-event"; ownerId: string; chatId: string; messageId?: string; event: AppEvent }
  /** Чат закрыт (`closeChat`, инструмент или смена ветки на закрытую): вкладка закрывает поле ввода и показывает текст закрытия. */
  | { type: "chat-closed"; ownerId: string; chatId: string; closed: ChatClosure }
  /** Чат снова открыт (`reopenChat` или смена ветки на ветку без закрытия). */
  | { type: "chat-reopened"; ownerId: string; chatId: string }
  /**
   * Состояние чата на текущей ветке сменилось (после хода или смены ветки): вкладка обновляет то, что рисует по
   * состоянию. `state` — без служебных ключей SDK.
   */
  | { type: "state-changed"; ownerId: string; chatId: string; reason: StateChangeReason; state: AppStateValues; atMessageId: string | null }
  /** Хук смены состояния (`onStateChanged`) не отработал после всех попыток. */
  | { type: "state-changed-failed"; ownerId: string; chatId: string };

export interface ChatEvents {
  /** Возвращает отписку. */
  subscribe(listener: (event: ChatEvent) => void): () => void;
  emit(event: ChatEvent): void;
}

/** Рассылка событий в памяти процесса. Упавший слушатель не мешает остальным. */
export function createChatEvents(logError: (error: unknown) => void = () => {}): ChatEvents {
  const listeners = new Set<(event: ChatEvent) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (error) {
          logError(error);
        }
      }
    },
  };
}
