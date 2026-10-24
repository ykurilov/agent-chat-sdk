import type { FlowStore } from "../store/flow-store";
import type { AgentFlowHandle, FlowPort } from "./flow-types";
import { storedRun } from "./flow-events";
import { confirmationHolds, type FlowConfirmations } from "./confirmations";
import { testChatOffset } from "./test-clock";

/** Strict preview читает исходный run до map. Legacy path/card не являются квитанцией SDK. */
export async function previewConfirmedMigration(
  input: Parameters<AgentFlowHandle["previewMigration"]>[0],
  deps: { store: FlowStore; confirmations: FlowConfirmations; portFor: (chat: { ownerId: string; chatId: string }) => Promise<FlowPort> },
): ReturnType<AgentFlowHandle["previewMigration"]> {
  const { store, confirmations } = deps;
  const spec = confirmations.specFor(input.flowId, input.requiresConfirmation);
  if (!spec) throw new TypeError("previewMigration: requiresConfirmation не зарегистрирован сервером");
  const eligible: string[] = [];
  const keepOriginal: Awaited<ReturnType<AgentFlowHandle["previewMigration"]>>["keepOriginal"] = [];
  const rows = await store.listFlowChats({ flowId: input.flowId, exceptVersionId: input.toVersionId, ...(input.chatIds && { chatIds: input.chatIds }) });
  for (const row of rows) {
    if (row.endedAt && !input.includeEnded) continue;
    const port = await deps.portFor(row);
    const data = await port.getChatData(row.ownerId, row.chatId);
    const test = testChatOffset(data) !== null;
    if (test && !input.includeTestChats) continue;
    if (input.filter && !await input.filter({ chatId: row.chatId, ownerId: row.ownerId, flowId: row.flowId, versionId: row.versionId, stateId: row.stateId, ended: row.endedAt !== null, endReason: row.endReason, test, data })) continue;
    const snapshot = await port.getChatState(row.ownerId, row.chatId);
    const run = storedRun(snapshot.values.flow);
    const receipt = run?.confirmations?.[spec.key];
    const scope = { ownerId: row.ownerId, chatId: row.chatId, flowId: row.flowId };
    let reason: string | undefined;
    if (!receipt) reason = "missing_receipt";
    else if (receipt.status === "revoked") reason = "revoked_receipt";
    else if (!confirmationHolds(receipt, spec, scope)) reason = "incompatible_receipt";
    else if (!await store.getVersion(row.flowId, receipt.source.versionId)) reason = "source_version_missing";
    else {
      const branch = (await port.peekHistory(row.ownerId, row.chatId)).messages;
      if (!branch.some((message) => message.id === receipt.source.answerId) || !branch.some((message) => message.id === receipt.source.humanMessageId)) reason = "source_not_on_branch";
    }
    if (reason) keepOriginal.push({ chatId: row.chatId, status: "ambiguous", reason });
    else eligible.push(row.chatId);
  }
  return { eligible, keepOriginal };
}
