import { describe, expect, it } from "vitest";
import {
  ALWAYS_IN_CHAT,
  alwaysAllowedTools,
  denyPendingApprovals,
  pendingApprovals,
  recordDecision,
} from "../../../src/tool-approval/approval-parts";
import type { AgentChatMessage } from "../../../src/conversation/types";

const requested = (name: string, id: string): AgentChatMessage["parts"][number] =>
  ({ type: `tool-${name}`, toolCallId: `call-${id}`, state: "approval-requested", input: { path: "a" }, approval: { id } }) as never;

describe("части подтверждения", () => {
  it("находит ожидающие запросы", () => {
    const parts = [{ type: "text", text: "привет" }, requested("remove", "ap1"), requested("wipe", "ap2")] as AgentChatMessage["parts"];
    expect(pendingApprovals(parts)).toEqual([
      { approvalId: "ap1", toolName: "remove" },
      { approvalId: "ap2", toolName: "wipe" },
    ]);
  });

  it("отмечает решение у нужной части и не трогает остальные", () => {
    const parts = [requested("remove", "ap1"), requested("wipe", "ap2")];
    const changed = recordDecision(parts, "ap2", { approved: true, reason: ALWAYS_IN_CHAT })!;
    expect(changed[0]).toEqual(parts[0]);
    expect(changed[1]).toMatchObject({ state: "approval-responded", approval: { id: "ap2", approved: true, reason: ALWAYS_IN_CHAT } });
    expect(parts[1]).toMatchObject({ state: "approval-requested" });
  });

  it("неизвестный или уже решённый запрос — null", () => {
    const parts = [requested("remove", "ap1")];
    expect(recordDecision(parts, "нет", { approved: true })).toBeNull();
    const decided = recordDecision(parts, "ap1", { approved: false })!;
    expect(recordDecision(decided, "ap1", { approved: true })).toBeNull();
  });

  it("закрывает все ожидающие как отклонённые", () => {
    const parts = [{ type: "text", text: "т" }, requested("remove", "ap1")] as AgentChatMessage["parts"];
    const closed = denyPendingApprovals(parts, "не ответил");
    expect(closed[0]).toEqual(parts[0]);
    expect(closed[1]).toMatchObject({ state: "output-denied", approval: { id: "ap1", approved: false, reason: "не ответил" } });
  });

  it("уже решённый, но не выполненный запрос тоже закрывается отказом; своя причина отказа сохраняется", () => {
    const allowed = { ...requested("remove", "ap1"), state: "approval-responded", approval: { id: "ap1", approved: true } };
    const denied = { ...requested("wipe", "ap2"), state: "approval-responded", approval: { id: "ap2", approved: false, reason: "нет" } };
    const closed = denyPendingApprovals([allowed, denied] as never, "не ответил");
    expect(closed[0]).toMatchObject({ state: "output-denied", approval: { approved: false, reason: "не ответил" } });
    expect(closed[1]).toMatchObject({ state: "output-denied", approval: { approved: false, reason: "нет" } });
  });

  it("«всегда» собирается из истории: только у частей с меткой", () => {
    const always = { type: "tool-remove", toolCallId: "c", state: "output-available", input: {}, output: 1, approval: { id: "x", approved: true, reason: ALWAYS_IN_CHAT } };
    const once = { type: "tool-wipe", toolCallId: "d", state: "output-available", input: {}, output: 1, approval: { id: "y", approved: true } };
    const messages = [{ parts: [always, once] }] as never;
    expect([...alwaysAllowedTools(messages)]).toEqual(["remove"]);
  });
});
