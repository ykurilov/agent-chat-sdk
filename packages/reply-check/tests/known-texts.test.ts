import { createChatService, createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { AgentNotice } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { foreignWords, unknownLinks } from "../src";

// 066: тексты приложения, проверка текста вне хода и «слова человека — только сообщения человека» на настоящей службе чата.

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

/** Поддельная модель: ответы хода по очереди, переписка — всегда пустая (ссылки режет код). */
function fakeModel(answers: string[]) {
  let call = 0;
  return {
    specificationVersion: "v4",
    provider: "fake",
    modelId: "fake-v1",
    supportedUrls: {},
    async doStream() {
      const answer = answers[call++] ?? "Хорошо.";
      const parts = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: answer },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
      ];
      return { stream: new ReadableStream({ start: (controller) => (parts.forEach((part) => controller.enqueue(part)), controller.close()) }) };
    },
    async doGenerate() {
      return { content: [{ type: "text", text: "" }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
    },
  };
}

function setup(answers: string[], knownTexts?: () => string[]) {
  const model = fakeModel(answers);
  const catalog = extendCatalog(standardCatalog, {
    addProviders: [{ id: "fake", displayName: "Fake", apiKeyEnv: "FAKE_API_KEY", createLanguageModel: () => model as never, requestOptions: () => ({}) }],
    addModels: [{ id: "fake-model", displayName: "Fake", contextWindowTokens: 100_000, acceptsImages: false, reasoning: { replayPastTurns: true }, providerModelIds: { fake: "fake-v1" } }],
  });
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog,
    defaultChoice: { modelId: "fake-model", providerId: "fake" },
    agent: { instructions: "Ты помощник школы. Запись: https://school.example/course" },
    env: { FAKE_API_KEY: "не-настоящий" },
    logError: () => {},
    replyChecks: { checks: [foreignWords({ script: "cyrillic" }), unknownLinks()], ...(knownTexts && { knownTexts }) },
  });
  return service;
}

async function say(service: ReturnType<typeof setup>, chatId: string, id: string, text: string) {
  for await (const _chunk of await service.sendMessage("anna", chatId, { id, role: "user", parts: [{ type: "text", text }] }));
  const { messages } = await service.getHistory("anna", chatId);
  return messages.at(-1)!.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

const staffReply = (text: string): AgentNotice => ({ kind: "app", name: "flow_staff_reply", title: `Живой сотрудник ответил человеку вместо тебя: «${text}».` });

describe("knownTexts службы: тексты приложения для unknownLinks и foreignWords", () => {
  it("без knownTexts ссылка из первого сообщения вырезается, с ним — остаётся; латинские слова оттуда не чужие", async () => {
    const answer = "Welcome-пакет здесь: https://first.example/gift";
    const without = setup([answer]);
    const chat = await without.createChat("anna");
    expect(await say(without, chat.id, "u1", "привет")).not.toContain("https://first.example/gift");

    const withKnown = setup([answer], () => ["Первое сообщение: Welcome! Подарок https://first.example/gift"]);
    const known = await withKnown.createChat("anna");
    expect(await say(withKnown, known.id, "u1", "привет")).toBe(answer);
  });

  it("service.checkReply: текст приложения проходит тот же набор — законная ссылка остаётся, выдуманная режется", async () => {
    const service = setup([], () => ["Прощание: https://bye.example/page"]);
    const chat = await service.createChat("anna");
    const result = await service.checkReply({ ownerId: "anna", chatId: chat.id, text: "Спасибо! https://bye.example/page и https://fake.example/x" });
    expect(result.text).toContain("https://bye.example/page");
    expect(result.text).not.toContain("fake.example");
    expect(result.notes.some((note) => note.includes("ссылки не из инструкции"))).toBe(true);
  });
});

describe("слова человека — только из сообщений человека", () => {
  it("ссылка из реплики сотрудника не законна, а из сообщения человека — законна", async () => {
    const service = setup(["Ждёт: https://human.example/me", "Ждёт: https://staff.example/x"]);
    const chat = await service.createChat("anna");
    await say(service, chat.id, "u1", "Моя страница https://human.example/me");
    await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [staffReply("посмотрите https://staff.example/x")], wakeAgent: false, deliveryKey: "staff-1" });
    const second = await say(service, chat.id, "u2", "Ну что?");
    expect(second).not.toContain("staff.example");
    const text = (await service.checkReply({ ownerId: "anna", chatId: chat.id, text: "Ждёт: https://human.example/me и https://staff.example/x" })).text;
    expect(text).toContain("https://human.example/me");
    expect(text).not.toContain("staff.example");
  });
});
