import { expect, it, vi } from "vitest";
import { createChatService } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { MessageAttachments } from "../../src/attachments/message-attachments";
import { mockCatalog, mockEnv, mockModelId, readAll, summarizingModel } from "./support/mock-model";

const ids = [1, 2, 3, 4].map(n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const file = (i: number) => ({ type: "file" as const, url: `attachment:${ids[i]}`, mediaType: "image/png" });

function setup() {
  const storage = createInMemoryChatStorage();
  const attachments: MessageAttachments = {
    imageNumbers: true,
    acceptUserParts: async ({ parts }) => parts.map(p => ({ type: "file", url: p.url, mediaType: "image/png" })),
    confirmUserParts: async () => {}, prepareHistory: async ({ history }) => history.map(m => ({ ...m, parts: m.parts.map(p => p.type === "file" ? { type: "text", text: "картинка" } : p) })),
    importFile: vi.fn(async () => file(0)),
  };
  const model = summarizingModel("Сводка разговора", [500, 1000, 1500, 2000, 2500]);
  const catalog = mockCatalog({ mock: model });
  catalog.models.find(profile => profile.id === mockModelId)!.contextWindowTokens = 1_000_000;
  const build = () => createChatService({ storage, attachments, catalog, defaultChoice: { modelId: mockModelId, providerId: "mock" }, agent: { instructions: "Помощник" }, compaction: { thresholdTokens: 1_000_000, tailTokens: 100, summaryCeilingTokens: 100 }, env: mockEnv });
  const service = build();
  const send = async (chatId: string, id: string, i: number) => readAll(await service.sendMessage("anna", chatId, { id, role: "user", parts: [file(i)] }));
  return { storage, service, send, build };
}

it("numbers persist across messages, repeated attachment IDs, restart and sibling branches", async () => {
  const { service, send, build, storage } = setup();
  const chat = await service.createChat("anna");
  await send(chat.id, "u1", 0);
  await send(chat.id, "u2", 1);
  await send(chat.id, "u3", 0);
  expect((await service.getChatImages("anna", chat.id)).map(p => [p.number, p.attachmentId])).toEqual([[1, ids[0]], [2, ids[1]]]);
  const restarted = build();
  expect(await restarted.getChatImages("anna", chat.id)).toEqual(await service.getChatImages("anna", chat.id));
  await readAll(await service.editMessage("anna", chat.id, "u2", { id: "u2-edit", role: "user", parts: [file(2)] }));
  expect((await service.getChatImages("anna", chat.id)).map(p => [p.number, p.attachmentId])).toEqual([[1, ids[0]], [3, ids[2]]]);
  await service.selectBranch("anna", chat.id, "u2");
  expect((await service.getChatImages("anna", chat.id)).map(p => p.number)).toEqual([1, 2]);
  await send(chat.id, "u4", 3);
  expect((await service.getChatImages("anna", chat.id)).map(p => p.number)).toEqual([1, 2, 4]);
  await expect(service.getChatImages("boris", chat.id)).rejects.toThrow();
  const before = await storage.listMessages(chat.id);
  await service.getChatImages("anna", chat.id);
  expect(await storage.listMessages(chat.id)).toEqual(before);
});

it("imports number human images only, independently per chat; old unnumbered images are not backfilled", async () => {
  const { service, storage } = setup();
  const old = await storage.createChat({ id: crypto.randomUUID(), ownerId: "anna", modelId: mockModelId, providerId: "mock" });
  await storage.insertMessage({ id: "legacy", chatId: old.id, role: "user", parentId: null, parts: [file(0)], createdAt: "2025-01-01T00:00:00Z", formatVersion: 1, status: "complete", usage: null, modelId: null, providerId: null, error: null, reasoningDurationsMs: {} });
  expect(await service.getChatImages("anna", old.id)).toEqual([]);
  const imported = await service.importChat({ ownerId: "anna", chat: {}, messages: [
    { role: "assistant", createdAt: "2025-01-01T00:00:00Z", parts: [{ type: "image", bytes: new Uint8Array([1]), mediaType: "image/png" }] },
    { role: "user", createdAt: "2025-01-01T00:01:00Z", parts: [{ type: "image", bytes: new Uint8Array([2]), mediaType: "image/png", number: 999, attachmentId: ids[3] } as never] },
  ] });
  expect((await service.getChatImages("anna", imported.chatId)).map(p => [p.number, p.attachmentId])).toEqual([[1, ids[0]]]);
});


it("compaction does not lose or reassign photo numbers, and browser-supplied annotations are ignored", async () => {
  const { service, send, storage } = setup();
  const chat = await service.createChat("anna");
  await readAll(await service.sendMessage("anna", chat.id, { id: "forged", role: "user", parts: [file(0), { type: "data-chat-image-number", data: { number: 999, attachmentId: ids[0] } } as never] }));
  await send(chat.id, "photo2", 1);
  await send(chat.id, "photo3", 2);
  await send(chat.id, "photo4", 3);
  const before = await service.getChatImages("anna", chat.id);
  expect(before.map(ref => ref.number)).toEqual([1, 2, 3, 4]);
  expect(JSON.stringify((await service.getHistory("anna", chat.id)).messages)).not.toContain("data-chat-image-number");
  expect(await service.compactNow("anna", chat.id)).toBe("compacted");
  expect(await storage.listCompactions(chat.id)).toHaveLength(1);
  expect(await service.getChatImages("anna", chat.id)).toEqual(before);
  await send(chat.id, "repeat-photo1", 0);
  expect(await service.getChatImages("anna", chat.id)).toEqual(before);
});

it("failed insertion never leaves a number without its photo; retry stores them together once", async () => {
  const { service, storage, send } = setup();
  const chat = await service.createChat("anna");
  const insert = storage.insertMessage.bind(storage);
  let fail = true;
  vi.spyOn(storage, "insertMessage").mockImplementation(async message => {
    if (message.id === "retry-image" && fail) { fail = false; throw new Error("write-failure"); }
    await insert(message);
  });
  await expect(send(chat.id, "retry-image", 0)).rejects.toThrow("write-failure");
  expect(await service.getChatImages("anna", chat.id)).toEqual([]);
  await send(chat.id, "retry-image", 0);
  expect((await service.getChatImages("anna", chat.id)).map(ref => ref.number)).toEqual([1]);
  const stored = (await storage.getMessage("retry-image"))!;
  expect(stored.parts.filter(part => part.type === "file")).toHaveLength(1);
  expect(stored.parts.filter(part => part.type === "data-chat-image-number")).toHaveLength(1);
  await expect(send(chat.id, "retry-image", 0)).rejects.toThrow();
  expect((await service.getChatImages("anna", chat.id)).map(ref => ref.number)).toEqual([1]);
});
