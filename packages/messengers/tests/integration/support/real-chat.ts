import { createChatService, createInMemoryChatStorage, createRunningAnswerRegistry, type ReplyChecksSetting } from "@ykurilov/agent-chat-core";
import type { ChatHandlerOptions } from "@ykurilov/agent-chat-server";
import { createChatServer } from "@ykurilov/agent-chat-server";
import { type BackgroundTasksOptions, createBackgroundTasks, memoryTaskStore } from "@ykurilov/agent-chat-background";
import { createSpendingLimits } from "@ykurilov/agent-chat-limits";
import { vi } from "vitest";
import { createMessengers } from "../../../src/create-messengers";
import type { ExternalChat, MessengerName } from "../../../src/messenger-adapter";
import { createMemoryMessengerStore } from "../../../src/store/memory-store";
import type { MessengerBot, MessengersOptions } from "../../../src/types";
import type { HumanEvent, Outgoing, Person } from "../../fake-apis/rig";
import { createScriptedModel } from "./scripted-model";

/** Поддельный мессенджер для связки: бот на вебхуке, событие человека → запрос на адрес вебхука приложения. */
export interface MessengerChannel {
  messenger: MessengerName;
  bot: MessengerBot;
  /** Адрес вебхука внутри `basePath` мессенджеров. */
  webhookPath: string;
  webhookRequest(url: string, event: HumanEvent): Request;
  readonly outgoing: Outgoing[];
  /** Ответы на нажатия кнопок (всплывающий текст). */
  readonly answers: Array<{ callbackId: string; text?: string }>;
  /** Личный чат человека с ботом: у Telegram и VK — номер человека, у MAX — свой номер. */
  privateChatOf(person: Person): ExternalChat;
  /** Группа, куда добавлен бот. */
  readonly group: ExternalChat;
  close(): Promise<void>;
}

export const BASE_PATH = "/api/messengers";
export const WEB_CHAT_URL = "https://app.test/chat";

/** Долгая память: у каждого человека своя строка — по ней видно, чья память ушла модели. */
export function memoryOf(userId: string) {
  return `Память человека ${userId}`;
}
const fakeMemory = {
  instructions: "",
  tools: () => ({}),
  toolNames: [],
  snapshot: async ({ userId }: { userId: string }) => memoryOf(userId),
} as unknown as NonNullable<ChatHandlerOptions["memory"]>;

export interface RealChatOptions {
  channel: MessengerChannel;
  /** Бюджет человека в долларах; нет — без лимитов. */
  budgetUsd?: number;
  server?: Partial<ChatHandlerOptions>;
  messengers?: Partial<MessengersOptions>;
  /** Фоновые задачи (хранилище в памяти); нет — без фона. */
  background?: Omit<BackgroundTasksOptions, "store">;
  /**
   * Проверки ответа (061): мессенджеры получают свою службу ядра с `replyChecks` на том же хранилище (сервер чата их
   * пока не передаёт). Служба помечена `checksReplies`.
   */
  replyChecks?: ReplyChecksSetting;
}

/**
 * Настоящая служба чата (`createChatServer`, память, лимиты) и `createMessengers` на поддельном мессенджере.
 * Часы поддельные: очередь отправки ждёт паузы между правками, `settle` прокручивает время, пока всё не разойдётся.
 */
export async function startRealChat(options: RealChatOptions) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: new Date("2026-10-05T09:00:00Z") });
  const model = createScriptedModel();
  const storage = createInMemoryChatStorage();
  const limitErrors: unknown[] = [];
  const limits =
    options.budgetUsd === undefined
      ? undefined
      : createSpendingLimits({ storage, catalog: model.catalog, budget: () => ({ user: options.budgetUsd as number }), logError: (error) => limitErrors.push(error) });
  const serverErrors: string[] = [];
  const background = options.background && createBackgroundTasks({ store: memoryTaskStore(), ...options.background });
  const server = createChatServer({
    basePath: "/api/chat",
    storage,
    resolveUser: async (request) => ({ id: request.headers.get("x-user") ?? "anna" }),
    defaultChoice: { modelId: "mock-model", providerId: "mock" },
    catalog: model.catalog,
    agent: { instructions: "Ты помощник." },
    compaction: false,
    env: { MOCK_API_KEY: "не-настоящий-ключ" },
    memory: fakeMemory,
    chatList: true,
    logError: (message) => serverErrors.push(message),
    ...(limits && { limits }),
    ...(background && { background }),
    ...options.server,
  });
  const service = options.replyChecks ? checkedService(options.replyChecks) : server.service;
  /** Служба ядра с проверками ответа на тех же хранилище и модели; вкладки — у сервера. */
  function checkedService(replyChecks: ReplyChecksSetting) {
    const core = createChatService({
      storage,
      catalog: model.catalog,
      registry: createRunningAnswerRegistry(),
      defaultChoice: { modelId: "mock-model", providerId: "mock" },
      agent: { instructions: "Ты помощник." },
      compaction: false,
      env: { MOCK_API_KEY: "не-настоящий-ключ" },
      replyChecks,
      logError: (message) => serverErrors.push(message),
    });
    return { ...core, hasWatchers: server.service.hasWatchers, checksReplies: true as const };
  }
  const store = createMemoryMessengerStore();
  const errors: unknown[] = [];
  const messengers = createMessengers({
    service,
    store,
    resolveUser: async () => null,
    bots: [options.channel.bot],
    basePath: BASE_PATH,
    webChatUrl: (chatId) => `${WEB_CHAT_URL}/${chatId}`,
    logError: (error) => errors.push(error),
    ...options.messengers,
  });
  await messengers.start();

  /** Прокручивает время, пока обновления не обработаны и очереди отправки не пусты. */
  async function settle() {
    let done = false;
    const flushed = messengers.flush().then(() => {
      done = true;
    });
    for (let step = 0; step < 600 && !done; step++) await vi.advanceTimersByTimeAsync(100);
    await flushed;
  }

  /** Прокручивает время, пока не выполнится условие (фон доставляет итог сам, без действий человека). */
  async function until(condition: () => boolean | Promise<boolean>, what = "условие") {
    for (let step = 0; step < 300; step++) {
      await settle();
      if (await condition()) return;
      await vi.advanceTimersByTimeAsync(100);
    }
    throw new Error(`Не дождались: ${what}`);
  }

  /** Человек что-то делает в мессенджере; ждём, пока бот закончит отвечать. */
  async function human(event: HumanEvent) {
    const response = await messengers.handler.fetch(options.channel.webhookRequest(`http://app.test${BASE_PATH}${options.channel.webhookPath}`, event));
    await settle();
    return response;
  }

  /** Аккаунт мессенджера привязан к человеку приложения. */
  async function link(person: Person, userId: string) {
    await store.saveLink({ messenger: options.channel.messenger, botId: options.channel.bot.botId, externalUserId: person.id, userId, name: person.name, linkedAt: new Date().toISOString() });
  }

  /** Запрос к серверу чата так, как его шлёт веб. */
  function web(method: string, path: string, body?: unknown, user = "anna") {
    return server.handler.fetch(
      new Request(`http://app.test/api/chat${path}`, {
        method,
        headers: { "x-user": user, ...(body !== undefined && { "content-type": "application/json" }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
    );
  }

  /** Тексты сообщений бота в чате мессенджера. */
  const textsIn = (externalChatId: string) => options.channel.outgoing.filter((message) => message.chatId === externalChatId).map((message) => message.text);

  async function close() {
    await messengers.stop();
    await background?.flush();
    vi.useRealTimers();
    await options.channel.close();
  }

  return { channel: options.channel, model, storage, server, service: server.service, messengerService: service, store, messengers, limits, background, errors, serverErrors, limitErrors, settle, until, human, link, web, textsIn, close };
}

export type RealChat = Awaited<ReturnType<typeof startRealChat>>;
