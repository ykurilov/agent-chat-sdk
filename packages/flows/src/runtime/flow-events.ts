import type { Chat } from "@ykurilov/agent-chat-core";
import type { AgentFlow, FlowExit } from "../format/flow-format";
import { FLOW_CHAIN_LIMIT, FLOW_STATE_KEY, type FlowRun, type Transition } from "../engine/flow-run";
import { stateById } from "../engine/flow-graph";
import { describeCondition, nextTransition, type FlowEvent } from "../engine/next-transition";
import { applyTransition, startRun } from "../engine/run-updates";
import { dayInProgress } from "../engine/flow-days";
import { stateCard } from "../prompt/state-card";
import type { FlowChatRecord, FlowStore } from "../store/flow-store";
import type { FlowNotice, FlowTransitionEvent } from "./flow-types";
import type { FlowFirstReason } from "../engine/nudges";
import type { FlowTimeZones } from "./first-message-rules";

/**
 * `FlowRun` в состоянии чата: плюс ответ агента, в начале которого он записан. По нему ожидающий переход судьи узнаёт
 * свою ветку: правка или «Переделать» начинают ветку с другим ответом — переход снимается.
 */
export type ChatFlowRun = FlowRun & {
  answerId?: string;
  /** Почему агент пишет первым в ответе `answerId`; ход на сообщение человека — нет. Для хвоста приложения. */
  firstReasons?: FlowFirstReason[];
};

/** Чат закреплён за версией сценария. */
export interface PinnedFlow {
  flowId: string;
  versionId: string;
  flow: AgentFlow;
  /** Разговор закончен (`endChat`): инструкция «после конца» вместо правил сценария. */
  ended?: boolean;
}

/** Что общего у частей сценария в службе чата: хранилище, часы, сценарий чата и отчёт о переходах. */
export interface FlowRuntime {
  store: FlowStore;
  now(): number;
  logError(message: string): void;
  /** Сценарий чата; с `chat` закрепляет незакреплённый чат за версией (`loadFlow`). `null` — чат без сценария. */
  chatFlow(ownerId: string, chatId: string, chat?: Chat): Promise<PinnedFlow | null>;
  /** Фоновая работа, которую ждёт `settled`; нет — не отслеживается (подделки в тестах). */
  track?(work: Promise<unknown>): void;
  /** Значения карточки клиента по `id` полей: для условий по данным. */
  cardValues(ownerId: string): Promise<Record<string, unknown>>;
  /** Пояс человека; нет — пояс хода (подделки в тестах). */
  timeZones?: FlowTimeZones;
  /** `AgentFlowOptions.defaultTimeZone`: пояс хода без страницы и без известного пояса человека — он, а не пояс службы. */
  defaultTimeZone?: string;
  /** Переходы случились: копия состояния в хранилище, `onTransition`. Не бросает. */
  afterTransitions(input: { ownerId: string; chatId: string; pinned: PinnedFlow; run: FlowRun; transitions: Transition[] }): Promise<void>;
}

/** Сообщить приложению о переходе (`onTransition`); ошибка приложения не ломает ход. */
export async function reportTransition(
  handler: ((event: FlowTransitionEvent) => void | Promise<void>) | undefined,
  event: FlowTransitionEvent,
  logError: (message: string) => void,
): Promise<void> {
  if (!handler) return;
  try {
    await handler(event);
  } catch (error) {
    logError(`[сценарий] чат=${event.chatId} onTransition ${event.from} → ${event.to} упал: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** `FlowRun` из состояния чата; нет или не то — `null`. */
export function storedRun(value: unknown): ChatFlowRun | null {
  return value && typeof value === "object" && typeof (value as FlowRun).state === "string" ? (value as ChatFlowRun) : null;
}

/** Где чат сейчас: из состояния ветки, а на пустой ветке — старт сценария. */
export function currentRun(flow: AgentFlow, values: Record<string, unknown> | undefined, now: number): ChatFlowRun {
  return storedRun(values?.[FLOW_STATE_KEY]) ?? startRun(flow, now);
}

/**
 * Куда перенесли чат при закреплении (`loadFlow`, `adopt`): состояние и моменты, от которых считаются сроки, а у идущего
 * чата — последние слова обеих сторон, шаг касаний и счёт сообщений человека за день. Нет поля — как у нового чата.
 */
export interface ChatPlacement {
  stateId?: string;
  startedAt?: number;
  enteredAt?: number;
  lastHumanAt?: number;
  lastAgentAt?: number;
  nudgeStep?: number;
  /** Сообщения человека за день сценария к моменту `at`. */
  humanToday?: { at: number; count: number };
}

/**
 * Место чата, перенесённого в заданное состояние: путь начинается с него, сроки таймеров — от `enteredAt` (нет — от
 * `startedAt`). Счёт дня ложится в день сценария по поясу `timeZone`; пояса нет — счёт не переносится.
 */
export function placedRun(flow: AgentFlow, placement: ChatPlacement, now: number, timeZone?: string): ChatFlowRun {
  const start = startRun(flow, now);
  const state = (placement.stateId !== undefined && stateById(flow, placement.stateId)) || stateById(flow, flow.start)!;
  const startedAt = placement.startedAt ?? now;
  const enteredAt = placement.enteredAt ?? placement.startedAt ?? now;
  return {
    ...start,
    state: state.id,
    startedAt,
    enteredAt,
    path: [{ state: state.id, at: enteredAt, tags: state.tags, from: null, exitId: null, decidedBy: "start" }],
    ...(placement.lastHumanAt !== undefined && { lastHumanAt: placement.lastHumanAt }),
    ...(placement.lastAgentAt !== undefined && { lastAgentAt: placement.lastAgentAt }),
    ...(placement.nudgeStep !== undefined && { nudgeStep: placement.nudgeStep }),
    ...(placement.humanToday && flow.schedule && timeZone && { dayCounts: { [dayInProgress(placement.humanToday.at, timeZone, flow.schedule)]: placement.humanToday.count } }),
  };
}

const msOf = (value: string | undefined) => (value === undefined ? undefined : Date.parse(value));

/** Перенос из записи чата; первый ход его уже записал в состояние (или переноса не было) — `null`. */
export function recordPlacement(record: Pick<FlowChatRecord, "stateId" | "placement">): ChatPlacement | null {
  const placement = record.placement;
  if (!placement) return null;
  const lastHumanAt = msOf(placement.lastHumanAt);
  const lastAgentAt = msOf(placement.lastAgentAt);
  return {
    stateId: record.stateId,
    startedAt: Date.parse(placement.startedAt),
    enteredAt: Date.parse(placement.enteredAt),
    ...(lastHumanAt !== undefined && { lastHumanAt }),
    ...(lastAgentAt !== undefined && { lastAgentAt }),
    ...(placement.nudgeStep !== undefined && { nudgeStep: placement.nudgeStep }),
    ...(placement.humanToday && { humanToday: { at: Date.parse(placement.humanToday.at), count: placement.humanToday.count } }),
  };
}

/**
 * Где чат сейчас вне хода: из состояния ветки; до первого хода перенесённого чата — из записи переноса; иначе старт.
 * Так таймеры, `admit` и `readRun` видят перенесённое место, не дожидаясь хода человека.
 */
export function chatRun(
  flow: AgentFlow,
  values: Record<string, unknown> | undefined,
  record: Pick<FlowChatRecord, "stateId" | "placement"> | null | undefined,
  now: number,
  timeZone?: string,
): ChatFlowRun {
  const stored = storedRun(values?.[FLOW_STATE_KEY]);
  if (stored) return stored;
  const placement = record ? recordPlacement(record) : null;
  return placement ? placedRun(flow, placement, now, timeZone) : startRun(flow, now);
}

/** `chatRun` для частей сценария вне хода: запись чата (если не передана) и пояс человека читаются тут. */
export async function runOutsideTurn(
  runtime: Pick<FlowRuntime, "store" | "timeZones">,
  chat: { ownerId: string; chatId: string },
  flow: AgentFlow,
  values: Record<string, unknown> | undefined,
  now: number,
  record?: FlowChatRecord | null,
): Promise<ChatFlowRun> {
  const stored = storedRun(values?.[FLOW_STATE_KEY]);
  if (stored) return stored;
  const found = record === undefined ? await runtime.store.getChat(chat.chatId) : record;
  if (!found?.placement) return startRun(flow, now);
  const timeZone = runtime.timeZones ? await runtime.timeZones.of(chat.ownerId, chat.chatId) : found.timeZone || undefined;
  return chatRun(flow, values, found, now, timeZone);
}

/** Шаг движка с проверкой условий по данным в новом состоянии: переходы складываются в `out`. */
export function advance(
  flow: AgentFlow,
  run: ChatFlowRun,
  event: FlowEvent,
  input: { now: number; card: Record<string, unknown>; out: Transition[]; onChainLimit: (run: FlowRun) => void },
): ChatFlowRun {
  let current = run;
  let step: FlowEvent | null = event;
  while (step) {
    const transition = nextTransition(flow, current, step, input.now);
    if (!transition) {
      // Движок молчит из-за предела переходов подряд, а без предела переход был бы: сценарий зациклился.
      if (current.chain >= FLOW_CHAIN_LIMIT && nextTransition(flow, { ...current, chain: 0 }, step, input.now)) input.onChainLimit(current);
      break;
    }
    current = applyTransition(flow, current, transition);
    input.out.push(transition);
    // В новом состоянии могли уже выполниться условия по данным: поле узнали раньше.
    step = { type: "data", card: input.card };
  }
  return current;
}

/** Строка журнала про зацикливание. */
export const chainLimitMessage = (chatId: string, run: FlowRun) =>
  `[сценарий] чат=${chatId} ${FLOW_CHAIN_LIMIT} переходов подряд без ответа агента, движок остановлен в «${run.state}»`;

/** Условие выхода по `id`: своё у состояния или общее. */
export function exitById(flow: AgentFlow, exitId: string): FlowExit | undefined {
  for (const state of flow.states) {
    const found = state.exits.find((exit) => exit.id === exitId);
    if (found) return found;
  }
  return flow.anyState.exits.find((exit) => exit.id === exitId);
}

export { describeCondition };

/** Точный первый текст состояния: агент пишет его слово в слово, без модели, когда это возможно. */
export function exactFirstText(flow: AgentFlow, stateId: string): string | null {
  return stateById(flow, stateId)?.firstMessage ?? null;
}

const sayExactly = (text: string) => `Первое сообщение этого состояния — скажи ровно это: «${text}»`;

/** Служебное сообщение модели о переходах вне её ответа: «Сработало: тишина 3 ч → «Напоминание»». */
export function transitionNotice(flow: AgentFlow, transitions: Transition[]): FlowNotice {
  const lines = transitions.map((transition) => {
    const exit = exitById(flow, transition.exitId);
    const title = stateById(flow, transition.to)?.title ?? transition.to;
    return `Сработало: ${exit ? describeCondition(flow, exit.when) : transition.exitId} → «${title}».`;
  });
  const last = transitions.at(-1)!;
  const first = exactFirstText(flow, last.to);
  if (first) lines.push(sayExactly(first));
  return {
    kind: "app",
    name: "flow_transition",
    title: lines.join("\n"),
    data: { from: transitions[0]!.from, to: last.to, exitIds: transitions.map((transition) => transition.exitId) },
  };
}

/** Результат инструмента, после которого сменилось состояние: карточка нового состояния и точный первый текст. */
export function transitionReport(flow: AgentFlow, run: FlowRun, transitions: Transition[]): string {
  const from = stateById(flow, transitions[0]!.from)?.title ?? transitions[0]!.from;
  const lines = [`Переход: «${from}» → «${stateById(flow, run.state)?.title ?? run.state}». Состояние сменилось, продолжай по новой карточке.`, "", stateCard(flow, run)];
  const first = exactFirstText(flow, run.state);
  if (first) lines.push("", sayExactly(first));
  return lines.join("\n");
}
