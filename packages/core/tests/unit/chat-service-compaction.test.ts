import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentToolsModel } from "../../src/agent-run/run-agent-turn";
import { ChatNotFoundError, createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import { summaryFrame } from "../../src/compaction/compaction-task";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { generateResult, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

/** Модель ответов: размер контекста после каждого ответа берётся из списка по порядку. */
function answeringModel(contexts: number[], summary: Promise<void> = Promise.resolve()) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const context = contexts[call++] ?? contexts.at(-1)!;
      return {
        stream: streamOf([
          streamStart,
          ...textParts([`ответ ${call}`]),
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: context - 10, noCache: context - 10, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 10, text: 10, reasoning: 0 },
            },
          },
        ]),
      };
    },
    doGenerate: async ({ abortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        void summary.then(resolve);
        abortSignal?.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
      });
      return generateResult("## Цель\nсводка", { output: 20 });
    },
  });
}

function heldSummary() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  return { held, release };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const user = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

function setup(model: MockLanguageModelV4, extra: Partial<ChatServiceOptions> = {}) {
  const storage = createInMemoryChatStorage();
  const logError = vi.fn();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    compaction: { thresholdTokens: 500, tailTokens: 100, summaryCeilingTokens: 100 },
    env: mockEnv,
    logError,
    ...extra,
  });
  return { service, storage, logError };
}

async function ask(service: ReturnType<typeof setup>["service"], chatId: string, id: string, text: string) {
  await readAll(await service.sendMessage("anna", chatId, user(id, text)));
}

async function compactionDone(service: ReturnType<typeof setup>["service"], chatId: string) {
  await vi.waitFor(async () => expect((await service.getCompactions("anna", chatId)).compacting).toBe(false));
}

describe("служба чата: сжатие истории", () => {
  it("после ответа над порогом появляется запись; экран получает разделитель; следующий запрос идёт со сводкой и хвостом", async () => {
    const model = answeringModel([100, 300, 600, 300]);
    const { service, storage } = setup(model);
    const chat = await service.createChat("anna");
    await ask(service, chat.id, "u1", "первый вопрос");
    await ask(service, chat.id, "u2", "второй вопрос");
    await ask(service, chat.id, "u3", "третий вопрос");
    await vi.waitFor(async () => expect(await storage.listCompactions(chat.id)).toHaveLength(1));
    await compactionDone(service, chat.id);

    const history = await service.getHistory("anna", chat.id);
    expect(history.compacting).toBe(false);
    expect(history.compactions).toHaveLength(1);
    expect(history.compactions[0]).toMatchObject({ fromMessageId: "u1", summary: "## Цель\nсводка" });
    expect(history.messages).toHaveLength(6);

    await ask(service, chat.id, "u4", "четвёртый вопрос");
    const prompt = JSON.stringify(model.doStreamCalls.at(-1)!.prompt);
    expect(prompt).toContain("<conversation_summary>");
    expect(prompt).toContain("третий вопрос");
    expect(prompt).not.toContain("первый вопрос");
    expect(prompt).not.toContain("второй вопрос");
  });

  it("modelDetails: false — сводка сжатия не уходит зрителю: в истории и в GET compactions разделитель без текста", async () => {
    const model = answeringModel([100, 300, 600, 300]);
    const { service, storage } = setup(model, { chatCapabilities: () => ({ modelDetails: false }) });
    const chat = await service.createChat("anna");
    for (const [index, text] of ["раз", "два", "три"].entries()) await ask(service, chat.id, `u${index + 1}`, text);
    await vi.waitFor(async () => expect(await storage.listCompactions(chat.id)).toHaveLength(1));
    await compactionDone(service, chat.id);
    for (const { compactions } of [await service.getHistory("anna", chat.id), await service.getCompactions("anna", chat.id)]) {
      expect(compactions).toHaveLength(1);
      expect(compactions[0]).toMatchObject({ fromMessageId: "u1", summary: "", summaryTokens: 0 });
    }
    expect((await storage.listCompactions(chat.id))[0]!.summary).toBe("## Цель\nсводка");
  });

  it("toolDetails: false без modelDetails: false — сводка видна, как раньше", async () => {
    const model = answeringModel([100, 300, 600, 300]);
    const { service, storage } = setup(model, { chatCapabilities: () => ({ toolDetails: false, reasoning: false }) });
    const chat = await service.createChat("anna");
    for (const [index, text] of ["раз", "два", "три"].entries()) await ask(service, chat.id, `u${index + 1}`, text);
    await vi.waitFor(async () => expect(await storage.listCompactions(chat.id)).toHaveLength(1));
    await compactionDone(service, chat.id);
    for (const { compactions } of [await service.getHistory("anna", chat.id), await service.getCompactions("anna", chat.id)]) {
      expect(compactions[0]).toMatchObject({ summary: "## Цель\nсводка" });
    }
  });

  it("префикс запроса не меняется от сжатия: инструкция и инструменты те же, что до него", async () => {
    const model = answeringModel([100, 300, 600, 300]);
    const lookup = tool({ description: "Поиск.", inputSchema: z.object({ query: z.string() }), execute: async () => "x" });
    const { service, storage } = setup(model, { agent: { instructions: "Ты помощник.", tools: { lookup } } });
    const chat = await service.createChat("anna");
    for (const [index, text] of ["раз", "два", "три"].entries()) await ask(service, chat.id, `u${index + 1}`, text);
    await vi.waitFor(async () => expect(await storage.listCompactions(chat.id)).toHaveLength(1));
    await compactionDone(service, chat.id);
    await ask(service, chat.id, "u4", "четыре");
    const before = model.doStreamCalls[2]!;
    const after = model.doStreamCalls[3]!;
    expect(after.prompt[0]).toEqual(before.prompt[0]);
    expect(after.tools).toEqual(before.tools);
    // запрос сжатия — тот же префикс
    expect(model.doGenerateCalls[0]!.prompt[0]).toEqual(before.prompt[0]);
    expect(model.doGenerateCalls[0]!.tools).toEqual(before.tools);
  });

  it("новое сообщение во время сжатия начинает ответ сразу, с полным контекстом; сводка — со следующего хода", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const model = answeringModel([100, 300, 600, 300, 300], held);
    const { service, storage } = setup(model);
    const chat = await service.createChat("anna");
    for (const [index, text] of ["раз", "два", "три"].entries()) await ask(service, chat.id, `u${index + 1}`, text);
    await vi.waitFor(async () => expect((await service.getCompactions("anna", chat.id)).compacting).toBe(true));

    await ask(service, chat.id, "u4", "четыре"); // не ждёт сжатия
    expect(JSON.stringify(model.doStreamCalls[3]!.prompt)).toContain("раз");
    expect(JSON.stringify(model.doStreamCalls[3]!.prompt)).not.toContain("<conversation_summary>");

    release();
    await vi.waitFor(async () => expect(await storage.listCompactions(chat.id)).toHaveLength(1));
    await compactionDone(service, chat.id);
    await ask(service, chat.id, "u5", "пять");
    expect(JSON.stringify(model.doStreamCalls[4]!.prompt)).toContain("<conversation_summary>");
  });

  it("сжатие выключено — записей нет, запросы полные", async () => {
    const model = answeringModel([100, 300, 600]);
    const { service, storage } = setup(model, { compaction: false });
    const chat = await service.createChat("anna");
    for (const [index, text] of ["раз", "два", "три"].entries()) await ask(service, chat.id, `u${index + 1}`, text);
    expect(await storage.listCompactions(chat.id)).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(0);
    expect((await service.getHistory("anna", chat.id)).compactions).toEqual([]);
  });

  it("сбой сжатия ответы не ломает: история и ответы целы, в журнале причина", async () => {
    const model = answeringModel([100, 300, 600, 300]);
    model.doGenerate = async () => {
      throw new Error("нет связи");
    };
    const { service, storage, logError } = setup(model);
    const chat = await service.createChat("anna");
    for (const [index, text] of ["раз", "два", "три"].entries()) await ask(service, chat.id, `u${index + 1}`, text);
    await vi.waitFor(() => expect(logError).toHaveBeenCalled());
    await ask(service, chat.id, "u4", "четыре");
    expect(await storage.listCompactions(chat.id)).toEqual([]);
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.filter((message) => message.role === "assistant").map((message) => message.metadata?.status)).toEqual([
      "complete",
      "complete",
      "complete",
      "complete",
    ]);
  });

  it("остановленный ответ сжатия не запускает", async () => {
    const model = answeringModel([100, 300, 600]);
    const { service, storage } = setup(model);
    const chat = await service.createChat("anna");
    await ask(service, chat.id, "u1", "раз");
    await ask(service, chat.id, "u2", "два");
    const stream = await service.sendMessage("anna", chat.id, user("u3", "три"));
    await service.stop("anna", chat.id);
    await readAll(stream);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await storage.listCompactions(chat.id)).toEqual([]);
  });

  it("compactNow сжимает по команде; чужой чат — как «не найден»", async () => {
    const model = answeringModel([100, 300, 400]);
    const { service, storage } = setup(model);
    const chat = await service.createChat("anna");
    for (const [index, text] of ["раз", "два", "три"].entries()) await ask(service, chat.id, `u${index + 1}`, text);
    expect(await storage.listCompactions(chat.id)).toEqual([]);
    expect(await service.compactNow("anna", chat.id)).toBe("compacted");
    expect(await storage.listCompactions(chat.id)).toHaveLength(1);
    await expect(service.compactNow("boris", chat.id)).rejects.toBeInstanceOf(ChatNotFoundError);
    await expect(service.getCompactions("boris", chat.id)).rejects.toBeInstanceOf(ChatNotFoundError);
  });

  it("getCompactions отдаёт то же, что и история, без сообщений", async () => {
    const model = answeringModel([100, 300, 400]);
    const { service } = setup(model);
    const chat = await service.createChat("anna");
    for (const [index, text] of ["раз", "два", "три"].entries()) await ask(service, chat.id, `u${index + 1}`, text);
    await service.compactNow("anna", chat.id);
    const light = await service.getCompactions("anna", chat.id);
    const full = await service.getHistory("anna", chat.id);
    expect(light).toEqual({ compactions: full.compactions, compacting: full.compacting });
    expect(light.compactions).toHaveLength(1);
  });

  it("функция набора инструментов получает chatId хода", async () => {
    const model = answeringModel([100]);
    const seen: string[] = [];
    const { service } = setup(model, {
      agent: {
        instructions: "Ты помощник.",
        tools: ({ chatId }) => {
          seen.push(chatId);
          return {};
        },
      },
    });
    const chat = await service.createChat("anna");
    await ask(service, chat.id, "u1", "раз");
    expect(seen).toEqual([chat.id]);
  });

  it("набор инструментов запроса сжатия в чате объекта получает тот же subject, что у хода", async () => {
    const model = answeringModel([100, 600]);
    const seen: AgentToolsModel[] = [];
    const { service } = setup(model, {
      agent: {
        instructions: "Ты помощник.",
        tools: (toolsModel) => {
          seen.push(toolsModel);
          return {};
        },
      },
    });
    const { chat } = await service.openSubjectChat({ ownerId: "anna", key: "lesson:7", data: { lessonId: 7 } });
    await ask(service, chat.id, "u1", "раз");
    await ask(service, chat.id, "u2", "два");
    await compactionDone(service, chat.id);
    const compactionModels = seen.filter((toolsModel) => toolsModel.turnId === undefined);
    expect(compactionModels.length).toBeGreaterThan(0);
    for (const toolsModel of seen) expect(toolsModel.subject).toEqual({ key: "lesson:7", data: { lessonId: 7 } });
  });

  it("ответ, прерванный ради поправки, над порогом — сжатие всё равно начинается, хотя за ответом поправка", async () => {
    let releaseBuild!: () => void;
    let markStarted!: () => void;
    const released = new Promise<void>((resolve) => (releaseBuild = resolve));
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const build = tool({
      description: "Собрать сайт",
      inputSchema: z.object({}),
      execute: async () => {
        markStarted();
        await released;
        return "собрано";
      },
    });
    // Ответы 1–2 — разминка; ответ 3 зовёт build и набирает 600 (выше порога); ответ на поправку — 300.
    const steps: Array<{ context: number; tool?: boolean }> = [{ context: 100 }, { context: 300 }, { context: 600, tool: true }, { context: 300 }];
    let call = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        const { context, tool: callsTool } = steps[call++] ?? steps.at(-1)!;
        return {
          stream: streamOf([
            streamStart,
            ...(callsTool ? [{ type: "tool-call" as const, toolCallId: "c1", toolName: "build", input: "{}" }] : textParts([`ответ ${call}`])),
            {
              type: "finish",
              finishReason: callsTool ? { unified: "tool-calls", raw: "tool-calls" } : { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: context - 10, noCache: context - 10, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 10, text: 10, reasoning: 0 },
              },
            },
          ]),
        };
      },
      doGenerate: async () => generateResult("## Цель\nсводка", { output: 20 }),
    });
    const { service, storage } = setup(model, { agent: { instructions: "Ты помощник.", tools: { build } } });
    const chat = await service.createChat("anna");
    await ask(service, chat.id, "u1", "раз");
    await ask(service, chat.id, "u2", "два");
    const third = readAll(await service.sendMessage("anna", chat.id, user("u3", "собери сайт")));
    await started;
    expect(await service.steer("anna", chat.id, user("p1", "сделай синим"))).toMatchObject({ status: "queued" });
    releaseBuild();
    await third;
    const correction = await service.subscribe("anna", chat.id);
    if (correction) await readAll(correction);

    await vi.waitFor(async () => expect(await storage.listCompactions(chat.id)).toHaveLength(1));
    await compactionDone(service, chat.id);
    expect((await storage.listCompactions(chat.id))[0]).toMatchObject({ fromMessageId: "u1" });
  });
});
describe("служба чата: «стоп», остановка сервера, признак сжатия, лёгкий /compactions", () => {
  it("«стоп» во время ожидания сжатия завершает ход сразу; сжатие доделывается и записывается фоном", async () => {
    const { held, release } = heldSummary();
    const model = answeringModel([100, 950, 300], held);
    const { service, storage } = setup(model);
    const chat = await service.createChat("anna");
    await ask(service, chat.id, "u1", "раз");
    await ask(service, chat.id, "u2", "два");
    await vi.waitFor(async () => expect((await service.getCompactions("anna", chat.id)).compacting).toBe(true));

    const stream = await service.sendMessage("anna", chat.id, user("u3", "три"));
    await service.stop("anna", chat.id);
    const outcome = await Promise.race([readAll(stream).then(() => "ended"), pause(1_000).then(() => "still waiting")]);
    expect(outcome).toBe("ended");
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.at(-1)?.metadata?.status).toBe("stopped");
    expect(model.doStreamCalls).toHaveLength(2);

    release();
    await vi.waitFor(async () => expect(await storage.listCompactions(chat.id)).toHaveLength(1));
  });

  it("flush ждёт идущее сжатие, и запись уже в хранилище", async () => {
    const { held, release } = heldSummary();
    const { service, storage } = setup(answeringModel([100, 300, 600], held));
    const chat = await service.createChat("anna");
    for (const [index, text] of ["раз", "два", "три"].entries()) await ask(service, chat.id, `u${index + 1}`, text);
    let flushed = false;
    const flushing = service.flush().then(() => (flushed = true));
    await pause(30);
    expect(flushed).toBe(false);
    release();
    await flushing;
    expect(await storage.listCompactions(chat.id)).toHaveLength(1);
  });

  it("flush после предела отменяет сжатие: записи нет, в журнале тихо, признак снят", async () => {
    const { held } = heldSummary();
    const { service, storage, logError } = setup(answeringModel([100, 300, 600], held), {
      compaction: { thresholdTokens: 500, tailTokens: 100, summaryCeilingTokens: 100, flushWaitMs: 40 },
    });
    const chat = await service.createChat("anna");
    for (const [index, text] of ["раз", "два", "три"].entries()) await ask(service, chat.id, `u${index + 1}`, text);
    await service.flush();
    expect(await storage.listCompactions(chat.id)).toEqual([]);
    expect((await service.getCompactions("anna", chat.id)).compacting).toBe(false);
    expect(logError).not.toHaveBeenCalled();
  });

  it("признак «идёт сжатие» виден сразу после конца потока, даже когда решение ещё принимается", async () => {
    const { held } = heldSummary();
    const storage = createInMemoryChatStorage();
    const slow = new Proxy(storage, {
      get: (target, key, receiver) =>
        key === "listCompactions"
          ? async (chatId: string) => {
              await pause(50);
              return target.listCompactions(chatId);
            }
          : Reflect.get(target, key, receiver),
    });
    const delayed = createChatService({
      storage: slow,
      catalog: mockCatalog({ mock: answeringModel([100, 300, 600], held) }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты помощник." },
      compaction: { thresholdTokens: 500, tailTokens: 100, summaryCeilingTokens: 100 },
      env: mockEnv,
    });
    const chat = await delayed.createChat("anna");
    for (const [index, text] of ["раз", "два", "три"].entries()) await ask(delayed, chat.id, `u${index + 1}`, text);
    expect((await delayed.getCompactions("anna", chat.id)).compacting).toBe(true);
  });

  it("getCompactions не читает сообщения целиком: только связи сообщений ветки", async () => {
    const { service, storage } = setup(answeringModel([100, 300, 400]));
    const chat = await service.createChat("anna");
    for (const [index, text] of ["раз", "два", "три"].entries()) await ask(service, chat.id, `u${index + 1}`, text);
    await service.compactNow("anna", chat.id);
    const listMessages = vi.spyOn(storage, "listMessages");
    const listMessageLinks = vi.spyOn(storage, "listMessageLinks");
    const light = await service.getCompactions("anna", chat.id);
    expect(listMessages).not.toHaveBeenCalled();
    expect(listMessageLinks).toHaveBeenCalledTimes(1);
    expect(light.compactions).toHaveLength(1);
  });
});
void summaryFrame;
