import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import type { ToolSet, UIMessageChunk } from "ai";
import { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { finishPart, generateResult, mockCatalog, mockEnv, mockModelId, readAll, reasoningParts, streamOf, streamStart, textParts } from "./support/mock-model";
import { userMessage } from "./support/notice-chat";

const LONG_THOUGHT = "Нужно продумать правила игры: сколько клеток на поле, кто ходит первым и как считать победу. ".repeat(3);
const thinkAndSay = (thought = LONG_THOUGHT): LanguageModelV4StreamPart[] => [streamStart, ...reasoningParts(thought), ...textParts(["Готово"]), finishPart()];
const pricing = { inputPerMillion: 1_000_000, outputPerMillion: 2_000_000 };

function setup(
  options: {
    titles?: ChatServiceOptions["thoughtTitles"] | false;
    title?: () => Promise<ReturnType<typeof generateResult>>;
    thought?: string;
    capabilities?: ChatServiceOptions["chatCapabilities"];
    scripts?: LanguageModelV4StreamPart[][];
    tools?: ToolSet;
  } = {},
) {
  const scripts = options.scripts ?? [thinkAndSay(options.thought), thinkAndSay(options.thought)];
  let call = 0;
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(scripts[call++] ?? thinkAndSay()) }) });
  const titleModel = new MockLanguageModelV4({ doGenerate: options.title ?? (async () => generateResult("Продумываю правила игры", { input: 200, output: 6 })) });
  const storage = createInMemoryChatStorage();
  const logError = vi.fn();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model, "mock-backup": titleModel }, { pricing }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", ...(options.tools && { tools: options.tools }) },
    env: mockEnv,
    logError,
    ...(options.titles !== false && { thoughtTitles: options.titles ?? { model: { modelId: mockModelId, providerId: "mock-backup" } } }),
    ...(options.capabilities && { chatCapabilities: options.capabilities }),
  });
  return { service, storage, model, titleModel, logError };
}

/** Без права reasoning: текста раздумья нет, место раздумья (начало и конец без текста) и заголовок есть. */
function expectOnlyTitle(chunks: UIMessageChunk[]) {
  expect(JSON.stringify(chunks)).not.toContain("продумать правила");
  expect(chunks.some((chunk) => chunk.type === "reasoning-delta")).toBe(false);
  expect(chunks.filter((chunk) => chunk.type.startsWith("reasoning")).map((chunk) => chunk.type)).toEqual(["reasoning-start", "reasoning-end"]);
  expect(metadataTitles(chunks)).toContainEqual({ "0": "Продумываю правила игры" });
}

const metadataTitles = (chunks: UIMessageChunk[]) =>
  chunks.flatMap((chunk) => (chunk.type === "message-metadata" && chunk.messageMetadata && "thoughtTitles" in (chunk.messageMetadata as object) ? [(chunk.messageMetadata as { thoughtTitles: unknown }).thoughtTitles] : []));

describe("заголовки раздумий (thoughtTitles)", () => {
  it("пересказ моделью: заголовок идёт в поток, лежит в части раздумья, расход — видом thought_title", async () => {
    const { service, storage, titleModel } = setup();
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сделай игру")));

    expect(metadataTitles(chunks)).toContainEqual({ "0": "Продумываю правила игры" });
    const prompt = JSON.stringify(titleModel.doGenerateCalls[0]!.prompt);
    expect(prompt).toContain("<thought>");
    expect(prompt).toContain("продумать правила игры");
    expect(prompt).toContain("Title language: Russian");

    const stored = (await storage.listMessages(chat.id)).at(-1)!;
    const reasoning = stored.parts.find((part) => part.type === "reasoning");
    expect(reasoning).toMatchObject({ providerMetadata: { agentChat: { thoughtTitle: "Продумываю правила игры" } } });

    const [usage] = await storage.sumUsage({ chatId: chat.id, source: "thought_title" });
    expect(usage).toMatchObject({ modelId: mockModelId, providerId: "mock-backup", inputTokens: 200, outputTokens: 6 });
    expect(usage!.costUsd).toBeGreaterThan(0);
    // Расход — у владельца чата и привязан к ответу.
    expect(await storage.sumUsage({ ownerId: "anna", messageId: stored.id, source: "thought_title" })).toHaveLength(1);
  });

  it("после перезагрузки заголовок на месте, модель заголовков не зовётся снова", async () => {
    const { service, titleModel } = setup();
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сделай игру")));
    const answer = (await service.getHistory("anna", chat.id)).messages.at(-1);
    expect(answer?.metadata?.thoughtTitles).toEqual({ "0": "Продумываю правила игры" });
    await service.getHistory("anna", chat.id);
    expect(titleModel.doGenerateCalls).toHaveLength(1);
  });

  it("язык — по сообщению человека; настройка языка главнее", async () => {
    const english = setup();
    const chat = await english.service.createChat("anna");
    await readAll(await english.service.sendMessage("anna", chat.id, userMessage("u1", "Make a game")));
    expect(JSON.stringify(english.titleModel.doGenerateCalls[0]!.prompt)).toContain("Title language: English");

    const fixed = setup({ titles: { model: { modelId: mockModelId, providerId: "mock-backup" }, language: () => "de" } });
    const other = await fixed.service.createChat("anna");
    await readAll(await fixed.service.sendMessage("anna", other.id, userMessage("u1", "Сделай игру")));
    expect(JSON.stringify(fixed.titleModel.doGenerateCalls[0]!.prompt)).toContain("Title language: German");
  });

  it("заголовок провайдера на языке человека — без модели заголовков", async () => {
    const { service, titleModel } = setup({ thought: `**Выбираю размер поля**\n\n${LONG_THOUGHT}` });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сделай игру")));
    expect((await service.getHistory("anna", chat.id)).messages.at(-1)?.metadata?.thoughtTitles).toEqual({ "0": "Выбираю размер поля" });
    expect(titleModel.doGenerateCalls).toHaveLength(0);
  });

  it("сбой модели заголовков — ответ как обычно, без заголовка, строка в журнал", async () => {
    const { service, logError } = setup({
      title: async () => {
        throw new Error("модель заголовков легла");
      },
    });
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сделай игру")));
    expect(chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta === "Готово")).toBe(true);
    const answer = (await service.getHistory("anna", chat.id)).messages.at(-1);
    expect(answer?.metadata?.status).toBe("complete");
    expect(answer?.metadata).not.toHaveProperty("thoughtTitles");
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("заголовок раздумья"));
  });

  it("кэш: запрос основной модели во втором ходе побайтно тот же, что без заголовков", async () => {
    const withTitles = setup();
    const without = setup({ titles: false });
    for (const { service } of [withTitles, without]) {
      const chat = await service.createChat("anna");
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сделай игру")));
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Дальше")));
    }
    const stored = JSON.stringify(withTitles.model.doStreamCalls[1]!.prompt);
    expect(stored).not.toContain("Продумываю правила игры");
    expect(stored).not.toContain("agentChat");
    expect(stored).toBe(JSON.stringify(without.model.doStreamCalls[1]!.prompt));
  });

  it("без права reasoning: заголовок и пустое место раздумья — в потоке и истории, текста раздумья нет", async () => {
    const { service } = setup({ capabilities: () => ({ reasoning: false }) });
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сделай игру")));
    expectOnlyTitle(chunks);

    const answer = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    expect(answer.metadata?.thoughtTitles).toEqual({ "0": "Продумываю правила игры" });
    expect(answer.metadata).not.toHaveProperty("reasoningDurationsMs");
    expect(answer.parts.filter((part) => part.type === "reasoning")).toEqual([{ type: "reasoning", text: "", state: "done" }]);
    expect(JSON.stringify(answer)).not.toContain("продумать правила");
  });

  it("без права reasoning, переподключение посреди хода: повтор и новые куски — тоже без текста раздумья", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { service } = setup({
      capabilities: () => ({ reasoning: false }),
      scripts: [
        [streamStart, ...reasoningParts(LONG_THOUGHT), { type: "tool-call", toolCallId: "c1", toolName: "wait", input: "{}" }, finishPart("tool-calls")],
        [streamStart, ...textParts(["Готово"]), finishPart()],
      ],
      tools: { wait: tool({ description: "Ждать", inputSchema: z.object({}), execute: async () => (await gate, "ок") }) },
    });
    const chat = await service.createChat("anna");
    const reading = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сделай игру")));
    await expect.poll(async () => (await service.peekHistory("anna", chat.id)).running).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const resumed = await service.subscribe("anna", chat.id);
    release();
    expectOnlyTitle(await readAll(resumed!));
    expectOnlyTitle(await reading);
  });

  it("без настройки — ни заголовков, ни вызовов", async () => {
    const { service, titleModel } = setup({ titles: false });
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сделай игру")));
    expect(metadataTitles(chunks)).toEqual([]);
    expect(titleModel.doGenerateCalls).toHaveLength(0);
  });

  it("ошибка в настройке — TypeError при создании службы", () => {
    expect(() => setup({ titles: { model: { modelId: "нет-такой", providerId: "mock" } } })).toThrow(TypeError);
    expect(() => setup({ titles: { maxPerTurn: 0 } })).toThrow(TypeError);
  });
});

describe("заголовки раздумий: включение по чату", () => {
  it("enabled-функция решает на каждый ход; сбой — без заголовков", async () => {
    const enabled = vi.fn(({ ownerId }: { ownerId: string }) => ownerId === "boris");
    const { service, titleModel } = setup({ titles: { model: { modelId: mockModelId, providerId: "mock-backup" }, enabled } });
    const anna = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", anna.id, userMessage("u1", "Сделай игру")));
    expect(titleModel.doGenerateCalls).toHaveLength(0);
    const boris = await service.createChat("boris");
    await readAll(await service.sendMessage("boris", boris.id, userMessage("u2", "Сделай игру")));
    expect(titleModel.doGenerateCalls).toHaveLength(1);
    expect(enabled).toHaveBeenCalledWith({ ownerId: "boris", chatId: boris.id });

    const broken = setup({
      titles: {
        model: { modelId: mockModelId, providerId: "mock-backup" },
        enabled: () => {
          throw new Error("сломалась");
        },
      },
    });
    const chat = await broken.service.createChat("anna");
    await readAll(await broken.service.sendMessage("anna", chat.id, userMessage("u1", "Сделай игру")));
    expect(broken.titleModel.doGenerateCalls).toHaveLength(0);
    expect(broken.logError).toHaveBeenCalledWith(expect.stringContaining("enabled упала"));
  });
});

describe("заголовки раздумий: правки ревью", () => {
  const titleOk = (title: string) => async () => generateResult(title, { input: 50, output: 5 });
  const untitledThenTitled: LanguageModelV4StreamPart[][] = [
    [streamStart, ...reasoningParts("Let me check.", "r0"), { type: "tool-call", toolCallId: "c1", toolName: "wait", input: "{}" }, finishPart("tool-calls")],
    [streamStart, ...reasoningParts(`**Выбираю размер поля**\n\n${LONG_THOUGHT}`, "r1"), ...textParts(["Готово"]), finishPart()],
  ];
  const waitTool = { wait: tool({ description: "Ждать", inputSchema: z.object({}), execute: async () => "ок" }) };

  it("без права reasoning место раздумья — только у части с заголовком; номера заголовков — по местам экрана", async () => {
    // Модель заголовков отвечает не по-русски: у первого раздумья заголовка нет.
    const { service } = setup({ capabilities: () => ({ reasoning: false }), scripts: untitledThenTitled, tools: waitTool, title: titleOk("Planning rules") });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сделай игру")));
    const answer = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    expect(answer.parts.filter((part) => part.type === "reasoning")).toEqual([{ type: "reasoning", text: "", state: "done" }]);
    expect(answer.metadata?.thoughtTitles).toEqual({ "0": "Выбираю размер поля" });
  });

  it("enabled(chat) = false или showWithoutReasoning: false — без права reasoning как раньше: ни мест, ни заголовков", async () => {
    for (const titles of [
      { model: { modelId: mockModelId, providerId: "mock-backup" }, enabled: () => false },
      { model: { modelId: mockModelId, providerId: "mock-backup" }, showWithoutReasoning: false },
    ]) {
      const { service } = setup({ capabilities: () => ({ reasoning: false }), titles });
      const chat = await service.createChat("anna");
      const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сделай игру")));
      expect(chunks.some((chunk) => chunk.type.startsWith("reasoning"))).toBe(false);
      expect(metadataTitles(chunks)).toEqual([]);
      const answer = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
      expect(answer.parts.some((part) => part.type === "reasoning")).toBe(false);
      expect(answer.metadata).not.toHaveProperty("thoughtTitles");
    }
  });

  it("с правом reasoning showWithoutReasoning: false заголовков не прячет", async () => {
    const { service } = setup({ titles: { model: { modelId: mockModelId, providerId: "mock-backup" }, showWithoutReasoning: false } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сделай игру")));
    expect((await service.getHistory("anna", chat.id)).messages.at(-1)?.metadata?.thoughtTitles).toEqual({ "0": "Продумываю правила игры" });
  });

  it("невызванный инструмент набора и имена навыков приложения (hiddenNames) в заголовке — нет заголовка", async () => {
    for (const [title, hidden] of [["Открываю gamedev", []], ["Читаю огненный дракон", ["Огненный дракон"]]] as const) {
      const hiddenNames = vi.fn(async () => hidden);
      const { service } = setup({
        tools: { gamedev: tool({ description: "Игры", inputSchema: z.object({}), execute: async () => "ок" }) },
        titles: { model: { modelId: mockModelId, providerId: "mock-backup" }, hiddenNames },
        title: titleOk(title),
      });
      const chat = await service.createChat("anna");
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сделай игру")));
      expect((await service.getHistory("anna", chat.id)).messages.at(-1)?.metadata).not.toHaveProperty("thoughtTitles");
      expect(hiddenNames).toHaveBeenCalledWith({ ownerId: "anna", chatId: chat.id });
    }
  });
});

describe("заголовки раздумий: maxPerTurn с автопродолжением", () => {
  afterEach(() => vi.useRealTimers());

  it("обрыв посреди ответа и автопродолжение — пересказов не больше maxPerTurn на весь ответ", async () => {
    vi.useFakeTimers();
    const busy = new APICallError({ message: "503", url: "https://p.test", requestBodyValues: {}, statusCode: 503, responseBody: "busy", responseHeaders: {} });
    const { service, titleModel } = setup({
      titles: { model: { modelId: mockModelId, providerId: "mock-backup" }, maxPerTurn: 1 },
      scripts: [
        [streamStart, ...reasoningParts(LONG_THOUGHT, "r0"), { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Начало " }, { type: "error", error: busy }],
        [streamStart, ...reasoningParts(`второе ${LONG_THOUGHT}`, "r1"), ...textParts(["и конец."]), finishPart()],
      ],
    });
    const chat = await service.createChat("anna");
    const reading = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сделай игру")));
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1_000);
    await reading;
    const answer = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    expect(answer.parts.filter((part) => part.type === "reasoning")).toHaveLength(2);
    expect(titleModel.doGenerateCalls).toHaveLength(1);
  });
});
