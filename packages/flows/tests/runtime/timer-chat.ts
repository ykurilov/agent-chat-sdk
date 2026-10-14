import type { AgentSettings, ChatService, ChatStorage } from "@ykurilov/agent-chat-core";
import { vi } from "vitest";
import { noticeService, scriptedModel, userMessage, waitTurn } from "../../../core/tests/unit/support/notice-chat";
import { mockModelId, readAll } from "../../../core/tests/unit/support/mock-model";
import { buildAgentFlow } from "../../src/runtime/agent-flow";
import type { AgentFlowOptions, FlowChatOptions, FlowFinish } from "../../src/runtime/flow-types";
import { memoryFlowStore } from "../../src/store/memory";
import type { FlowStore } from "../../src/store/flow-store";
import { fixtureJson } from "../flow-fixtures";
import { emptyClientCard, fakeJudge, OWNER } from "./flow-chat";

type Script = NonNullable<Parameters<typeof scriptedModel>[0]>[number];

// Чат на модели-заглушке со сценарием и настоящими таймерами: тик зовёт тест, часы подменены (`Date`).

export const MSK = "Europe/Moscow";
/** 13.10.2026 15:00 по Москве. */
export const T0 = Date.UTC(2026, 9, 13, 12, 0);

export interface TimerChatSetup {
  flowJson?: Record<string, any>;
  edit?: (json: Record<string, any>) => void;
  scripts?: Script[];
  store?: FlowStore;
  /** Общее хранилище чатов: две копии сервера. */
  storage?: ChatStorage;
  firstMessages?: AgentFlowOptions["firstMessages"];
  agent?: Partial<AgentSettings>;
  yes?: string[];
  /** Остальные настройки службы чата: лимиты расходов и т. п. */
  chatOptions?: Parameters<typeof noticeService>[1];
  /** Свои ворота приложения: идут до ворот сценария. */
  beforeTurn?: FlowChatOptions["beforeTurn"];
  defaultTimeZone?: string;
  timers?: AgentFlowOptions["timers"];
}

export function timerChat(setup: TimerChatSetup = {}) {
  const json = setup.flowJson ?? fixtureJson("sales-review");
  setup.edit?.(json);
  const model = scriptedModel(setup.scripts ?? []);
  const store = setup.store ?? memoryFlowStore();
  const { judge } = fakeJudge({ yes: setup.yes ?? [] });
  const logError = vi.fn<(message: string) => void>();
  const finished: FlowFinish[] = [];
  const flow = buildAgentFlow(
    {
      loadFlow: async () => ({ flowId: "sales-review", versionId: "v1", flow: json }),
      store,
      judge: { fallback: { modelId: mockModelId, providerId: "mock" } },
      logError,
      onFinish: (event) => void finished.push(event),
      ...(setup.firstMessages !== undefined && { firstMessages: setup.firstMessages }),
      ...(setup.defaultTimeZone && { defaultTimeZone: setup.defaultTimeZone }),
      ...(setup.timers && { timers: setup.timers }),
    },
    { judge, clientCard: emptyClientCard() },
  );
  const options = flow.withChat({ agent: { instructions: "Ты помощник.", ...setup.agent }, ...(setup.beforeTurn && { beforeTurn: setup.beforeTurn }) });
  const { service, storage } = noticeService(model, { ...setup.chatOptions, ...options, logError, ...(setup.storage && { storage: setup.storage }) });
  flow.attach(service);
  return { model, store, storage, flow, service, logError, json, finished };
}

export type TimerChat = ReturnType<typeof timerChat>;
/** Что нужно помощникам: служба и сценарий (чаты других тестов собираются без `finished`). */
type ChatWithFlow = Pick<TimerChat, "service" | "flow">;

let messageNo = 0;

/** Сообщение человека со страницы (с поясом) или из мессенджера (`timeZone: null` — пояса нет); ход и фон дочитаны. */
export async function human(chat: ChatWithFlow, chatId: string, text: string, timeZone: string | null = MSK) {
  messageNo += 1;
  const id = `h${messageNo}`;
  const page = timeZone === null ? undefined : { page: { timeZone } };
  await readAll(await chat.service.sendMessage(OWNER, chatId, userMessage(id, text), page));
  await chat.flow.settled();
  return id;
}

/** Перевести часы. */
export function clockAt(at: number) {
  vi.setSystemTime(at);
}

/** Тик таймеров; если он начал ход — дождаться ответа и фона после него. */
export async function tick(chat: ChatWithFlow, chatId: string) {
  await chat.flow.tick();
  await waitTurn(chat.service, chatId);
  await chat.flow.settled();
}

export async function stateOfChat(service: ChatService, chatId: string): Promise<string | undefined> {
  const { values } = await service.getChatState(OWNER, chatId);
  return (values.flow as { state?: string } | undefined)?.state;
}

/** Тексты ответов агента в ветке, по порядку. */
export async function agentTexts(service: ChatService, chatId: string): Promise<string[]> {
  const { messages } = await service.peekHistory(OWNER, chatId);
  return messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""));
}

interface NoticePart {
  notices?: Array<{ kind: string; name?: string; data?: unknown }>;
  deliveryKey?: string;
  wakeAgent?: boolean;
}

/** Служебные сообщения `app` чата: имя, данные, ключ доставки и «будить». Экран их не показывает — читаем хранилище. */
export async function appNotices(storage: ChatStorage, chatId: string) {
  const messages = await storage.listMessages(chatId);
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (part.type !== "data-agent-notice") return [];
      const { notices = [], deliveryKey, wakeAgent } = (part as { data?: NoticePart }).data ?? {};
      return notices.filter((notice) => notice.kind === "app").map((notice) => ({ name: notice.name, data: notice.data, deliveryKey, wakeAgent }));
    }),
  );
}

export { OWNER };
