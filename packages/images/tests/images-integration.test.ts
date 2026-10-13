import { MockLanguageModelV4 } from "ai/test";
import { createAttachments, createMemoryAttachmentStorage } from "@ykurilov/agent-chat-attachments";
import { createChatService, createInMemoryChatStorage, CURRENT_FORMAT_VERSION, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { ChatStorage, StoredMessage, UsageRecord } from "@ykurilov/agent-chat-core";
import { describe, expect, it, vi } from "vitest";
import { createImageGeneration } from "../src/index";
import { pngBytes } from "./support/image-bytes";
import { executeOptions, fakeRunware, KEY } from "./support/fake-runware";

const NOW = new Date("2026-10-03T10:00:00.000Z");
type Part = StoredMessage["parts"][number];

/** Сервер в сборе: вложения, картинки и хранилище чатов с записью расхода. */
function server() {
  const runware = fakeRunware();
  const attachments = createAttachments({ storage: createMemoryAttachmentStorage(), now: () => NOW });
  const chats = createInMemoryChatStorage();
  const usage: UsageRecord[] = [];
  const recording: ChatStorage = {
    ...chats,
    insertUsageRecord: async (record) => {
      usage.push(record);
      await chats.insertUsageRecord(record);
    },
  };
  const images = createImageGeneration({ attachments, env: { RUNWARE_API_KEY: KEY }, fetch: runware.fetch, spending: { storage: recording }, now: () => NOW });
  return { runware, attachments, chats: recording, usage, images };
}

async function generateIn(images: ReturnType<typeof server>["images"], ownerId: string, chatId: string, count: number) {
  const tools = images.tools({ ownerId, chatId });
  return (await tools.generate_images!.execute!({ prompt: "Маяк", count, aspectRatio: "1:1" } as never, executeOptions())) as {
    картинки: Array<{ id: string }>;
  };
}

const get = (attachments: ReturnType<typeof server>["attachments"], userId: string, chatId: string, id: string) =>
  attachments.handle({ request: new Request(`https://chat.test/api/chat/${chatId}/attachments/${id}`), userId, chatId, segments: [id] });

describe("картинки в чате: хранение и доступ (T045, FR-038, FR-039)", () => {
  it("картинка отдаётся адресом вложений владельцу; чужой и несуществующий id — одинаковый 404", async () => {
    const { attachments, images } = server();
    const { картинки } = await generateIn(images, "anna", "chat-1", 1);
    const id = картинки[0]!.id;

    const own = await get(attachments, "anna", "chat-1", id);
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toMatch(/^image\/png/);
    expect(new Uint8Array(await own.arrayBuffer())).toEqual(pngBytes());

    const stranger = await get(attachments, "boris", "chat-1", id);
    const otherChat = await get(attachments, "anna", "chat-2", id);
    const missing = await get(attachments, "anna", "chat-1", crypto.randomUUID());
    for (const response of [stranger, otherChat, missing]) expect(response.status).toBe(404);
    const bodies = await Promise.all([stranger, otherChat, missing].map((response) => response.text()));
    expect(new Set(bodies).size).toBe(1);
  });

  it("удаление чата удаляет его картинки, картинки другого чата остаются", async () => {
    const { attachments, images } = server();
    const first = await generateIn(images, "anna", "chat-1", 2);
    const other = await generateIn(images, "anna", "chat-2", 1);

    await attachments.removeChatFiles!("chat-1");

    for (const { id } of first.картинки) {
      expect(await attachments.storage.get(id)).toBeUndefined();
      expect((await get(attachments, "anna", "chat-1", id)).status).toBe(404);
    }
    expect((await get(attachments, "anna", "chat-2", other.картинки[0]!.id)).status).toBe(200);
  });
});

describe("«Повторить» прерванного ответа с картинками (T045, 022)", () => {
  const MODEL_ID = "mock-model";

  /** Модель-заглушка: отвечает текстом «Готово» и запоминает запросы. */
  function catalogWith(model: MockLanguageModelV4) {
    return extendCatalog(standardCatalog, {
      addProviders: [{ id: "mock", displayName: "mock", apiKeyEnv: "MOCK_API_KEY", createLanguageModel: () => model, requestOptions: () => ({}) }],
      addModels: [{ id: MODEL_ID, displayName: "Mock", contextWindowTokens: 1000, acceptsImages: false, reasoning: { replayPastTurns: true }, providerModelIds: { mock: "mock-v1" } }],
    });
  }

  const sayDone = () =>
    new ReadableStream({
      start(controller) {
        for (const part of [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Готово" },
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } },
        ])
          controller.enqueue(part);
        controller.close();
      },
    });

  const message = (fields: Pick<StoredMessage, "id" | "role" | "parts"> & Partial<StoredMessage>): StoredMessage => ({
    chatId: "c1",
    parentId: null,
    formatVersion: CURRENT_FORMAT_VERSION,
    status: "complete",
    modelId: null,
    providerId: null,
    usage: null,
    reasoningDurationsMs: {},
    error: null,
    voiceCut: null,
    createdAt: "2026-10-03T09:00:00.000Z",
    ...fields,
  });

  it("готовые картинки переносятся в новый ответ без новой генерации и нового расхода; файлы на месте", async () => {
    const { runware, attachments, chats, usage, images } = server();
    const output = await generateIn(images, "anna", "c1", 2);
    const providerCalls = runware.fetch.mock.calls.length;
    const imageUsage = () => usage.filter((record) => record.source === "images");
    expect(imageUsage()).toHaveLength(2);

    const call = { type: "tool-generate_images", toolCallId: "g1", state: "output-available", input: { prompt: "Маяк", count: 2, aspectRatio: "1:1" }, output } as Part;
    await chats.createChat({ id: "c1", ownerId: "anna", modelId: MODEL_ID, providerId: "mock" });
    await chats.insertMessage(message({ id: "u1", role: "user", parts: [{ type: "text", text: "Нарисуй маяк" }] }));
    await chats.insertMessage(
      message({
        id: "a1",
        parentId: "u1",
        role: "assistant",
        status: "interrupted",
        modelId: MODEL_ID,
        providerId: "mock",
        parts: [{ type: "step-start" }, call, { type: "step-start" }, { type: "text", text: "Вот мая", state: "streaming" }],
        createdAt: "2026-10-03T09:00:01.000Z",
      }),
    );

    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: sayDone() as never }) });
    const service = createChatService({
      storage: chats,
      catalog: catalogWith(model),
      defaultChoice: { modelId: MODEL_ID, providerId: "mock" },
      agent: { instructions: "Ты помощник.", tools: (turn) => images.tools(turn) },
      env: { MOCK_API_KEY: "не-настоящий-ключ" },
      logError: vi.fn(),
    });
    const stream = await service.retry("anna", "c1");
    for await (const _chunk of stream) void _chunk;

    const { messages } = await service.getHistory("anna", "c1");
    const answer = messages.at(-1)!;
    expect(answer.id).not.toBe("a1");
    expect(model.doStreamCalls).toHaveLength(1);
    expect(answer.parts.at(-1)).toMatchObject({ type: "text", text: "Готово" });
    expect(answer.parts.find((part) => part.type === "tool-generate_images")).toMatchObject({ toolCallId: "g1", state: "output-available", output });
    expect(runware.fetch.mock.calls.length).toBe(providerCalls);
    expect(imageUsage()).toHaveLength(2);
    // Обе ветки — прежняя и новая — ссылаются на те же файлы: они лежат в чате, а не в сообщении.
    for (const { id } of output.картинки) expect((await get(attachments, "anna", "c1", id)).status).toBe(200);
  });
});
