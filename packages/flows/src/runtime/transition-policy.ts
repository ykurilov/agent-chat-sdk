import { judgeExits } from "../prompt/state-card";
import type { AgentToolsModel, AppEvent } from "@ykurilov/agent-chat-core";
import type { FlowRun, FlowTransitionMode } from "../engine/flow-run";
import type { FlowRuntime, PinnedFlow } from "./flow-events";
import type { FlowTransitionDecision, JudgeVerdict } from "./flow-types";

export const FLOW_TRANSITION_DECISION_EVENT = "flow.transition-decision";
const clip = (text: string, limit: number) => text.slice(0, limit);
export function validateTransitionMode(value: unknown): FlowTransitionMode {
  if (value === undefined) return "rails";
  if (value === "rails" || value === "advisor" || value === "free") return value;
  throw new TypeError("transitionMode: ожидается rails, advisor или free");
}
export function compactVerdict(verdict: JudgeVerdict): JudgeVerdict {
  return { exitId: verdict.exitId, confirmed: verdict.confirmed, probability: verdict.probability, source: verdict.source,
    ...(verdict.reason?.trim() && { reason: clip(verdict.reason.trim(), 2000) }) };
}
export function decisionEvent(input: {
  ownerId: string; chatId: string; turnId: string; pinned: PinnedFlow; run: Pick<FlowRun, "state">;
  exitId: string; to?: string; phase: FlowTransitionDecision["phase"]; kind: FlowTransitionDecision["kind"];
  decision: FlowTransitionDecision["decision"]; adviceId?: string; judge: JudgeVerdict | null; at: number; key: string; modelWhy?: string;
}): FlowTransitionDecision {
  return { id: `${input.turnId}:${input.key}:${input.exitId}`, ownerId: input.ownerId, chatId: input.chatId, turnId: input.turnId,
    flowId: input.pinned.flowId, versionId: input.pinned.versionId, mode: input.pinned.transitionMode ?? "rails", state: input.run.state,
    exitId: input.exitId, ...(input.to !== undefined && { to: input.to }), phase: input.phase, kind: input.kind, decision: input.decision,
    actor: input.phase === "judge" || input.decision === "rejected" || input.decision === "unavailable" ? "judge" : input.decision === "protected" || input.decision === "blocked" ? "server" : input.kind === "claim" || input.decision === "stayed" || input.decision === "not_selected" ? "model" : "judge",
    ...(input.adviceId && { adviceId: input.adviceId }),
    judge: input.judge && compactVerdict(input.judge), ...(input.modelWhy !== undefined && { modelWhy: clip(input.modelWhy, 1000) }), at: input.at };
}
export function decisionAppEvent(event: FlowTransitionDecision): AppEvent {
  return { type: FLOW_TRANSITION_DECISION_EVENT, data: event };
}
export async function publishDecision(runtime: FlowRuntime, event: FlowTransitionDecision, model?: Pick<AgentToolsModel, "emitAppEvent">): Promise<void> {
  await runtime.reportDecision?.(event);
  try { model?.emitAppEvent?.(decisionAppEvent(event)); }
  catch (error) { runtime.logError(`[сценарий] событие решения не записано: ${String(error)}`); }
}
export function verdictText(verdict: JudgeVerdict, threshold: number): string {
  return verdict.reason?.trim() || `Вероятность выполнения: ${verdict.probability}; порог: ${threshold}. Текстового довода нет.`;
}
/** Изменяемая политика и советы — только в хвосте, никогда в постоянной инструкции. */
export function transitionPolicyTail(pinned: PinnedFlow, run: FlowRun, turnId: string, threshold: number): string | undefined {
  const mode = pinned.transitionMode ?? "rails";
  if (mode === "rails") return undefined;
  const lines = ["[flow:policy]", `Режим переходов: ${mode}.`];
  if (mode === "free") lines.push("Обычные выходы словами выбираешь ты. flow_exit проверит существование выхода текущего состояния и ограничения сервера без обычного судьи.");
  else lines.push("Судья советует, но не запрещает обычный переход. После отрицательного совета можешь остаться либо повторить flow_exit с confirm=true и своим why в этом же ходе. Защищённые выходы по-прежнему проверяются сервером.");
  lines.push("[/flow:policy]");
  const advice = run.transitionAdvice;
  if (mode === "advisor" && advice?.forTurnId === turnId && advice.state === run.state && advice.verdicts.length) {
    lines.push("[flow:advice]", "После предыдущего ответа судья счёл условия выполненными. Это совет: оцени его и реши сам, продолжать ли текущее состояние.",
      ...advice.verdicts.map(verdict => { const exits = judgeExits(pinned.flow, run.state); const index = exits.findIndex(item => item.exitId === verdict.exitId); return JSON.stringify({ exit: index + 1, condition: exits[index]?.text.slice(0, 800), exitId: verdict.exitId, confirmed: verdict.confirmed, probability: verdict.probability, source: verdict.source, assessment: verdictText(verdict, threshold) }); }), "[/flow:advice]");
  }
  return lines.join("\n");
}
