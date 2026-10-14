import type { AgentFlow, FlowAfterEnd } from "../format/flow-format";
import type { FlowEndReason, FlowRun, Transition } from "../engine/flow-run";
import { isFinal, stateById } from "../engine/flow-graph";
import { applyTransition } from "../engine/run-updates";
import { flowDay } from "../engine/flow-days";
import { FLOW_DEADLINE_EXIT } from "../engine/timers";
import type { FirstMessageRules, FlowFinish, FlowPort } from "./flow-types";
import type { ChatFlowRun, FlowRuntime, PinnedFlow } from "./flow-events";
import type { FlowDelivery } from "./flow-delivery";

// Конец разговора — запись `endedAt/endReason`, событие `onFinish`, прощание при сроке. По plan.md, «Конец разговора».
// Конец — точка передачи, а не тупик: событие несёт всё, что нужно передать человека дальше (место с заметками чата,
// карточка — по `ownerId`), а что делать с сообщением после конца, решает одно место — `afterEndOf`.

/** Имя служебного сообщения `app` прощального хода при «срок вышел». */
export const FLOW_DEADLINE_NOTICE = "flow_deadline";

const DEADLINE_REASON = { kind: "timer", text: "срок вышел" } as const;
const FAREWELL_NOTICE = "Срок программы вышел. Попрощайся с человеком одним сообщением: коротко подведи итог и скажи, что дальше.";

/**
 * Что делать с сообщением человека после конца (→ В6). Единственная точка решения: позже здесь встанет передача
 * следующему сценарию и признак «кто ведёт сейчас» (сценарий, рассылка, сотрудник).
 */
export function afterEndOf(flow: AgentFlow): FlowAfterEnd {
  return flow.afterEnd ?? "reply";
}

/**
 * Закрывает ли конечная нода разговор. Сценарий с «Днями и временем» или с заданным `afterEnd` — да; иначе, как в 0.48,
 * агент и дальше отвечает по карточке конечной ноды, а приложение узнаёт о ней только событием.
 */
export const finalEndsChat = (flow: AgentFlow) => flow.schedule !== undefined || flow.afterEnd !== undefined;

/** Переход «срок вышел» в `deadlineState`; его нет, он не задан или чат уже там — `null`. */
function deadlineTransition(flow: AgentFlow, run: FlowRun, at: number): Transition | null {
  const to = flow.schedule?.deadlineState;
  const state = to === undefined ? undefined : stateById(flow, to);
  if (!state || run.state === state.id) return null;
  return { from: run.state, to: state.id, exitId: FLOW_DEADLINE_EXIT, decidedBy: "timer", tags: state.tags, at, reason: DEADLINE_REASON };
}

/** Место чата, закрытого вне хода (таймер, перенос): переход в `deadlineState` и отметка конца. О переходе уже сообщено. */
export function endedRun<T extends FlowRun>(flow: AgentFlow, run: T, ended: { endedAt: number; endReason: FlowEndReason }): T {
  if (run.endedAt !== undefined) return run;
  const transition = ended.endReason === "deadline" ? deadlineTransition(flow, run, ended.endedAt) : null;
  const moved = transition ? (applyTransition(flow, run, transition) as T) : run;
  return { ...moved, endedAt: ended.endedAt, endReason: ended.endReason };
}

export interface FlowDeadlineInput {
  ownerId: string;
  chatId: string;
  pinned: PinnedFlow;
  run: ChatFlowRun;
  /** Когда срок вышел, по часам чата. */
  at: number;
  timeZone: string;
}

export interface FlowFinisher {
  /** Переходы хода: вход в конечную ноду — конец `final` (или только событие у сценария 0.48). */
  afterTransitions(input: { ownerId: string; chatId: string; pinned: PinnedFlow; run: FlowRun; transitions: readonly Transition[] }): Promise<void>;
  /** «Срок вышел»: конец `deadline`, переход в `deadlineState`, событие. Возвращает место после конца. */
  deadline(input: FlowDeadlineInput): Promise<{ run: ChatFlowRun; ended: boolean }>;
  /** Прощальный ход при «срок вышел» (→ В5): по правилам «писать первым»; готовый текст — без модели. */
  farewell(input: FlowDeadlineInput & { port: FlowPort; firstMessages: FirstMessageRules | null; delivery?: FlowDelivery }): Promise<void>;
  /** Конец вне хода: «не завершил» (3 дня тишины), «заблокировал» (исход доставки), причина приложения (`flow.end`). Один раз. */
  end(input: { ownerId: string; chatId: string; pinned: PinnedFlow; run: FlowRun; reason: FlowEndReason; outcome?: string; at: number }): Promise<{ ended: boolean }>;
}

export function createFlowFinish(input: { runtime: FlowRuntime; onFinish?: (event: FlowFinish) => void | Promise<void> }): FlowFinisher {
  const { runtime } = input;

  async function report(event: { ownerId: string; chatId: string; pinned: PinnedFlow; run: FlowRun; reason: FlowEndReason; outcome?: string; at: number }): Promise<void> {
    const { onFinish } = input;
    if (!onFinish) return;
    const { schedule } = event.pinned.flow;
    let day: number | null = null;
    if (schedule) {
      const timeZone = (await runtime.timeZones?.of(event.ownerId, event.chatId)) ?? "UTC";
      day = flowDay(event.run, event.at, timeZone, schedule).day;
      if (schedule.lengthDays !== undefined) day = Math.min(day, schedule.lengthDays);
    }
    const { answerId: _answerId, firstReasons: _firstReasons, ...run } = event.run as ChatFlowRun;
    const finish: FlowFinish = {
      ownerId: event.ownerId,
      chatId: event.chatId,
      flowId: event.pinned.flowId,
      versionId: event.pinned.versionId,
      reason: event.reason,
      ...(event.outcome !== undefined && { outcome: event.outcome }),
      day,
      state: event.run.state,
      tags: stateById(event.pinned.flow, event.run.state)?.tags ?? [],
      run,
      at: new Date(event.at),
    };
    const work = Promise.resolve()
      .then(() => onFinish(finish))
      .catch((error) => runtime.logError(`[сценарий] чат=${event.chatId} onFinish упал: ${error instanceof Error ? error.message : String(error)}`));
    if (runtime.track) runtime.track(work);
    else await work;
  }

  /** Закрыть разговор в хранилище; `true` — закрыл этот вызов (уже закрытый не закрывается второй раз). */
  async function close(chatId: string, reason: FlowEndReason, at: number): Promise<boolean> {
    const before = await runtime.store.getChat(chatId);
    if (!before || before.endedAt !== null) return false;
    const after = await runtime.store.endChat(chatId, { reason, at: new Date(at).toISOString() });
    return after !== null && after.endReason === reason && Date.parse(after.endedAt ?? "") === at;
  }

  return {
    async afterTransitions({ ownerId, chatId, pinned, run, transitions }) {
      const final = transitions.find((transition) => {
        const state = stateById(pinned.flow, transition.to);
        return state !== undefined && isFinal(state);
      });
      if (!final) return;
      if (finalEndsChat(pinned.flow) && !(await close(chatId, "final", final.at))) return;
      await report({ ownerId, chatId, pinned, run, reason: "final", at: final.at });
    },

    async deadline({ ownerId, chatId, pinned, run, at }) {
      const ended = await close(chatId, "deadline", at);
      const transition = deadlineTransition(pinned.flow, run, at);
      let next: ChatFlowRun = run;
      if (ended && transition) {
        next = applyTransition(pinned.flow, run, transition) as ChatFlowRun;
        await runtime.afterTransitions({ ownerId, chatId, pinned, run: next, transitions: [transition] });
      }
      if (ended) await report({ ownerId, chatId, pinned, run: next, reason: "deadline", at });
      return { run: endedRun(pinned.flow, next, { endedAt: at, endReason: "deadline" }), ended };
    },

    async farewell({ ownerId, chatId, pinned, at, timeZone, port, firstMessages, delivery }) {
      const schedule = pinned.flow.schedule;
      if (!schedule?.farewellOnDeadline) return;
      const record = await runtime.store.getChat(chatId);
      const chat = record ? { dayClosedOn: record.dayClosedOn, pausedUntil: record.pausedUntil, windowClosed: record.windowClosed } : undefined;
      const allowed = firstMessages
        ? await firstMessages.check({ ownerId, chatId, at, timeZone, schedule, ...(chat && { chat }) })
        : { allowed: true as const };
      // Нельзя писать сейчас — прощания нет: разговор уже закрыт, таймеров после конца нет.
      if (!allowed.allowed) return;
      const text = schedule.farewellText?.trim();
      const result = await port.deliverNotices({
        ownerId,
        chatId,
        notices: [{ kind: "app", name: FLOW_DEADLINE_NOTICE, title: FAREWELL_NOTICE, data: { reasons: [{ kind: "farewell" }] } }],
        wakeAgent: true,
        deliveryKey: `flow:${chatId}:deadline`,
        usageSource: "first_message",
        maxServerTurnsInRow: false,
        timeZone,
        ...(delivery?.own() && { awaitAnswer: true }),
        ...(text && { reply: { text } }),
      });
      if (result.status !== "delivered" || !result.turnStarted) return;
      if (delivery) await delivery.afterFirstTurn({ ownerId, chatId, answer: result.answer, reasons: [{ kind: "farewell" }], at, timeZone });
      else await firstMessages?.record({ ownerId, at, timeZone });
    },

    async end({ ownerId, chatId, pinned, run, reason, outcome, at }) {
      const ended = await close(chatId, reason, at);
      if (ended) await report({ ownerId, chatId, pinned, run, reason, ...(outcome !== undefined && { outcome }), at });
      return { ended };
    },
  };
}
