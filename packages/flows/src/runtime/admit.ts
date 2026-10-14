import type { FlowAdmitDecision, FlowAdmitInput, FlowPort } from "./flow-types";
import { runOutsideTurn, type FlowRuntime } from "./flow-events";
import { afterEndOf } from "./flow-finish";
import { chatTime } from "./test-clock";
import { flowDay } from "../engine/flow-days";
import { frameState, hardFrameText, humanMessagesToday } from "../engine/day-frame";
import { noteHeldUntilMorning } from "./held-messages";

// Решение о входящем: конец разговора, пауза, рамки дня. По plan.md, «Рамки дня и решение о входящем».

export type FlowAdmit = (input: FlowAdmitInput) => Promise<FlowAdmitDecision>;

/**
 * Решение для сообщения, которое только пришло: оно ещё не посчитано в `run.dayCounts` (счёт ведёт ход, а сообщение
 * без хода — «промолчать» — не считается). Поэтому оно `счёт + 1`-е за день: на `hardAt`-м — готовая фраза один раз,
 * дальше — молчание до начала следующего дня, а в его начале — ответ на накопленное. Без рамок дня, паузы и конца разговора — `answer`, как в 0.48.
 */
export function createFlowAdmit({ runtime, port }: { runtime: FlowRuntime; port: (chat: { ownerId: string; chatId: string }) => Promise<FlowPort> }): FlowAdmit {
  return async ({ ownerId, chatId }) => {
    const record = await runtime.store.getChat(chatId);
    if (!record || record.ownerId !== ownerId) return { kind: "answer" };
    // Человек написал — окно канала снова открыто, даже если ответа не будет (пауза, рамка дня, конец разговора).
    if (record.windowClosed) await runtime.store.setWindowClosed(chatId, false);
    const pinned = await runtime.chatFlow(ownerId, chatId);
    if (record.endedAt) return { kind: "ended", reason: record.endReason ?? "final", afterEnd: pinned ? afterEndOf(pinned.flow) : "reply" };
    if (record.pausedUntil && Date.parse(record.pausedUntil) > runtime.now()) return { kind: "paused" };
    const schedule = pinned?.flow.schedule;
    if (!pinned || !schedule?.dayFrame) return { kind: "answer" };

    const chatPort = await port({ ownerId, chatId });
    const { values } = await chatPort.getChatState(ownerId, chatId);
    // Перенесённый чат до первого хода — по записи переноса: счёт дня старой системы идёт в рамки.
    const run = await runOutsideTurn(runtime, { ownerId, chatId }, pinned.flow, values, runtime.now(), record);
    const at = chatTime(run, runtime.now());
    const timeZone = runtime.timeZones ? await runtime.timeZones.of(ownerId, chatId) : record.timeZone || "UTC";
    switch (frameState(humanMessagesToday(run, at, timeZone, schedule) + 1, schedule.dayFrame)) {
      case "last":
        return { kind: "reply", text: hardFrameText(schedule.dayFrame) };
      case "closed": {
        const morningAt = flowDay(run, at, timeZone, schedule).nextDayStartAt - (run.timeOffset ?? 0);
        await noteHeldUntilMorning({ store: runtime.store, port: chatPort, record, at, morningAt, logError: runtime.logError });
        return { kind: "hold", until: new Date(morningAt) };
      }
      default:
        return { kind: "answer" };
    }
  };
}
