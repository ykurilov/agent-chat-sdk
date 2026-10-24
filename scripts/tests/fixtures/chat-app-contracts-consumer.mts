// Выполняется отдельно против pnpm pack, не против workspace sources. Ключи/сеть модели не нужны.
import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import { createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { ContextBlocksInput, ChatImageReference } from "@ykurilov/agent-chat-core";
import { createChatServer } from "@ykurilov/agent-chat-server";
import type { NewChatGreetingResolver } from "@ykurilov/agent-chat-server";
import { createAttachments, createMemoryAttachmentStorage } from "@ykurilov/agent-chat-attachments";

const model = new MockLanguageModelV4({ doStream: async () => ({
  stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: "stream-start", warnings: [] });
    controller.enqueue({ type: "text-start", id: "text-1" });
    controller.enqueue({ type: "text-delta", id: "text-1", delta: "Тестовый ответ" });
    controller.enqueue({ type: "text-end", id: "text-1" });
    controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    } });
    controller.close();
  } }),
}) });
const catalog = extendCatalog(standardCatalog, {
  addProviders: [{ id: "test", displayName: "Test", apiKeyEnv: "TEST_MODEL_TOKEN", createLanguageModel: () => model, requestOptions: () => ({}) }],
  addModels: [{ id: "test-model", displayName: "Test", contextWindowTokens: 100_000, acceptsImages: true,
    reasoning: { replayPastTurns: true }, providerModelIds: { test: "test-model" } }],
});
const attachments = createAttachments({ storage: createMemoryAttachmentStorage(), imageNumbers: true });
const seen: ContextBlocksInput["userMessage"][] = [];
const newChatGreeting: NewChatGreetingResolver = async ({ userId, chatData }) => {
  assert.equal(userId, "anna");
  assert.equal(chatData?.mode, "interview");
  return { instruction: "Поздоровайся и задай первый вопрос анкеты." };
};
const { handler, service } = createChatServer({
  basePath: "/api/chat", storage: createInMemoryChatStorage(), attachments, catalog,
  defaultChoice: { modelId: "test-model", providerId: "test" }, env: { TEST_MODEL_TOKEN: "unused-test-value" },
  resolveUser: async () => ({ id: "anna" }),
  newChatData: async () => ({ mode: "interview" }), newChatGreeting,
  agent: { instructions: "Помощник", contextBlocks: async ({ userMessage }) => {
    seen.push(userMessage);
    return userMessage ? [{ key: "mode_hint", text: `CHECK:${userMessage.text}` }] : [];
  } },
});
const response = await handler.fetch(new Request("http://smoke/api/chat", { method: "POST" }));
assert.equal(response.status, 201);
const { id } = await response.json() as { id: string };
const deadline = Date.now() + 5_000;
while ((await service.getHistory("anna", id)).running) {
  assert.ok(Date.now() < deadline, "greeting did not finish");
  await new Promise(resolve => setTimeout(resolve, 10));
}
assert.equal(model.doStreamCalls.length, 1);
assert.equal(seen[0], null);
const named = await service.createChat("anna", { title: "  Дневник  ", data: { hidden: "private-metadata" } });
assert.equal(named.title, "Дневник");
const png = Buffer.from(process.env.SMOKE_PNG_BASE64!, "base64");
const uploaded = await attachments.ingestFile({ userId: "anna", chatId: id, name: "photo.png", bytes: png });
assert.ok(uploaded.ok);
const stream = await service.sendMessage("anna", id, { id: "question", role: "user", parts: [
  { type: "file", url: `attachment:${uploaded.attachment.id}`, mediaType: "image/png" },
  { type: "text", text: "Помоги выбрать фото" },
] });
for await (const _chunk of stream) { /* дочитать реальный поток службы */ }
const images: ChatImageReference[] = await service.getChatImages("anna", id);
assert.deepEqual(images.map(image => [image.number, image.attachmentId]), [[1, uploaded.attachment.id]]);
assert.deepEqual(seen[1], { id: "question", text: "Помоги выбрать фото" });
const prompt = model.doStreamCalls[1]!.prompt;
const content = prompt.filter(message => message.role === "user").flatMap(message => typeof message.content === "string" ? [] : message.content);
const marker = content.findIndex(part => part.type === "text" && part.text === "[Фото №1]");
assert.ok(marker >= 0);
const numberedFile = content[marker + 1];
assert.ok(numberedFile?.type === "file");
assert.match(numberedFile.mediaType, /^image\//);
assert.ok(JSON.stringify(prompt).includes("CHECK:Помоги выбрать фото"));
assert.ok(!JSON.stringify(prompt).includes("private-metadata"));
assert.ok((await attachments.readChatImage({ chatId: id, attachmentId: images[0]!.attachmentId }))?.bytes.length);
assert.deepEqual(await service.getChatImages("anna", named.id), []);
await assert.rejects(() => service.getChatImages("boris", id));
await handler.fetch(new Request(`http://smoke/api/chat/${id}`));
assert.equal(model.doStreamCalls.length, 2);
console.log("PACK CONSUMER PASS: root imports/types, ai/test, HTTP greeting/reload, title, async context, photo mapping and model marker");
