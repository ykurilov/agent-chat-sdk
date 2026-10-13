import { describe, expect, it } from "vitest";
import type { AgentChatMessage } from "@ykurilov/agent-chat-react";
import { journalRows, journalTurns, messageToolDetailsView, modelCallDetailsView, previousModelCall } from "../../src/react/journal-view";
import { russianSandboxLabels } from "../../src/react/sandbox-labels";
import type { JournalCallResponse, JournalListResponse } from "../../src/types";

type Entry = JournalListResponse["entries"][number];

const model = (id: string, messageId: string | null, purpose: "answer" | "title" = "answer"): Entry => ({
  kind: "model", id, chatId: "c1", ownerId: "sandbox:u", messageId, purpose, attempt: 1, modelId: "m", providerId: "p",
  usage: null, costUsd: null, startedAt: "2026-10-03T10:00:00.000Z", firstChunkMs: null, durationMs: 10, status: "complete", error: null, instructionsChanged: false,
});
const tool = (id: string, messageId: string, toolCallId: string): Entry => ({
  kind: "tool", id, chatId: "c1", ownerId: "sandbox:u", messageId, modelCallId: null, toolCallId, toolName: "search",
  inputHash: "i", outputHash: "o", error: null, startedAt: "2026-10-03T10:00:01.000Z", durationMs: 5,
});
const answer = (id: string, parts: unknown[]): AgentChatMessage => ({ id, role: "assistant", parts, metadata: { status: "complete" } }) as unknown as AgentChatMessage;
const messages = [
  { id: "u1", role: "user", parts: [] } as unknown as AgentChatMessage,
  answer("a1", [
    { type: "tool-search", toolCallId: "s1", state: "output-available", input: {}, output: {} },
    { type: "tool-ask_choice", toolCallId: "w1", state: "output-available", input: { q: 1 }, output: { pick: "да" } },
  ]),
  answer("a2", [{ type: "tool-search", toolCallId: "s2", state: "output-available", input: {}, output: {} }]),
];

describe("журнал: ходы и строки", () => {
  it("ходы — весь чат и каждый ответ ветки", () => {
    expect(journalTurns(messages, russianSandboxLabels)).toEqual([
      { id: null, label: "Весь чат" },
      { id: "a1", label: "Ответ 1" },
      { id: "a2", label: "Ответ 2" },
    ]);
  });

  it("строки хода: обращение, вызов из журнала, вызов из сообщения после записей своего ответа", () => {
    const entries = [model("m1", "a1"), tool("t1", "a1", "s1"), model("m2", "a1"), model("t", null, "title"), model("m3", "a2")];
    const whole = journalRows(entries, messages, new Map([["a2", { textEdited: false, editedToolCallIds: ["s2"] }]]), null);
    expect(whole.map((row) => row.id)).toEqual(["m1", "t1", "m2", "message:w1", "t", "m3", "message:s2"]);
    expect(whole.at(-1)).toMatchObject({ kind: "message-tool", outputEdited: true });
    expect(journalRows(entries, messages, new Map(), "a1").map((row) => row.id)).toEqual(["m1", "t1", "m2", "message:w1"]);
  });

  it("прошлое обращение — того же назначения", () => {
    const entries = [model("m1", "a1"), model("t", null, "title"), model("m2", "a1")];
    expect(previousModelCall(entries, "m2")?.id).toBe("m1");
    expect(previousModelCall(entries, "m1")).toBeNull();
  });
});

describe("журнал: подробности", () => {
  const blob = (hash: string, content: unknown) => ({ hash, content, bytes: 1, truncated: false });
  const details = {
    kind: "model",
    call: { ...(model("m2", "a1") as object), error: null },
    instructions: blob("ins", "Будь краток"),
    messages: [blob("h1", { role: "user", content: "Привет" }), blob("h2", { role: "assistant", content: [{ type: "text", text: "Ок" }] })],
    tools: blob("tools", [{ name: "search", inputSchema: { type: "object" } }]),
    settings: blob("set", { temperature: 0 }),
    response: blob("resp", { text: "Ответ", reasoning: "", toolCalls: [{ toolCallId: "s1", toolName: "search", input: { q: 1 } }], finishReason: "stop" }),
  } as unknown as Extract<JournalCallResponse, { kind: "model" }>;

  it("новые сообщения относительно прошлого обращения", () => {
    const view = modelCallDetailsView(details, new Set(["h1"]));
    expect(view.instructions).toBe("Будь краток");
    expect(view.messages.map((message) => [message.role, message.isNew])).toEqual([["user", false], ["assistant", true]]);
    expect(view.messages[0]?.content).toBe("Привет");
    expect(view.tools).toEqual([{ name: "search", inputSchema: JSON.stringify({ type: "object" }, null, 2) }]);
    expect(view.response).toMatchObject({ text: "Ответ", finishReason: "stop", toolCalls: [{ toolCallId: "s1", toolName: "search", input: JSON.stringify({ q: 1 }, null, 2) }] });
    expect(modelCallDetailsView(details, null).messages.every((message) => message.isNew)).toBe(true);
  });

  it("вызов из сообщения: вход и ответ человека", () => {
    expect(messageToolDetailsView({ toolCallId: "w1", toolName: "ask_choice", state: "output-available", input: { q: 1 }, output: "да" })).toEqual({
      state: "ready", input: JSON.stringify({ q: 1 }, null, 2), output: "да", error: null, truncated: false,
    });
  });
});
