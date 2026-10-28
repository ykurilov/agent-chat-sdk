import { transitionPolicyTail } from "./transition-policy";
import type { StepContext } from "@ykurilov/agent-chat-core";
import type { AgentFlow } from "../format/flow-format";
import { currentRun, type FlowRuntime } from "./flow-events";
import { chatTime } from "./test-clock";
import { beforeFirstNight } from "../engine/flow-days";
import type { FlowTailPart } from "./tail/tail-part";
import type { FlowStepContextInput } from "./flow-types";
import { dayLine } from "./tail/day-line";
import { frameLine } from "./tail/frame-line";
import { sideTasksLine } from "./tail/side-tasks-line";

/** Строки хвоста по порядку: день, рамка дня, попутные задачи. Каждую делает свой модуль. */
export const FLOW_TAIL_PARTS: readonly FlowTailPart[] = [dayLine, frameLine, sideTasksLine];

/** Есть ли у сценария что сказать в хвосте. Нет — хвост не считается вовсе. */
const hasTail = (flow: AgentFlow) => flow.schedule !== undefined || (flow.sideTasks?.length ?? 0) > 0;

/**
 * `agent.stepContext` со строками сценария. Номер дня, рамки и попутные задачи — только здесь: хвост не пишется в историю
 * и стоит после всех кэшируемых частей, постоянная инструкция от дня не зависит. Сначала хвост приложения, затем строки
 * сценария. Сценарий без «Дней и времени» и попутных задач — хвост приложения как есть.
 */
export function withStepTail(own: StepContext | undefined, runtime: FlowRuntime, parts: readonly FlowTailPart[] = FLOW_TAIL_PARTS): StepContext {
  return async (input) => {
    const pinned = input.audience === "group" ? null : await runtime.chatFlow(input.ownerId, input.chatId);
    const run = pinned ? currentRun(pinned.flow, input.state, runtime.now()) : null;
    // Ход «пишет первым» — приложение видит его причины (`firstReasons`).
    const firstReasons = run?.answerId === input.messageId ? run.firstReasons : undefined;
    const app = own ? await own(firstReasons ? ({ ...input, firstReasons } as FlowStepContextInput) : input) : undefined;
    if (!pinned || !run) return app;
    const policy = transitionPolicyTail(pinned, run, input.messageId, runtime.judgeThreshold ?? 0.7);
    if (!hasTail(pinned.flow)) return policy ? [app?.trim(), policy].filter(Boolean).join("\n") : app;
    const now = chatTime(run, runtime.now());
    // Пояс — человека; не знаем — приложения или сервера, и в первый день до ночи агент узнаёт город.
    const known = runtime.timeZones ? await runtime.timeZones.known(input.ownerId, input.chatId) : null;
    const timeZone = known ?? runtime.timeZones?.fallback(input.chatId) ?? "UTC";
    const { schedule } = pinned.flow;
    const askTimeZone = Boolean(schedule && !known && run.endedAt === undefined && beforeFirstNight(run, now, timeZone, schedule));
    const tail = { ownerId: input.ownerId, chatId: input.chatId, flow: pinned.flow, run, now, timeZone, runtime, staff: input.staff !== undefined, ...(askTimeZone && { askTimeZone }) };
    const lines: string[] = [];
    for (const part of parts) {
      const line = (await part(tail))?.trim();
      if (line) lines.push(line);
    }
    if (policy) lines.push(policy);
    if (lines.length === 0) return app;
    return [app?.trim(), ...lines].filter(Boolean).join("\n");
  };
}
