import { newStoredMessage } from "../../core/src/conversation/types";
import { Hono } from "hono";
import { answerEditOf } from "@ykurilov/agent-chat-core";
import type { AnswerEditedInput } from "@ykurilov/agent-chat-core";
import { describe, expect, it, vi } from "vitest";
import { createNextRouteHandlers } from "../src/next";
import { mountChat } from "../src/hono";
import { createTestChat } from "./support/test-chat";

async function fixture(adapter: "next" | "hono", options: Parameters<typeof createTestChat>[0] = {}) {
  const chat = createTestChat({ answerEditing: true, ...options });
  const chatId = await chat.createChat();
  await chat.storage.insertMessage(newStoredMessage({ id: "u1", chatId, role: "user", parts: [{ type: "text", text: "Вопрос" }] }));
  await chat.storage.insertMessage(newStoredMessage({ id: "a1", chatId, parentId: "u1", role: "assistant", parts: [{ type: "reasoning", text: "секрет" }, { type: "text", text: "Было" }] }));
  const next = createNextRouteHandlers(chat.handler);
  const hono = new Hono(); mountChat(hono, chat.handler);
  async function post(body: unknown, user = "anna", path = `/${chatId}/messages/a1/answer-edit`, headers = {}) {
    const request = new Request(`http://test.local/api/chat${path}`, { method: "POST", headers: { "x-user": user, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return adapter === "next" ? next.POST(request) : hono.fetch(request);
  }
  return { ...chat, chatId, post };
}

for (const adapter of ["next", "hono"] as const) describe(`ordinary answer edit: ${adapter}`, () => {
  it("stores lineage and app data, emits a hook even without app-state changes; public/model history omits annotation", async () => {
    const calls: AnswerEditedInput[] = [];
    const f = await fixture(adapter, { onAnswerEdited: event => { calls.push(event); } });
    const events: unknown[] = []; f.service.subscribeEvents(event => { events.push(event); });
    const response = await f.post({ text: "Стало", data: { why: "точнее", score: 2 } });
    expect(response.status).toBe(200);
    const { messageId } = await response.json() as { messageId: string };
    await f.service.flush();
    expect(calls).toEqual([expect.objectContaining({ ownerId: "anna", chatId: f.chatId, sourceMessageId: "a1", messageId, sourceText: "Было", text: "Стало", data: { why: "точнее", score: 2 } })]);
    const raw = await f.storage.getMessage(messageId);
    expect(answerEditOf(raw!.parts)).toMatchObject({ sourceMessageId: "a1", ownerId: "anna", data: { why: "точнее", score: 2 } });
    expect((await f.storage.getMessage("a1"))!.parts).toContainEqual({ type: "text", text: "Было" });
    const history = await f.service.getHistory("anna", f.chatId);
    expect(history.messages.at(-1)).toMatchObject({ id: messageId, metadata: { answerEdit: { sourceMessageId: "a1" } } });
    expect(JSON.stringify(history.messages)).not.toContain("точнее");
    expect(history.messages.at(-1)!.parts).toEqual([{ type: "text", text: "Стало", state: "done" }]);
    expect(events).toContainEqual(expect.objectContaining({ type: "answer-edited", sourceMessageId: "a1", messageId }));
  });
  it("is opt-in; enforces ownership and capability", async () => {
    const off = await fixture(adapter, { answerEditing: false });
    expect((await off.post({ text: "Стало" })).status).toBe(404);
    const f = await fixture(adapter);
    expect((await f.post({ text: "Стало" }, "stranger")).status).toBe(404);
    const denied = await fixture(adapter, { chatCapabilities: () => ({ answerEditing: false }) });
    expect((await denied.post({ text: "Стало" })).status).toBe(403);
    expect((await f.post({ text: "Стало" }, "")).status).toBe(401);
  });
  it("rejects invalid text/data and ordinary tool edits without a write or hook", async () => {
    const hook = vi.fn(); const f = await fixture(adapter, { onAnswerEdited: hook });
    for (const body of [{ text: "" }, { text: "Было" }, { text: "x", data: "bad" }, { text: "x", data: [] }, { text: "x", data: { why: "я".repeat(9000) } }, { text: "x".repeat(100001) }, { text: "x", toolOutputs: { t: "bad" } }]) {
      expect((await f.post(body)).status).toBe(400);
    }
    expect((await f.storage.listMessages(f.chatId)).map(m => m.id)).toEqual(["u1", "a1"]);
    expect(hook).not.toHaveBeenCalled();
  });
  it("a repeated save of the old answer cannot create a second edit", async () => {
    const hook = vi.fn(); const f = await fixture(adapter, { onAnswerEdited: hook });
    expect((await f.post({ text: "Стало" })).status).toBe(200);
    expect((await f.post({ text: "Снова" })).status).toBe(409);
    await f.service.flush(); expect(hook).toHaveBeenCalledTimes(1);
  });
});

it("onAnswerEdited retries with stable id/data; flush waits; a journal failure does not undo a saved edit", async () => {
  const hook = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const f = await fixture("next", { onAnswerEdited: hook });
  expect((await f.post({ text: "Стало", data: { why: "яснее" } })).status).toBe(200);
  await f.service.flush();
  expect(hook).toHaveBeenCalledTimes(2);
  expect(hook.mock.calls[0]![0]).toEqual(hook.mock.calls[1]![0]);
});
it("ordinary editor obeys origin checks and refuses an unfinished answer", async () => {
  const hook = vi.fn(); const f = await fixture("next", { onAnswerEdited: hook });
  expect((await f.post({ text: "new" }, "anna", undefined, { origin: "https://foreign.invalid" })).status).toBe(403);
  await f.storage.insertMessage(newStoredMessage({ id: "unfinished", chatId: f.chatId, parentId: "a1", role: "assistant", status: "streaming", parts: [{ type: "text", text: "partial" }] }));
  const response = await f.post({ text: "new" }, "anna", `/${f.chatId}/messages/unfinished/answer-edit`);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { kind: "answer_edit", reason: "answer_busy" } });
  expect(hook).not.toHaveBeenCalled();
});
