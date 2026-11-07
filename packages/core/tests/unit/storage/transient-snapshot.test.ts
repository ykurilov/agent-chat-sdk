import { describe, expect, it, vi } from "vitest";
import { createTransientChatStorage } from "../../../src/storage/in-memory-storage";
import { CURRENT_FORMAT_VERSION, type StoredMessage } from "../../../src/conversation/types";
import { createAnswerSaver } from "../../../src/agent-run/answer-saver";
import type { ChatStorage } from "../../../src/storage/chat-storage";

const at = "2026-01-01T00:00:00.000Z";
const row = (id: string, parentId: string | null, role: "user" | "assistant"): StoredMessage => ({ id, parentId, role, chatId: "chat", parts: [{ type: "text", text: id }], formatVersion: CURRENT_FORMAT_VERSION, status: "complete", modelId: null, providerId: null, usage: null, reasoningDurationsMs: {}, error: null, createdAt: at });
describe("transient history snapshot", () => {
  it("round-trips history, branches, compaction and choices without aliasing", async () => {
    const store = createTransientChatStorage();
    await store.createChat({ id: "chat", ownerId: "owner", modelId: "model", providerId: "provider", createdAt: at });
    await store.insertMessage(row("person", null, "user"));
    await store.insertMessage(row("first", "person", "assistant"));
    await store.insertMessage(row("second", "person", "assistant"));
    await store.insertBranchSelection({ id: "selection", chatId: "chat", messageId: "first", selectedAt: at });
    await store.insertCompaction({ id: "compaction", chatId: "chat", fromMessageId: "person", throughMessageId: "first", summary: "Summary", summaryTokens: 1, modelId: "model", providerId: "provider", usage: null, createdAt: at });
    await store.saveUserModelChoice!("owner", { modelId: "chosen", providerId: "provider" });
    const snapshot = JSON.parse(JSON.stringify(store.exportSnapshot()));
    const restored = createTransientChatStorage(snapshot);
    expect(restored.exportSnapshot()).toEqual(snapshot);
    snapshot.messages[0].parts[0].text = "tampered";
    expect((await restored.getMessage("person"))?.parts[0]).toMatchObject({ text: "person" });
    const exported = restored.exportSnapshot(); exported.chats[0]!.modelId = "changed";
    expect((await restored.getChat("chat"))?.modelId).toBe("model");
  });
  it("does not restore live leases or long-term memory", async () => {
    const store = createTransientChatStorage();
    await store.createChat({ id: "chat", ownerId: "owner", modelId: "model", providerId: "provider", createdAt: at });
    await store.claimChatTurn!("chat", "old-holder", 60_000);
    await store.insertMemoryNotes!("owner", [{ content: "private memory", categories: [] }]);
    const restored = createTransientChatStorage(store.exportSnapshot());
    expect(await restored.claimChatTurn!("chat", "new-holder", 60_000)).toBe(true);
    expect(await restored.listMemoryNotes!("owner")).toEqual([]);
  });
  it("checkpoint persists the visible prefix and keeps subsequent writes alive", async () => {
    const writes: unknown[] = [];
    const storage = { updateStreamingMessage: vi.fn(async (_id: string, patch: { parts: StoredMessage["parts"] }) => { writes.push(structuredClone(patch.parts)); }), markAnswerAlive: vi.fn(async () => {}) } as unknown as ChatStorage;
    const saver = createAnswerSaver(storage, "answer", () => ({}), () => null, () => {});
    saver.observe({ type: "start", messageId: "answer" }); saver.observe({ type: "text-start", id: "text" });
    saver.observe({ type: "text-delta", id: "text", delta: "first" }); await saver.checkpoint();
    expect(writes.at(-1)).toEqual([{ type: "text", text: "first", state: "streaming" }]);
    saver.observe({ type: "text-delta", id: "text", delta: " second" }); await saver.checkpoint();
    expect(writes.at(-1)).toEqual([{ type: "text", text: "first second", state: "streaming" }]);
    await saver.finish();
  });
});
