import type { AgentNotice, ChatCapability, ChatClosure, ChatEvent, DeliverNoticesInput, DeliverNoticesResult } from "@ykurilov/agent-chat-core";
import { ActionForbiddenError, AGENT_NOTICE_PART_TYPE, ChatCreationRefusedError, ChatNotFoundError } from "@ykurilov/agent-chat-core";
import type { AnswerChunk, HistoryMessage, MessengerChatService, MessengerTaskView, MessengerUserMessage } from "../../src/chat-port";

/** Поток ответа, в который тест сам дописывает куски. */
export function controlledStream() {
  let controller!: ReadableStreamDefaultController<AnswerChunk>;
  const stream = new ReadableStream<AnswerChunk>({
    start(value) {
      controller = value;
    },
  });
  return {
    stream,
    push(...chunks: AnswerChunk[]) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    close() {
      controller.close();
    },
  };
}

export function streamOf(chunks: AnswerChunk[]): ReadableStream<AnswerChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** Ответ агента обычным текстом. */
export function textAnswer(text: string, messageId = "answer-1"): AnswerChunk[] {
  return [
    { type: "start", messageId },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish" },
  ];
}

export interface SentCall {
  userId: string;
  chatId: string;
  message: MessengerUserMessage;
  options: Parameters<MessengerChatService["sendMessage"]>[3];
}

/** Поддельная служба чата: пишет вызовы; ответ на сообщение задаёт тест (`respond`). */
export function createFakeChatService() {
  const chats = new Map<string, { id: string; ownerId: string; title: string | null; updatedAt: string; origin?: string; closed?: ChatClosure }>();
  const listeners = new Set<(event: ChatEvent) => void>();
  const sent: SentCall[] = [];
  const stops: Array<{ userId: string; chatId: string }> = [];
  const approvals: Array<{ userId: string; chatId: string; approvalId: string; answer: string }> = [];
  const widgets: Array<{ chatId: string; ownerId: string; toolCallId: string; answer: unknown }> = [];
  const notices: DeliverNoticesInput[] = [];
  const taskCalls: Array<{ kind: "cancel" | "approval"; ownerId: string; chatId: string; taskId: string; approvalId?: string; decision?: string }> = [];
  const watchers = new Set<string>();
  const histories = new Map<string, HistoryMessage[]>();
  const taskViews = new Map<string, MessengerTaskView[]>();
  let chatCounter = 0;
  let running: ReadableStream<AnswerChunk> | null = null;

  const service = {
    respond: (_call: SentCall): ReadableStream<AnswerChunk> | Promise<ReadableStream<AnswerChunk>> => streamOf(textAnswer("Ответ")),
    /** Что вернёт `subscribe` (продолжение после ответа на подтверждение или виджет). */
    continuation: null as (() => ReadableStream<AnswerChunk> | null) | null,
    approvalResult: (): { resumed: boolean } | Error => ({ resumed: true }),
    widgetResult: (): { resumed: boolean } | Error => ({ resumed: true }),
    noticeResult: (_input: DeliverNoticesInput): DeliverNoticesResult => ({ status: "delivered", messageId: "notice-1", turnStarted: true }),
    stopResult: true,
    /** Вести историю, как ядро: сообщение с тем же id последним без ответа — без второй копии, иначе — отказ вставки. */
    keepHistory: false,
    /** Права чатов: `false` — `assertCapability` бросает `ActionForbiddenError`. */
    capabilities: {} as Partial<Record<ChatCapability, boolean>>,
    /** Отказ приложения в новом чате (`beforeCreateChat`); `null` — чат заводится. */
    createRefusal: null as { code: string; message: string } | null,

    async createChat(userId: string, options: { origin: string }) {
      if (service.createRefusal) throw new ChatCreationRefusedError(service.createRefusal);
      chatCounter++;
      const chat = { id: `chat-${chatCounter}`, ownerId: userId, title: null, updatedAt: new Date(Date.now() + chatCounter).toISOString(), origin: options.origin };
      chats.set(chat.id, chat);
      return { id: chat.id };
    },
    async listChats(userId: string) {
      return [...chats.values()]
        .filter((chat) => chat.ownerId === userId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(({ id, title, updatedAt, closed }) => ({ id, title, updatedAt, ...(closed && { closed }) }));
    },
    async getHistory(_userId: string, chatId: string) {
      return { messages: histories.get(chatId) ?? [] };
    },
    /** Что вернёт проверка перед ходом: бросить `TurnRefusedError` — приложение отказало. */
    turnGate: (_call: { userId: string; chatId: string; action: string }): void => {},
    async assertTurnAllowed(userId: string, chatId: string, action: string) {
      const chat = chats.get(chatId);
      if (!chat || chat.ownerId !== userId) throw new ChatNotFoundError(chatId);
      service.turnGate({ userId, chatId, action });
    },
    async assertCapability(userId: string, chatId: string, capability: ChatCapability) {
      const chat = chats.get(chatId);
      if (!chat || chat.ownerId !== userId) throw new ChatNotFoundError(chatId);
      if (service.capabilities[capability] === false) throw new ActionForbiddenError(capability);
    },
    async sendMessage(userId: string, chatId: string, message: MessengerUserMessage, options: SentCall["options"]) {
      const chat = chats.get(chatId);
      if (!chat || chat.ownerId !== userId) throw new ChatNotFoundError(chatId);
      const call = { userId, chatId, message: structuredClone(message), options };
      if (service.keepHistory) {
        const history = histories.get(chatId) ?? [];
        const index = history.findIndex((item) => item.id === message.id);
        if (index >= 0 && index < history.length - 1) throw new Error(`duplicate message id ${message.id}`);
        if (index < 0) histories.set(chatId, [...history, { id: message.id, role: "user", parts: structuredClone(message.parts) }]);
      }
      sent.push(call);
      const stream: ReadableStream<AnswerChunk> = await service.respond(call);
      running = stream;
      return stream;
    },
    async subscribe(_userId: string, _chatId: string): Promise<ReadableStream<AnswerChunk> | null> {
      return service.continuation ? service.continuation() : null;
    },
    async stop(userId: string, chatId: string): Promise<boolean> {
      stops.push({ userId, chatId });
      return service.stopResult;
    },
    async answerApproval(userId: string, chatId: string, approvalId: string, answer: "allow" | "deny" | "always"): Promise<{ resumed: boolean }> {
      approvals.push({ userId, chatId, approvalId, answer });
      const result = service.approvalResult();
      if (result instanceof Error) throw result;
      return result;
    },
    async answerWidget(request: { chatId: string; ownerId: string; toolCallId: string; answer: unknown }): Promise<{ resumed: boolean }> {
      widgets.push(structuredClone(request));
      const result = service.widgetResult();
      if (result instanceof Error) throw result;
      return result;
    },
    async deliverNotices(input: DeliverNoticesInput): Promise<DeliverNoticesResult> {
      notices.push(structuredClone(input));
      return service.noticeResult(input);
    },
    subscribeEvents(listener: (event: ChatEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hasWatchers(ownerId: string, chatId: string) {
      return watchers.has(`${ownerId}/${chatId}`);
    },
    tasks: {
      async cancel(ownerId: string, chatId: string, taskId: string) {
        taskCalls.push({ kind: "cancel", ownerId, chatId, taskId });
        return "canceled" as const;
      },
      async answerApproval(ownerId: string, chatId: string, taskId: string, approvalId: string, decision: "allow" | "deny") {
        taskCalls.push({ kind: "approval", ownerId, chatId, taskId, approvalId, decision });
        // Задача ждёт ответа на `ap-1` (как в карточках тестов); другой номер — вопрос уже сменился.
        return approvalId === "ap-1" ? ("resumed" as const) : ("stale" as const);
      },
      async list(_ownerId: string, chatId: string): Promise<MessengerTaskView[]> {
        return taskViews.get(chatId) ?? [];
      },
    },
  } satisfies MessengerChatService & Record<string, unknown>;

  return {
    service,
    chats,
    sent,
    stops,
    approvals,
    widgets,
    notices,
    taskCalls,
    get running() {
      return running;
    },
    emit(event: ChatEvent) {
      for (const listener of listeners) listener(event);
    },
    get listenerCount() {
      return listeners.size;
    },
    watch(ownerId: string, chatId: string) {
      watchers.add(`${ownerId}/${chatId}`);
    },
    /** Служебное сообщение в истории чата (результат задачи), как его пишет служба. */
    addNotices(chatId: string, notices: AgentNotice[]) {
      histories.set(chatId, [...(histories.get(chatId) ?? []), { role: "user", parts: [{ type: AGENT_NOTICE_PART_TYPE, data: { notices } }] }]);
    },
    /** Ответ агента в истории чата (ход закончен). */
    addAnswer(chatId: string, text = "Ответ") {
      const history = histories.get(chatId) ?? [];
      histories.set(chatId, [...history, { id: `answer-${history.length}`, role: "assistant", parts: [{ type: "text", text }] }]);
    },
    historyOf(chatId: string) {
      return histories.get(chatId) ?? [];
    },
    /** Задачи чата, как их отдаёт пакет фона. */
    setTasks(chatId: string, tasks: MessengerTaskView[]) {
      taskViews.set(chatId, tasks);
    },
    /** Чат человека, созданный в обход мессенджера (веб). */
    addChat(ownerId: string, title: string | null, origin = "web", closed?: ChatClosure) {
      chatCounter++;
      const chat = { id: `chat-${chatCounter}`, ownerId, title, updatedAt: new Date(Date.now() + chatCounter * 1000).toISOString(), origin, ...(closed && { closed }) };
      chats.set(chat.id, chat);
      return chat.id;
    },
  };
}

export type FakeChatService = ReturnType<typeof createFakeChatService>;
