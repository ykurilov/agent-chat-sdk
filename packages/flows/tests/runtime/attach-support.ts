import type { ChatService, ChatStorage } from "@ykurilov/agent-chat-core";
import { vi } from "vitest";
import { noticeService, scriptedModel, userMessage, waitTurn } from "../../../core/tests/unit/support/notice-chat";
import { mockModelId, readAll } from "../../../core/tests/unit/support/mock-model";
import { buildAgentFlow, type FlowModules } from "../../src/runtime/agent-flow";
import type { AgentFlowOptions, FlowAttachment, LoadedFlow } from "../../src/runtime/flow-types";
import { memoryFlowStore } from "../../src/store/memory";
import type { FlowStore } from "../../src/store/flow-store";
import { fixtureJson } from "../flow-fixtures";
import { emptyClientCard, fakeJudge, OWNER } from "./flow-chat";

// Привязка к приложению: несколько служб с разной инструкцией на один сценарий. Часы подменяет тест (`Date`).

/** 13.10.2026 15:00 по Москве. */
export const T0 = Date.UTC(2026, 9, 13, 12, 0);
export const MSK = "Europe/Moscow";
export const NOVOSIBIRSK = "Asia/Novosibirsk";

type Script = NonNullable<Parameters<typeof scriptedModel>[0]>[number];

export interface AppService {
  name: string;
  service: ChatService;
  /** Хранилище чатов службы: новый процесс берёт то же. */
  storage: ChatStorage;
  model: ReturnType<typeof scriptedModel>;
}

export interface AttachSetup {
  /** Настоящий судья на запасной модели службы чата (ключа OpenRouter нет); по умолчанию — подделка. */
  realJudge?: boolean;
  /** Что отдаёт `loadFlow`; по умолчанию — «Разбор» с `v1`. */
  loaded?: (flowJson: Record<string, any>) => LoadedFlow;
  options?: Partial<AgentFlowOptions>;
  modules?: FlowModules;
  store?: FlowStore;
  edit?: (json: Record<string, any>) => void;
  /** Условия судьи, которые подделка подтверждает. */
  yes?: string[];
  /** `portFor` отвечает позже, обещанием — как у приложения, которому службу ещё предстоит найти. */
  asyncPort?: boolean;
}

/** Сценарий и приложение с несколькими службами; `portFor` ищет службу по чату. */
export function attachApp(setup: AttachSetup = {}) {
  const json = fixtureJson("sales-review");
  setup.edit?.(json);
  const store = setup.store ?? memoryFlowStore();
  const logError = vi.fn<(message: string) => void>();
  const { judge } = fakeJudge({ yes: setup.yes ?? [] });
  const owners = new Map<string, AppService>();
  const findService = (chatId: string) => {
    const found = owners.get(chatId);
    if (!found) throw new Error(`портов для чата ${chatId} нет`);
    return found.service;
  };
  const portFor = vi.fn<FlowAttachment["portFor"]>(({ chatId }) => {
    if (!setup.asyncPort) return findService(chatId);
    return new Promise((resolve, reject) => setTimeout(() => (owners.has(chatId) ? resolve(findService(chatId)) : reject(new Error(`портов для чата ${chatId} нет`))), 2));
  });
  if (setup.realJudge) vi.stubEnv("OPENROUTER_API_KEY", "");
  const flow = buildAgentFlow(
    {
      loadFlow: async () => (setup.loaded ? setup.loaded(json) : { flowId: "sales-review", versionId: "v1", flow: json }),
      store,
      judge: { fallback: { modelId: mockModelId, providerId: "mock" } },
      logError,
      ...setup.options,
    },
    { ...(setup.realJudge ? {} : { judge }), clientCard: emptyClientCard(), ...setup.modules },
  );

  /** Служба с инструкцией «Служба <имя>.» и, если задан, поясом приложения. */
  function addService(name: string, options: { timeZone?: string; scripts?: Script[]; storage?: ChatStorage } = {}): AppService {
    const model = scriptedModel(options.scripts ?? []);
    const chatOptions = flow.withChat({
      agent: { instructions: `Служба ${name}.`, ...(options.timeZone && { timeZone: options.timeZone }) },
    });
    const { service, storage } = noticeService(model, { ...chatOptions, logError, ...(options.storage && { storage: options.storage }) });
    return { name, service, storage, model };
  }

  /** Новый чат службы: `portFor` будет отдавать её. */
  async function openChat(app: AppService): Promise<string> {
    const { id } = await app.service.createChat(OWNER);
    owners.set(id, app);
    return id;
  }

  return { json, store, logError, judge, flow, portFor, addService, openChat, owners };
}

export type AttachApp = ReturnType<typeof attachApp>;

let messageNo = 0;

/** Сообщение человека (со страницы с поясом или из мессенджера — без); ход и фон дочитаны. */
export async function human(app: AttachApp, service: ChatService, chatId: string, text: string, timeZone?: string): Promise<string> {
  messageNo += 1;
  const id = `a${messageNo}`;
  await readAll(await service.sendMessage(OWNER, chatId, userMessage(id, text), timeZone ? { page: { timeZone } } : undefined));
  await app.flow.settled();
  return id;
}

export const clockAt = (at: number) => vi.setSystemTime(at);

/** Тик таймеров и ходы, которые он начал, дочитаны. */
export async function tickAll(app: AttachApp, chats: Array<{ service: ChatService; id: string }>) {
  await app.flow.tick();
  for (const chat of chats) await waitTurn(chat.service, chat.id);
  await app.flow.settled();
}

export async function agentTexts(service: ChatService, chatId: string): Promise<string[]> {
  const { messages } = await service.peekHistory(OWNER, chatId);
  return messages.filter((message) => message.role === "assistant").map((message) => message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""));
}

export async function stateOfChat(service: ChatService, chatId: string): Promise<string | undefined> {
  const { values } = await service.getChatState(OWNER, chatId);
  return (values.flow as { state?: string } | undefined)?.state;
}

/** Строки журнала, кроме обычного предупреждения «пояс человека неизвестен» (страница пояс не прислала). */
export const errorsBesidesZone = (app: AttachApp): string[] => app.logError.mock.calls.map(([message]) => message).filter((message) => !message.includes("пояс человека неизвестен"));

export { OWNER };
