import { CURRENT_FORMAT_VERSION } from "@ykurilov/agent-chat-core";
import type { ChatStorage, StoredMessage } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createTestChat } from "./support/test-chat";

function stored(id: string, role: StoredMessage["role"], parentId: string | null, minute: number): StoredMessage {
  return {
    id,
    chatId: "",
    parentId,
    role,
    parts: [{ type: "text", text: `текст ${id}` }],
    formatVersion: CURRENT_FORMAT_VERSION,
    status: "complete",
    modelId: role === "assistant" ? "mock-model" : null,
    providerId: role === "assistant" ? "mock" : null,
    usage: null,
    reasoningDurationsMs: {},
    error: null,
    createdAt: `2026-03-01T10:0${minute}:00.000Z`,
  };
}

/** Чат из двух пар сообщений, первая пара сжата в сводку. */
async function compactedChat(storage: ChatStorage, chatId: string): Promise<void> {
  const chain: Array<[string, StoredMessage["role"], string | null]> = [
    ["u1", "user", null],
    ["a1", "assistant", "u1"],
    ["u2", "user", "a1"],
    ["a2", "assistant", "u2"],
  ];
  for (const [index, [id, role, parentId]] of chain.entries()) {
    await storage.insertMessage({ ...stored(id, role, parentId, index), chatId });
  }
  await storage.insertCompaction({
    id: "c1",
    chatId,
    fromMessageId: "u1",
    throughMessageId: "a1",
    summary: "## Цель\nПереезд",
    summaryTokens: 40,
    modelId: "mock-model",
    providerId: "mock",
    usage: null,
    createdAt: "2026-03-01T10:09:00.000Z",
  });
}

const marker = {
  id: "c1",
  fromMessageId: "u1",
  throughMessageId: "a1",
  summary: "## Цель\nПереезд",
  summaryTokens: 40,
  createdAt: "2026-03-01T10:09:00.000Z",
};

describe("обработчик чата: сжатие истории", () => {
  it("GET /:chatId/compactions — записи сжатия и признак «идёт»", async () => {
    const { call, createChat, storage } = createTestChat();
    const chatId = await createChat();
    await compactedChat(storage, chatId);
    const response = await call("GET", `/${chatId}/compactions`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ compactions: [marker], compacting: false });
  });

  it("чат без сжатия — пустой список", async () => {
    const { call, createChat } = createTestChat();
    const chatId = await createChat();
    expect(await (await call("GET", `/${chatId}/compactions`)).json()).toEqual({ compactions: [], compacting: false });
  });

  it("GET /:chatId отдаёт те же записи вместе с сообщениями: оригиналы на месте", async () => {
    const { call, createChat, storage } = createTestChat();
    const chatId = await createChat();
    await compactedChat(storage, chatId);
    const body = (await (await call("GET", `/${chatId}`)).json()) as { messages: unknown[]; compactions: unknown[]; compacting: boolean };
    expect(body.messages).toHaveLength(4);
    expect(body.compactions).toEqual([marker]);
    expect(body.compacting).toBe(false);
  });

  it("чужого или несуществующего чата нет: 404 not_found; «сжать сейчас» по HTTP нет", async () => {
    const { call, createChat } = createTestChat();
    const chatId = await createChat();
    for (const [user, id] of [["boris", chatId], ["anna", "нет-такого"]] as const) {
      const response = await call("GET", `/${id}/compactions`, { user });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { kind: "not_found" } });
    }
    expect((await call("POST", `/${chatId}/compactions`)).status).toBe(404);
  });

  it("настройки сжатия доходят до службы: негодные отвергаются при создании обработчика", () => {
    expect(() => createTestChat({ compaction: { thresholdTokens: 10, tailTokens: 20 } })).toThrow(/хвост/);
    expect(() => createTestChat({ compaction: false })).not.toThrow();
  });
});
