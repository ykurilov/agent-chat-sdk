import type { ChatEvent, DeliverNoticesInput, DeliverNoticesResult } from "@ykurilov/agent-chat-core";
import type { MessengerName } from "./messenger-adapter";

/**
 * Кусок потока ответа агента. Мессенджерам нужны немногие поля, поэтому тип узкий: поток ядра (`UIMessageChunk`)
 * подходит к нему как есть.
 */
export interface AnswerChunk {
  type: string;
  id?: string;
  delta?: string;
  messageId?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  approvalId?: string;
  errorText?: string;
}

/** Сообщение человека для службы: текст и файлы (`attachment:<id>`). */
export interface MessengerUserMessage {
  id: string;
  role: "user";
  parts: Array<{ type: "text"; text: string } | { type: "file"; url: string; mediaType: string; filename: string }>;
}

/**
 * Сообщение истории чата: части нужны для служебных сообщений о задачах, номер — чтобы повтор обновления после сбоя
 * узнал своё сообщение.
 */
export interface HistoryMessage {
  id?: string;
  role: string;
  parts: ReadonlyArray<{ type: string; data?: unknown; text?: string; url?: string; mediaType?: string; filename?: string }>;
}

/** Задача чата глазами мессенджеров: `TaskView` пакета фона подходит как есть. */
export interface MessengerTaskView {
  id: string;
  title: string;
  status: string;
  progress?: { pendingApproval?: { approvalId: string; toolName: string; title?: string } };
}

/**
 * Что мессенджерам нужно от службы чата (`ChatService` ядра с методами этапа 4). Служба ядра подходит к нему
 * по форме; в тестах её заменяет поддельная.
 */
export interface MessengerChatService {
  /** У агента включены живые демонстрации: вместо блока ```html-demo — фраза `liveDemoOnSite`. Нет — блок кодом. */
  readonly liveDemos?: boolean;
  /**
   * Служба проверяет ответы перед показом (`replyChecks`): ход, который видит веб, в мессенджер не печатается по ходу —
   * только «печатает…» и проверенный итог. Ход человека из мессенджера ядро придерживает само.
   */
  readonly checksReplies?: boolean;
  /** Новый чат человека. Приложение может не дать его завести (`beforeCreateChat`): `ChatCreationRefusedError`, человеку — её текст. */
  createChat(userId: string, options: { origin: MessengerName }): Promise<{ id: string }>;
  /** Чаты человека; закрытый помечен в `/chats`. */
  listChats(userId: string): Promise<ReadonlyArray<{ id: string; title: string | null; updatedAt: string; closed?: { code: string; message: string } }>>;
  /** История чата: из неё берутся служебные сообщения о задачах (название, ждущее подтверждение). */
  getHistory(userId: string, chatId: string): Promise<{ messages: ReadonlyArray<HistoryMessage>; running?: boolean }>;
  sendMessage(
    userId: string,
    chatId: string,
    message: MessengerUserMessage,
    options: { channel: MessengerName; group?: { allowedTools: readonly string[]; author: string } },
  ): Promise<ReadableStream<AnswerChunk>>;
  /**
   * Проверка перед ходом (`beforeTurn` приложения) без начала хода: бросает `TurnRefusedError`, если приложение
   * не пускает, `ChatClosedError` — чат закрыт. Шлюз зовёт её до разбора вложений: отказанному человеку не нужно платить за распознавание голоса.
   * Нет метода — проверка остаётся только в `sendMessage`.
   */
  assertTurnAllowed?(userId: string, chatId: string, action: "send"): Promise<void>;
  /**
   * Право человека в чате (`chatCapabilities` приложения): бросает `ActionForbiddenError`, если нельзя. Шлюз зовёт её
   * по виду входящего до разбора вложений (`voice` — голосовое, `attachments` — файлы), чтобы не скачивать и не
   * распознавать платно, и перед `/chats` (`chatList`). Нет метода — права в мессенджере не проверяются.
   */
  assertCapability?(userId: string, chatId: string, capability: "voice" | "attachments" | "chatList"): Promise<void>;
  /** Поток идущего ответа с начала; `null`, если хода нет. */
  subscribe(userId: string, chatId: string): Promise<ReadableStream<AnswerChunk> | null>;
  stop(userId: string, chatId: string): Promise<boolean>;
  answerApproval(userId: string, chatId: string, approvalId: string, answer: "allow" | "deny" | "always"): Promise<{ resumed: boolean }>;
  answerWidget(request: { chatId: string; ownerId: string; toolCallId: string; answer: unknown }): Promise<{ resumed: boolean }>;
  deliverNotices(input: DeliverNoticesInput): Promise<DeliverNoticesResult>;
  /** События чатов вне потока ответа; возвращает отписку. */
  subscribeEvents(listener: (event: ChatEvent) => void): () => void;
  /** Открыта ли у чата вкладка (подписка `watch`). */
  hasWatchers(ownerId: string, chatId: string): boolean | Promise<boolean>;
  /** Фоновые задачи; нет — кнопки задач не показываются. */
  tasks?: {
    cancel(ownerId: string, chatId: string, taskId: string): Promise<"canceled" | "not_found" | "already_finished">;
    /** `stale` — задача ждёт ответа уже на другой вопрос: нажата кнопка старой карточки. */
    answerApproval(ownerId: string, chatId: string, taskId: string, approvalId: string, decision: "allow" | "deny"): Promise<"resumed" | "not_found" | "stale">;
    /** Задачи чата: по ним видна пауза ради подтверждения. Нет — карточка паузы в мессенджер не приходит. */
    list?(ownerId: string, chatId: string): Promise<ReadonlyArray<MessengerTaskView>>;
  };
}
