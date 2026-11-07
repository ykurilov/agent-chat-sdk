import type { AgentFlow } from "../format/flow-format";
import type { FlowRun, Transition } from "../engine/flow-run";
import { FLOW_CHAIN_LIMIT } from "../engine/flow-run";
import { activeExits, isFinal, stateById } from "../engine/flow-graph";
import { nextTransition } from "../engine/next-transition";
import { applyTransition, startRun } from "../engine/run-updates";
import { stateGoal } from "../prompt/state-card";
import type { FlowJudge, JudgeSettings } from "./flow-types";
import { createFlowJudge, type JudgeDeps, type JudgePort } from "./judge";
import type { FlowExitGuard } from "./confirmations";

export interface JudgeExchangeInput {
  flow: AgentFlow;
  stateId: string;
  transcript: readonly { role: "agent" | "person"; text: string }[];
  /** Область проверки лимитов и учёта расходов; чат не читается и не создаётся. */
  ownerId: string;
  chatId: string;
  signal?: AbortSignal;
}
export interface JudgeExchangeResult {
  stateId: string;
  transitions: Transition[];
  status: "checked" | "unchecked" | "aborted" | "chain_limit";
}
export interface JudgeExchangeOptions extends JudgeDeps {
  judge: JudgeSettings;
  port: (scope: { ownerId: string; chatId: string }) => JudgePort | Promise<JudgePort>;
  /** Защищённые выходы не симулируются без долговечного подтверждения. */
  exitGuards?: readonly FlowExitGuard[];
}

/** Проверка готового разговора без хода, истории, таймеров и записи состояния. Расход судьи учитывается как обычно. */
export function judgeExchange(input: JudgeExchangeInput, options: JudgeExchangeOptions): Promise<JudgeExchangeResult> {
  const deps = { ...options, logError: options.logError ?? ((message: string) => console.error(message)) };
  return evaluateExchange(input, createFlowJudge(options.judge, options.port, deps),
    (state, exitId) => Boolean(options.exitGuards?.some(guard => guard.flowId === input.flow.id && guard.state === state && guard.exitId === exitId)), deps.logError);
}

/** Внутренний общий путь: handle использует тот же экземпляр судьи и server-only guards. */
export async function evaluateExchange(input: JudgeExchangeInput, judge: FlowJudge,
  guarded: (state: string, exitId: string) => boolean, logError: (message: string) => void = () => {}): Promise<JudgeExchangeResult> {
  const { flow, stateId, transcript, ownerId, chatId, signal } = input;
  if (!stateById(flow, stateId)) throw new TypeError(`judgeExchange: неизвестное состояние «${stateId}»`);
  if (!ownerId || !chatId || transcript.some(item => !["agent", "person"].includes(item.role) || typeof item.text !== "string"))
    throw new TypeError("judgeExchange: нужны ownerId, chatId и текстовые реплики agent/person");
  // Локальный run нужен только движку (включая return target); история переданного состояния неизвестна.
  let run: FlowRun = { ...startRun(flow, 0), state: stateId, path: [{ state: stateId, at: 0, tags: stateById(flow, stateId)!.tags, from: null, exitId: null, decidedBy: "start" as const }] };
  const transitions: Transition[] = [];
  const result = (status: JudgeExchangeResult["status"]): JudgeExchangeResult => ({ stateId: run.state, transitions, status });
  const messages = transcript.map(({ role, text }) => ({ role: role === "person" ? "human" as const : "agent" as const, text }));
  while (run.chain < FLOW_CHAIN_LIMIT) {
    if (signal?.aborted) return result("aborted");
    const state = stateById(flow, run.state)!;
    if (isFinal(state)) return result("checked");
    const exits = activeExits(flow, state).filter(({ exit }) => !guarded(run.state, exit.id));
    // Одна последняя реплика человека — одно событие, а не по событию в каждом состоянии цепочки.
    const message = run.chain === 0 && transcript.at(-1)?.role === "person"
      ? nextTransition(flow, run, { type: "event", event: "message" }, 0) : null;
    let transition = message && exits.some(({ exit }) => exit.id === message.exitId) ? message : null;
    const conditions = exits.flatMap(({ exit }) => exit.when.type === "judge" ? [{ exitId: exit.id, text: exit.when.text }] : []);
    if (!transition && conditions.length) {
      let verdicts;
      try { verdicts = await judge.checkAll({ ownerId, chatId, messages, goal: stateGoal(state.instructions), conditions, includeRejected: true, ...(signal && { signal }) }); }
      catch (error) { logError(`Судья разговора: ${error instanceof Error ? error.message : String(error)}`); return result(signal?.aborted ? "aborted" : "unchecked"); }
      if (signal?.aborted) return result("aborted");
      if (!verdicts.length) return result("unchecked");
      for (const condition of conditions) {
        const verdict = verdicts.find(item => item.exitId === condition.exitId && item.confirmed);
        if (!verdict) continue;
        transition = nextTransition(flow, run, { type: "verdict", exitId: verdict.exitId, probability: verdict.probability, decidedBy: "judge" }, 0);
        if (transition) break;
      }
    }
    if (!transition) return result("checked");
    transitions.push(transition);
    run = applyTransition(flow, run, transition);
  }
  return result(isFinal(stateById(flow, run.state)!) ? "checked" : "chain_limit");
}
