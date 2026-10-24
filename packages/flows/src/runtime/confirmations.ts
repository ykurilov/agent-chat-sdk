import { createHash } from "node:crypto";
import type { FlowConfirmationRecord, FlowConfirmationRef, FlowConfirmationScope } from "../engine/confirmation";
import type { FlowRun } from "../engine/flow-run";
import type { AgentFlow } from "../format/flow-format";
import { activeExits } from "../engine/flow-graph";

/** Server-only: условие проверяется независимо от выхода и сохраняется только после положительного judge. */
export interface FlowConfirmationSpec extends FlowConfirmationRef {
  flowId: string;
  states: readonly string[];
  judge: string;
}

/** Серверный guard одного judge-выхода. Свежий интерес не превращается в durable флаг. */
export interface FlowExitGuard {
  flowId: string;
  state: string;
  exitId: string;
  requires: FlowConfirmationRef;
  judgeWindow: "current-human-turn";
}

export const confirmationHash = (spec: FlowConfirmationSpec): string => createHash("sha256").update(spec.judge).digest("hex");

export function confirmationHolds(record: FlowConfirmationRecord | undefined, spec: FlowConfirmationSpec, scope: FlowConfirmationScope): boolean {
  return record?.status === "confirmed" && record.key === spec.key && record.revision === spec.revision &&
    record.criterionHash === confirmationHash(spec) && record.scope?.ownerId === scope.ownerId &&
    record.scope.chatId === scope.chatId && record.scope.flowId === scope.flowId && scope.flowId === spec.flowId &&
    record.source?.kind === "judge" && typeof record.source.versionId === "string" && record.source.versionId.length > 0 &&
    typeof record.source.answerId === "string" && record.source.answerId.length > 0 &&
    typeof record.source.humanMessageId === "string" && record.source.humanMessageId.length > 0 &&
    Number.isFinite(record.source.probability) && record.source.probability >= 0 && record.source.probability <= 1;
}

/** Настройка фиксируется на сервере. Отсутствующая/устаревшая revision означает unknown. */
export function createConfirmations(specs: readonly FlowConfirmationSpec[] = [], guards: readonly FlowExitGuard[] = []) {
  const registered = structuredClone(specs);
  const registeredGuards = structuredClone(guards);
  const short = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= 100;
  const seen = new Set<string>();
  for (const spec of registered) {
    const id = `${spec.flowId}\0${spec.key}`;
    if (![spec.flowId, spec.key, spec.revision].every(short) || !spec.judge?.trim() || spec.judge.length > 800 || !Array.isArray(spec.states) || !spec.states.length || !spec.states.every(short) || seen.has(id)) throw new TypeError("confirmations: нужны уникальные flowId/key, revision, states и judge до 800 знаков");
    seen.add(id);
  }
  const seenGuards = new Set<string>();
  for (const guard of registeredGuards) {
    const id = `${guard.flowId}\0${guard.state}\0${guard.exitId}`;
    if (![guard.flowId, guard.state, guard.exitId].every(short) || guard.judgeWindow !== "current-human-turn" || seenGuards.has(id) || !registered.some((spec) => spec.flowId === guard.flowId && spec.key === guard.requires.key && spec.revision === guard.requires.revision)) throw new TypeError("exitGuards: один guard на выход, зарегистрированный requires и current-human-turn");
    seenGuards.add(id);
  }
  const specFor = (flowId: string, ref: FlowConfirmationRef) => registered.find((spec) => spec.flowId === flowId && spec.key === ref.key && spec.revision === ref.revision);
  const guardFor = (flowId: string, state: string, exitId: string) => registeredGuards.find((guard) => guard.flowId === flowId && guard.state === state && guard.exitId === exitId);
  return {
    validate(flowId: string, flow: AgentFlow): void {
      for (const guard of registeredGuards.filter((item) => item.flowId === flowId)) {
        const state = flow.states.find((item) => item.id === guard.state);
        const exit = state && activeExits(flow, state).find((item) => item.exit.id === guard.exitId)?.exit;
        if (exit && exit.when.type !== "judge") throw new TypeError(`exitGuards: ${flowId}/${guard.state}/${guard.exitId} должен быть judge-выходом`);
      }
    },
    forState: (flowId: string, state: string) => registered.filter((spec) => spec.flowId === flowId && spec.states.includes(state)),
    specFor,
    guardFor,
    revision: (flowId: string) => createHash("sha256").update(JSON.stringify([registered.filter((spec) => spec.flowId === flowId), registeredGuards.filter((guard) => guard.flowId === flowId)])).digest("hex"),
    allows(scope: FlowConfirmationScope, run: FlowRun, exitId: string): boolean {
      const guard = guardFor(scope.flowId, run.state, exitId);
      if (!guard) return true;
      const spec = specFor(scope.flowId, guard.requires)!;
      const decision = run.checkedTransition;
      return confirmationHolds(run.confirmations?.[spec.key], spec, scope) && decision?.transition.exitId === exitId &&
        decision.answerId === run.answerId && decision.requires.key === spec.key && decision.requires.revision === spec.revision && decision.criterionHash === confirmationHash(spec);
    },
  };
}

export type FlowConfirmations = ReturnType<typeof createConfirmations>;

export interface FlowRevokeConfirmationInput extends FlowConfirmationRef, FlowConfirmationScope {
  expectedAtMessageId: string | null;
  idempotencyKey: string;
  reason: string;
}

export type FlowRevokeConfirmationResult =
  | { status: "applied" | "same"; atMessageId: string }
  | { status: "stale" | "busy" | "not_found" };
