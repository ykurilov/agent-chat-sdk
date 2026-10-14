import { createChatService, createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import type { ModelCatalog, ReplyChecksSetting, UsageRecord } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { englishReplyCheckLabels, foreignWords, russianReplyCheckLabels, unknownLinks } from "../src";
import { LINK_REWRITE_INSTRUCTION } from "../src/unknown-links";

// Настоящая служба чата с проверками пакета: модель ответа и модель переписки — поддельные, без сети.

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

/** Поддельная модель: ответ хода одним текстом, переписка — `rewrite(инструкция, запрос)`. */
function fakeModel(answer: string, rewrite: (system: string, prompt: string) => string) {
  const generateCalls: Array<{ system: string; prompt: string }> = [];
  const model = {
    specificationVersion: "v4",
    provider: "fake",
    modelId: "fake-v1",
    supportedUrls: {},
    async doStream() {
      const parts = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: answer },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
      ];
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
    async doGenerate(options: { prompt: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }> }) {
      const textOf = (role: string) =>
        options.prompt
          .filter((message) => message.role === role)
          .map((message) => (typeof message.content === "string" ? message.content : message.content.map((part) => part.text ?? "").join("")))
          .join("\n");
      const call = { system: textOf("system"), prompt: textOf("user") };
      generateCalls.push(call);
      return { content: [{ type: "text", text: rewrite(call.system, call.prompt) }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
    },
  };
  return { model, generateCalls };
}

function catalogWith(model: unknown): ModelCatalog {
  return extendCatalog(standardCatalog, {
    addProviders: [{ id: "fake", displayName: "Fake", apiKeyEnv: "FAKE_API_KEY", createLanguageModel: () => model as never, requestOptions: () => ({}) }],
    addModels: [{ id: "fake-model", displayName: "Fake", contextWindowTokens: 100_000, acceptsImages: false, reasoning: { replayPastTurns: true }, providerModelIds: { fake: "fake-v1" } }],
  });
}

async function answerOf(answer: string, rewrite: (system: string, prompt: string) => string, replyChecks: ReplyChecksSetting) {
  const { model, generateCalls } = fakeModel(answer, rewrite);
  const storage = createInMemoryChatStorage();
  const written: UsageRecord[] = [];
  const insert = storage.insertUsageRecord.bind(storage);
  storage.insertUsageRecord = async (record) => {
    written.push(record);
    return insert(record);
  };
  const logged: string[] = [];
  const service = createChatService({
    storage,
    catalog: catalogWith(model),
    defaultChoice: { modelId: "fake-model", providerId: "fake" },
    agent: { instructions: "Ты помощник школы. Запись на курс: https://school.example/course" },
    env: { FAKE_API_KEY: "не-настоящий" },
    logError: (line) => void logged.push(line),
    replyChecks,
  });
  const chat = await service.createChat("anna");
  const stream = await service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "Расскажи о курсе" }] });
  for await (const _chunk of stream);
  const { messages } = await service.getHistory("anna", chat.id);
  const text = messages.at(-1)!.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  return { text, generateCalls, written, logged };
}

describe("createChatService({ replyChecks: [foreignWords(), unknownLinks()] })", () => {
  it("ответ с иероглифом и выдуманной ссылкой записан исправленным; законная ссылка из инструкции остаётся", async () => {
    const result = await answerOf(
      "Это часть 歷史 школы. Запись: https://school.example/course, отзывы: https://fake.example/reviews",
      (system, prompt) =>
        system === LINK_REWRITE_INSTRUCTION
          ? "Это часть истории школы. Запись: https://school.example/course"
          : prompt.split("\n\n")[0]!.replace("歷史", "истории"),
      [foreignWords({ script: "cyrillic" }), unknownLinks()],
    );
    expect(result.text).toBe("Это часть истории школы. Запись: https://school.example/course");
    expect(result.generateCalls).toHaveLength(2);
    expect(result.written.filter((record) => record.source === "answer_correction")).toHaveLength(2);
    expect(result.logged.filter((line) => line.includes("[replyChecks]"))).toHaveLength(2);
  });

  it("чистый ответ — без переписки и без записей в журнал", async () => {
    const result = await answerOf("Запись на курс: https://school.example/course", () => {
      throw new Error("переписка не нужна");
    }, [foreignWords({ script: "cyrillic" }), unknownLinks()]);
    expect(result.text).toBe("Запись на курс: https://school.example/course");
    expect(result.generateCalls).toHaveLength(0);
    expect(result.logged.filter((line) => line.includes("[replyChecks]"))).toEqual([]);
  });

  it("ответ из одной выдуманной ссылки, переписка не удалась — ссылка не уходит: запасная фраза словаря, строка в журнал", async () => {
    const result = await answerOf("https://fake.example/a", () => "", [unknownLinks()]);
    expect(result.text).toBe(russianReplyCheckLabels.linkOnlyReply);
    expect(result.text).not.toContain("fake.example");
    expect(result.logged.some((line) => line.includes("[replyChecks]") && line.includes("запасная фраза"))).toBe(true);
  });

  it("запасную фразу задаёт приложение", async () => {
    const result = await answerOf("https://fake.example/a", () => "", [unknownLinks({ labels: englishReplyCheckLabels })]);
    expect(result.text).toBe(englishReplyCheckLabels.linkOnlyReply);
  });
});
