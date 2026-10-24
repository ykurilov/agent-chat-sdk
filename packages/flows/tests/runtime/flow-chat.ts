import type { AgentSettings, AgentToolsSource, ChatService } from "@ykurilov/agent-chat-core";
import { vi } from "vitest";
import { noticeService, scriptedModel, userMessage } from "../../../core/tests/unit/support/notice-chat";
import { mockCatalog, mockModelId, readAll } from "../../../core/tests/unit/support/mock-model";
import { buildAgentFlow, type FlowModules } from "../../src/runtime/agent-flow";
import type { AgentFlowOptions, ClientCardTools, FlowJudge, FlowTimers, JudgeVerdict } from "../../src/runtime/flow-types";
import { memoryFlowStore } from "../../src/store/memory";
import type { FlowStore } from "../../src/store/flow-store";
import { fixtureJson, stateOf } from "../flow-fixtures";

type StreamCall = ReturnType<typeof scriptedModel>["doStreamCalls"][number];
type Script = NonNullable<Parameters<typeof scriptedModel>[0]>[number];

// Чат на модели-заглушке с подключённым сценарием: подделки судьи, таймеров и карточки — вместо модулей этапов 6–8.

export const OWNER = "anna";

/** Подделка судьи: `yes` — какие условия выполнены (вероятность 0.9). */
export function fakeJudge(setup: { yes?: string[] } = {}) {
  const yes = new Set(setup.yes ?? []);
  const verdict = (exitId: string): JudgeVerdict => {
    const confirmed = yes.has(exitId);
    return { exitId, probability: confirmed ? 0.9 : 0.2, confirmed, source: "decision" };
  };
  const judge = {
    checkClaim: vi.fn<FlowJudge["checkClaim"]>(async ({ exitId }) => verdict(exitId)),
    checkAll: vi.fn<FlowJudge["checkAll"]>(async ({ conditions }) => conditions.map(({ exitId }) => verdict(exitId)).filter((found) => found.confirmed)),
  } satisfies FlowJudge;
  return { judge, yes };
}

export function fakeTimers() {
  return {
    start: vi.fn(),
    stop: vi.fn(async () => {}),
    tick: vi.fn(async () => {}),
    reschedule: vi.fn<FlowTimers["reschedule"]>(async () => {}),
  } satisfies FlowTimers;
}

export const emptyClientCard = (): ClientCardTools => ({ tools: {}, block: async () => "", read: async () => [], forget: async () => {} });

export interface FlowChatSetup {
  flowOptions?: Partial<AgentFlowOptions>;
  /** JSON сценария; `null` — чат без сценария. По умолчанию — «Разбор» прототипа. */
  flowJson?: Record<string, any> | null;
  edit?: (json: Record<string, any>) => void;
  scripts?: Script[];
  yes?: string[];
  tools?: AgentToolsSource;
  agent?: Partial<AgentSettings>;
  chatInstructions?: (chat: { id: string }) => Promise<string | null>;
  onTransition?: AgentFlowOptions["onTransition"];
  store?: FlowStore;
  /** Каталог службы и в `withChat`: сценарий знает набор инструментов модели хода. */
  withCatalog?: boolean;
  /** Остальные настройки службы чата: `privateStateKeys`, `staffOfChat`… */
  chatOptions?: Record<string, unknown>;
}

export function flowChat(setup: FlowChatSetup = {}) {
  const json = setup.flowJson === undefined ? fixtureJson("sales-review") : setup.flowJson;
  if (json && setup.edit) setup.edit(json);
  const model = scriptedModel(setup.scripts ?? []);
  const store = setup.store ?? memoryFlowStore();
  const fake = fakeJudge({ yes: setup.yes ?? [] });
  const { judge } = fake;
  const timers = fakeTimers();
  const logError = vi.fn<(message: string) => void>();
  const loadFlow = vi.fn<AgentFlowOptions["loadFlow"]>(async () => (json ? { flowId: String(json.id), versionId: "v1", flow: json } : null));
  const modules: FlowModules = { judge, timers, clientCard: emptyClientCard() };
  const flow = buildAgentFlow(
    {
      loadFlow,
      store,
      judge: { fallback: { modelId: mockModelId, providerId: "mock" } },
      logError,
      ...(setup.onTransition && { onTransition: setup.onTransition }),
      ...setup.flowOptions,
    },
    modules,
  );
  const options = flow.withChat({
    agent: { instructions: "Ты помощник.", ...(setup.tools && { tools: setup.tools }), ...setup.agent },
    ...(setup.chatInstructions && { chatInstructions: setup.chatInstructions }),
    ...(setup.withCatalog && { catalog: mockCatalog({ mock: model }) }),
    ...setup.chatOptions,
  });
  const { service, storage } = noticeService(model, { ...options, logError });
  flow.attach(service);
  return { model, storage, store, judge, yes: fake.yes, timers, logError, loadFlow, flow, service, json, options };
}

/** Новый чат; дальше — `say`. */
export async function newChat(service: ChatService) {
  return service.createChat(OWNER);
}

let messageNo = 0;

/** Сообщение человека, ход дочитан. */
export async function say(service: ChatService, chatId: string, text: string) {
  messageNo += 1;
  return readAll(await service.sendMessage(OWNER, chatId, userMessage(`m${messageNo}`, text)));
}

export async function runOf(service: ChatService, chatId: string) {
  const { values } = await service.getChatState(OWNER, chatId);
  return values.flow as { state: string; path: Array<{ state: string; decidedBy: string; probability?: number; tags: string[] }> } | undefined;
}

export const systemOf = (call: StreamCall) => JSON.stringify(call.prompt[0]);

/** Запрос без меток кэша: они переезжают на последнее сообщение и в сравнение начала не входят. */
export const plain = (prompt: StreamCall["prompt"]) =>
  prompt.map((message) => JSON.stringify(message).replace(/,"providerOptions":\{[^}]*\{[^}]*\}\}/g, ""));

/** Тексты всех сообщений человека запроса подряд. */
export const userTexts = (call: StreamCall): string =>
  call.prompt
    .filter((message) => message.role === "user")
    .map((message) => JSON.stringify(message.content))
    .join("\n");

/** Вывод инструмента в последнем сообщении с результатами запроса. */
export function toolOutput(call: StreamCall, toolCallId: string): string {
  for (const message of call.prompt) {
    if (message.role !== "tool") continue;
    for (const part of message.content) if (part.type === "tool-result" && part.toolCallId === toolCallId) return JSON.stringify(part.output);
  }
  throw new Error(`нет результата ${toolCallId}`);
}

export { stateOf };
