import { flowStateCommitter, type TurnResult } from "@ykurilov/agent-chat-core";
import type { FlowRun, Transition } from "../engine/flow-run";
import { nextTransition } from "../engine/next-transition";
import { confirmationHash, confirmationHolds, type FlowConfirmations } from "./confirmations";
import type { FlowJudge, FlowPort, JudgeMessage } from "./flow-types";
import type { PinnedFlow } from "./flow-events";

type HistoryMessage = Awaited<ReturnType<FlowPort["peekHistory"]>>["messages"][number];
const textOf = (message: HistoryMessage): string => message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
const messagesOf = (messages: readonly HistoryMessage[]): JudgeMessage[] => messages.flatMap((message) => {
  const text = textOf(message).trim();
  return text && (message.role === "user" || message.role === "assistant") ? [{ role: message.role === "user" ? "human" as const : "agent" as const, text }] : [];
});

/** Положительный check и guarded decision — одна служебная запись до исполнения перехода. */
export async function judgeConfirmations(input: {
  confirmations: FlowConfirmations; pinned: PinnedFlow; run: FlowRun; result: TurnResult;
  port: FlowPort; atMessageId: string | null; judge: FlowJudge; threshold: number; now: number;
  conditions: Array<{ exitId: string; text: string }>; messages: JudgeMessage[]; goal?: string;
}): Promise<{ transition?: Transition; saved: boolean }> {
  const { confirmations, pinned, run, result, port } = input;
  const configurationHash = confirmations.revision(pinned.flowId);
  if (run.confirmationCheck?.answerId === result.messageId && run.confirmationCheck.configurationHash === configurationHash) return { saved: true };
  const scope = { ownerId: result.ownerId, chatId: result.chatId, flowId: pinned.flowId };
  const commit = flowStateCommitter(port);
  if (!commit) throw new Error("confirmations: служба чата не предоставляет внутреннюю flows capability");
  const all = (await port.peekHistory(scope.ownerId, scope.chatId)).messages;
  const answerIndex = all.findIndex((message) => message.id === result.messageId);
  if (answerIndex < 0) return { saved: false };
  const branch = all.slice(0, answerIndex + 1);
  const humanIndex = branch.findLastIndex((message) => message.role === "user" && Boolean(textOf(message).trim()));
  if (humanIndex < 0) return { saved: false };
  const humanMessageId = branch[humanIndex]!.id;
  const records = { ...run.confirmations };
  const onBranch = (record: typeof records[string] | undefined) => record?.status === "confirmed" && branch.some((message) => message.id === record.source.answerId) && branch.some((message) => message.id === record.source.humanMessageId);
  const query = async (conditions: Array<{ exitId: string; text: string }>, messages: JudgeMessage[]) => input.judge.checkAll({
    ...scope, conditions, messages, ...(input.goal && { goal: input.goal }), ...(run.timeOffset !== undefined && { testChat: true }),
  });
  for (const spec of confirmations.forState(scope.flowId, run.state)) {
    const old = records[spec.key];
    if (confirmationHolds(old, spec, scope) && onBranch(old)) continue;
    // Revision меняется с immutable версией графа. В пределах одной версии нельзя угадать, какой из двух
    // серверных конфигов новее: fail closed, не перезаписываем уже записанную revision чужой конфигурацией.
    const recordedVersion = old?.status === "confirmed" ? old.source?.versionId : old?.versionId;
    if (recordedVersion === pinned.versionId && (old!.revision !== spec.revision || old!.criterionHash !== confirmationHash(spec))) continue;
    let evidence = input.messages;
    if (old?.status === "revoked" && old.scope.ownerId === scope.ownerId && old.scope.chatId === scope.chatId && old.scope.flowId === scope.flowId) {
      const boundary = old.afterMessageId === null ? -1 : branch.findIndex((message) => message.id === old.afterMessageId);
      if ((old.afterMessageId !== null && boundary < 0) || humanIndex <= boundary) continue;
      evidence = messagesOf(branch.slice(boundary + 1)).slice(-6);
    }
    const id = `confirmation:${spec.key}`;
    const verdict = (await query([{ exitId: id, text: spec.judge }], evidence)).find((item) => item.exitId === id && item.confirmed && item.probability >= input.threshold);
    if (!verdict) continue;
    records[spec.key] = { key: spec.key, revision: spec.revision, status: "confirmed", scope, criterionHash: confirmationHash(spec), checkedAt: input.now,
      source: { kind: "judge", versionId: pinned.versionId, answerId: result.messageId, humanMessageId, probability: verdict.probability } };
  }
  const next: FlowRun = { ...run, confirmationCheck: { answerId: result.messageId, configurationHash }, ...(Object.keys(records).length && { confirmations: records }) };
  const ordinary = input.conditions.filter((condition) => !confirmations.guardFor(scope.flowId, run.state, condition.exitId));
  const guarded = input.conditions.filter((condition) => {
    const guard = confirmations.guardFor(scope.flowId, run.state, condition.exitId);
    if (!guard) return false;
    const spec = confirmations.specFor(scope.flowId, guard.requires)!;
    const receipt = records[spec.key];
    return confirmationHolds(receipt, spec, scope) && onBranch(receipt);
  });
  // Guard видит только актуальный human message id и ответ на него. Старые вопросы не накапливаются.
  const verdicts = [
    ...(ordinary.length ? await query(ordinary, input.messages) : []),
    ...(guarded.length ? await query(guarded, messagesOf([branch[humanIndex]!, branch[answerIndex]!])) : []),
  ];
  const met = input.conditions.map(({ exitId }) => verdicts.find((verdict) => verdict.exitId === exitId && verdict.confirmed && verdict.probability >= input.threshold)).find(Boolean);
  const transition = met ? nextTransition(pinned.flow, next, { type: "verdict", exitId: met.exitId, probability: met.probability, decidedBy: "judge" }, input.now) : null;
  if (transition) {
    const guard = confirmations.guardFor(scope.flowId, run.state, transition.exitId);
    if (guard) next.checkedTransition = { versionId: pinned.versionId, transition, requires: guard.requires, criterionHash: confirmationHash(confirmations.specFor(scope.flowId, guard.requires)!), answerId: result.messageId, humanMessageId };
  }
  const changed = JSON.stringify(next) !== JSON.stringify(run);
  if (!changed) return { ...(transition && { transition }), saved: true };
  for (const wait of [0, 10, 50, 100, 250, 500, 1000]) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const saved = await commit({ ...scope, revision: confirmations.revision(scope.flowId), expectedAtMessageId: input.atMessageId, idempotencyKey: `judge:${result.messageId}`, flow: next as unknown as Record<string, unknown> });
    if (saved.status === "applied" || saved.status === "same") return { ...(transition && { transition }), saved: true };
    if (saved.status !== "busy") return { saved: false };
  }
  return { saved: false };
}
