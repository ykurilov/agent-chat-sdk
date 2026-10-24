import { describe, expect, it } from "vitest";
import { confirmationHash, confirmationHolds, createConfirmations, type FlowConfirmationSpec } from "../src/runtime/confirmations";
import type { FlowConfirmationReceipt } from "../src/engine/confirmation";
import { parseFlow, nextTransition, startRun } from "../src/format";
import { fixtureJson } from "./flow-fixtures";

const spec: FlowConfirmationSpec = { flowId: "first-app", key: "ownPublished", revision: "1", states: ["publish"], judge: "Проверена ссылка именно на своё приложение; сомнение или чужая ссылка — нет." };
const scope = { ownerId: "anna", chatId: "c1", flowId: "first-app" };
const receipt: FlowConfirmationReceipt = { ...spec, status: "confirmed", scope, criterionHash: confirmationHash(spec), checkedAt: 1, source: { kind: "judge", versionId: "v1", answerId: "a1", humanMessageId: "u1", probability: 0.9 } };

describe("server confirmation receipt", () => {
  it("сохраняет проверку независимо от шести последних сообщений, но только в исходном scope/revision", () => {
    expect(confirmationHolds(receipt, spec, scope)).toBe(true);
    for (const changed of [{ ownerId: "other" }, { chatId: "other" }, { flowId: "other" }]) expect(confirmationHolds(receipt, spec, { ...scope, ...changed })).toBe(false);
    expect(confirmationHolds(receipt, { ...spec, revision: "2" }, scope)).toBe(false);
    expect(confirmationHolds(receipt, { ...spec, judge: "Другое условие" }, scope)).toBe(false);
    expect(confirmationHolds({ ...receipt, status: "revoked", versionId: "v1", revokedAt: 2, afterMessageId: "u2", reason: "чужая ссылка", operationKey: "r1" }, spec, scope)).toBe(false);
    expect(confirmationHolds(undefined, spec, scope)).toBe(false);
    expect(confirmationHolds({ ...receipt, source: { ...receipt.source, kind: "tool" } } as unknown as FlowConfirmationReceipt, spec, scope)).toBe(false);
  });

  it("независимый day3 timer не получает publication guard", () => {
    const raw = fixtureJson("sales-review");
    raw.schedule = { dayStart: "09:00", nightFrom: "21:00", lengthDays: 5, deadlineState: "soft" };
    raw.states.find((state: { id: string }) => state.id === "intro").exits.push({ id: "day3", when: { type: "timer", from: "program_day", day: 3 }, to: "offer" });
    const parsed = parseFlow(raw); if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const own = { ...spec, flowId: "sales-review", states: ["intro"] };
    const configured = createConfirmations([own], [{ flowId: own.flowId, state: "intro", exitId: "intro_clear", requires: { key: spec.key, revision: spec.revision }, judgeWindow: "current-human-turn" }]);
    const at = Date.UTC(2026, 9, 20, 10);
    const run = startRun(parsed.flow, at);
    expect(run.confirmations).toBeUndefined();
    expect(configured.allows({ ...scope, flowId: own.flowId }, run, "day3")).toBe(true);
    expect(nextTransition(parsed.flow, run, { type: "timer", exitId: "day3", timeZone: "Europe/Moscow" }, at + 2 * 86_400_000)?.to).toBe("offer");
  });
});
