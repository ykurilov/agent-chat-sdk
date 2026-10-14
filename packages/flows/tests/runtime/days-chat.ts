import type { AgentSettings } from "@ykurilov/agent-chat-core";
import { vi } from "vitest";
import { noticeService, scriptedModel } from "../../../core/tests/unit/support/notice-chat";
import { mockModelId } from "../../../core/tests/unit/support/mock-model";
import { buildAgentFlow } from "../../src/runtime/agent-flow";
import type { AgentFlowOptions, FlowFinish, FlowTransitionEvent } from "../../src/runtime/flow-types";
import { memoryFlowStore } from "../../src/store/memory";
import { fixtureJson, stateOf } from "../flow-fixtures";
import { emptyClientCard, fakeJudge } from "./flow-chat";

type Script = NonNullable<Parameters<typeof scriptedModel>[0]>[number];
type StreamCall = ReturnType<typeof scriptedModel>["doStreamCalls"][number];

// Трёхдневный сценарий на модели-заглушке с настоящими таймерами: «Знакомство» 1 день → «Поиск затыка» 1 день →
// «Предложение»; срок 3 дня, при «срок вышел» — «Полезный совет и прощание». Тишина — 1000 ч: дни видно без касаний.

export const NSK = "Asia/Novosibirsk";
/** Момент по Москве: день октября 2026 и часы. 13.10.2026 — вторник. */
export const msk = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour - 3, minute);
export const nsk = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour - 7, minute);
export const iso = (at: number) => new Date(at).toISOString();

export function threeDays(json: Record<string, any>, schedule: Record<string, unknown> = {}) {
  json.anyState.exits[0].when.amount = 1000;
  json.schedule = { dayStart: "09:00", nightFrom: "21:00", lengthDays: 3, deadlineState: "soft", ...schedule };
  stateOf(json, "intro").exits.push({ id: "intro_day", when: { type: "timer", from: "state_days", days: 1 }, to: "block" });
  stateOf(json, "block").exits.push({ id: "block_day", when: { type: "timer", from: "state_days", days: 1 }, to: "offer" });
}

export interface DaysChatSetup {
  edit?: (json: Record<string, any>) => void;
  scripts?: Script[];
  yes?: string[];
  agent?: Partial<AgentSettings>;
  people?: AgentFlowOptions["people"];
  loadFlow?: (json: Record<string, any>) => AgentFlowOptions["loadFlow"];
}

export function daysChat(setup: DaysChatSetup = {}) {
  const json = fixtureJson("sales-review");
  (setup.edit ?? threeDays)(json);
  const model = scriptedModel(setup.scripts ?? []);
  const store = memoryFlowStore();
  const { judge } = fakeJudge({ yes: setup.yes ?? [] });
  const logError = vi.fn<(message: string) => void>();
  const finished: FlowFinish[] = [];
  const transitions: FlowTransitionEvent[] = [];
  const flow = buildAgentFlow(
    {
      loadFlow: setup.loadFlow?.(json) ?? (async () => ({ flowId: "sales-review", versionId: "v1", flow: json })),
      store,
      judge: { fallback: { modelId: mockModelId, providerId: "mock" } },
      logError,
      onFinish: (event) => void finished.push(event),
      onTransition: (event) => void transitions.push(event),
      ...(setup.people && { people: setup.people }),
    },
    { judge, clientCard: emptyClientCard() },
  );
  const options = flow.withChat({ agent: { instructions: "Ты помощник.", ...setup.agent } });
  const { service, storage } = noticeService(model, { ...options, logError });
  flow.attach(service);
  return { model, store, storage, flow, service, logError, json, finished, transitions };
}

/** Постоянная инструкция запроса: системные сообщения. */
export const systemOf = (call: StreamCall) =>
  call.prompt.filter((message) => message.role === "system").map((message) => String(message.content)).join("\n");

/** Весь запрос текстом: хвост шага, служебные сообщения. */
export const promptText = (call: StreamCall) => JSON.stringify(call.prompt);
