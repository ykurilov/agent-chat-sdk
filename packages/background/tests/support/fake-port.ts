import type {
  AgentChannel,
  AgentHelper,
  AgentToolsModel,
  BackgroundPort,
  ChatEvent,
  ChatEvents,
  DeliverNoticesInput,
  DeliverNoticesResult,
  RunHelperInput,
  RunHelperResult,
} from "@ykurilov/agent-chat-core";
import { jsonSchema } from "ai";
import type { ToolSet } from "ai";
import { vi } from "vitest";
import { backgroundTool } from "../../src/index";
import type { BackgroundRunContext } from "../../src/types";

export type ChatState = "free" | "busy" | "gone";

/** Поддельный порт ядра: доставка с ключом, состояние чата, события, поддельный цикл помощника. */
export interface FakePort extends BackgroundPort {
  /** Что доставлено (повтор с тем же ключом сюда не попадает, как в ядре). */
  delivered: DeliverNoticesInput[];
  /** Все попытки доставки, в том числе `busy`. */
  attempts: DeliverNoticesInput[];
  chatState: Map<string, ChatState>;
  emitted: ChatEvent[];
  errors: unknown[];
  finishTurn(ownerId: string, chatId: string): void;
}

export function createFakeEvents(): ChatEvents & { emitted: ChatEvent[] } {
  const listeners = new Set<(event: ChatEvent) => void>();
  const emitted: ChatEvent[] = [];
  return {
    emitted,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      emitted.push(event);
      for (const listener of listeners) listener(event);
    },
  };
}

export function createFakePort(options: {
  helpers?: Record<string, AgentHelper>;
  runHelper?: (input: RunHelperInput) => Promise<RunHelperResult>;
  events?: ChatEvents & { emitted: ChatEvent[] };
  /** Общие на несколько копий сервера: доставленное и ключи. */
  delivered?: DeliverNoticesInput[];
} = {}): FakePort {
  const events = options.events ?? createFakeEvents();
  const delivered = options.delivered ?? [];
  const attempts: DeliverNoticesInput[] = [];
  const chatState = new Map<string, ChatState>();
  const errors: unknown[] = [];
  const port: FakePort = {
    delivered,
    attempts,
    chatState,
    emitted: events.emitted,
    errors,
    events,
    ...(options.helpers && { helpers: options.helpers }),
    async deliverNotices(input): Promise<DeliverNoticesResult> {
      attempts.push(input);
      const state = chatState.get(input.chatId) ?? "free";
      if (state === "gone") return { status: "chat_gone", turnStarted: false };
      if (state === "busy") return { status: "busy", turnStarted: false };
      if (!delivered.some((item) => item.deliveryKey === input.deliveryKey)) delivered.push(input);
      return { status: "delivered", messageId: `notice-${delivered.length}`, turnStarted: input.wakeAgent };
    },
    runHelper: vi.fn(options.runHelper ?? (async (): Promise<RunHelperResult> => ({ status: "done", text: "готово", messages: [] }))),
    helperModel: vi.fn(async (name: string, ownerId: string, chatId: string) => ({ ...toolsModel({ ownerId, chatId }), helperName: name }) as AgentToolsModel),
    assertWithinLimit: vi.fn(async () => {}),
    logError: (error) => {
      errors.push(error);
    },
    finishTurn(ownerId, chatId) {
      chatState.set(chatId, "free");
      events.emit({ type: "turn-finished", ownerId, chatId, messageId: "answer", status: "complete", trigger: "human", channel: "web" });
    },
  };
  return port;
}

/** Модель хода основного агента, как её отдаёт ядро; `messageId` и `channel` необязательны. */
export function toolsModel(overrides: { ownerId?: string; chatId?: string; messageId?: string; channel?: AgentChannel } = {}): AgentToolsModel {
  return { ownerId: "anna", chatId: "chat-1", place: null, notifyDataChanged() {}, ...overrides } as unknown as AgentToolsModel;
}

let callCounter = 0;
/** Вызов инструмента так, как его зовёт цикл агента. */
export async function callTool(tools: ToolSet, name: string, input: unknown): Promise<any> {
  const tool = tools[name];
  if (!tool?.execute) throw new Error(`нет инструмента ${name}`);
  callCounter += 1;
  return tool.execute(input as never, { toolCallId: `call-${callCounter}`, messages: [], abortSignal: new AbortController().signal } as never);
}

/** Запуск, которым управляет тест: видно вход, сигнал, `reportProgress`; закончить — `resolve`/`reject`. */
export interface ControlledRun {
  input: unknown;
  context: BackgroundRunContext;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

export function controlledTool(options: { rerunAfterRestart?: boolean; timeoutMs?: number; needsApproval?: boolean; metadata?: { externalContent?: boolean } } = {}) {
  const runs: ControlledRun[] = [];
  const definition = backgroundTool({
    description: "Строит отчёт по сделкам",
    inputSchema: jsonSchema<{ period: string }>({ type: "object", properties: { period: { type: "string" } }, required: ["period"] }),
    title: (input) => `Отчёт за ${input.period}`,
    run: (input, context) =>
      new Promise((resolve, reject) => {
        runs.push({ input, context, resolve, reject });
      }),
    ...options,
  });
  return { definition, runs };
}

/** Даёт отработать всему, что ждёт в очереди обещаний и ввода-вывода; время на поддельных часах не двигается. */
export async function settle(rounds = 5): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Поддельные часы без подмены `setImmediate`: `settle` работает, таймеры и `Date` — под контролем теста. */
export const FAKE_TIMERS: { toFake: Array<"setTimeout" | "clearTimeout" | "setInterval" | "clearInterval" | "Date"> } = {
  toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
};
