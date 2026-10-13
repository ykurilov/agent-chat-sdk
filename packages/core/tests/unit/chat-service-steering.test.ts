import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { ModelMessage } from "ai";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createChatService } from "../../src/chat-service";
import { ChatBusyError } from "../../src/running-answers/running-answer-registry";
import type { ChatService } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { SpendingLimitReachedError } from "../../src/spending/spending-limits";
import type { SpendingLimits } from "../../src/spending/spending-limits";
import { IGNORED_REASON } from "../../src/tool-approval/approval-parts";
import type { TurnNotStartedHandler } from "../../src/turn-hooks/turn-hooks";
import { STEER_PART_TYPE } from "../../src/steering/turn-steering";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts, withoutToday } from "./support/mock-model";

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

const call = (name: string, id = "c1", input: object = {}): LanguageModelV4StreamPart => ({ type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(input) });
const step = (...calls: LanguageModelV4StreamPart[]): LanguageModelV4StreamPart[] => [streamStart, ...calls, finishPart("tool-calls")];
const saying = (text: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts([text]), finishPart()];

/** Инструмент `build`, который идёт, пока тест его не отпустит; «Стоп» его обрывает. */
function slowBuild() {
  let release!: () => void;
  let markStarted!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  const build = tool({
    description: "Собрать сайт",
    inputSchema: z.object({}),
    execute: async (_input, { abortSignal }) => {
      markStarted();
      await Promise.race([released, new Promise((resolve) => abortSignal?.addEventListener("abort", resolve))]);
      return "собрано";
    },
  });
  return { build, release, started };
}

function setup(
  scripts: LanguageModelV4StreamPart[][],
  extra: { tools?: ToolSet; limits?: SpendingLimits; turnNotStarted?: TurnNotStartedHandler; storage?: ChatStorage } = {},
) {
  let next = 0;
  const model = mockModel(() => streamOf(scripts[next++] ?? saying("Учёл")));
  const storage = extra.storage ?? createInMemoryChatStorage();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", tools: extra.tools ?? {} },
    ...(extra.limits && { limits: extra.limits }),
    ...(extra.turnNotStarted && { turnNotStarted: extra.turnNotStarted }),
    env: mockEnv,
  });
  return { model, service, storage };
}

/** Тексты последнего сообщения запроса без даты в хвосте. */
const lastUserTexts = (prompt: ModelMessage[]) => {
  const last = prompt.at(-1)!;
  expect(last.role).toBe("user");
  const content = last.content as Array<{ type: string; text?: string }>;
  return withoutToday(content.filter((part) => part.type === "text").map((part) => part.text!));
};

async function nextTurn(service: ChatService, chatId: string) {
  const stream = await service.subscribe("anna", chatId);
  expect(stream).not.toBeNull();
  return readAll(stream!);
}

describe("поправка на лету: ход на границе шага", () => {
  it("поправка во время инструмента: после результатов — сообщение человека, первый ответ готов, новый ответ идёт сам", async () => {
    const { build, release, started } = slowBuild();
    const { service, model } = setup([step(call("build"))], { tools: { build } });
    const chat = await service.createChat("anna");
    const first = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "сделай сайт")));
    await started;

    expect(await service.steer("anna", chat.id, userMessage("p1", "сделай синим"))).toEqual({ status: "queued", messageId: "p1" });
    const during = await service.getHistory("anna", chat.id);
    expect(during.running).toBe(true);
    expect(during.messages.map((message) => message.id)).toEqual(["u1"]);
    expect(during.pendingMessages?.map((message) => message.id)).toEqual(["p1"]);

    release();
    await first;
    await nextTurn(service, chat.id);

    expect(model.doStreamCalls).toHaveLength(2);
    const prompt = model.doStreamCalls[1]!.prompt;
    expect(prompt.slice(-3).map((message) => message.role)).toEqual(["assistant", "tool", "user"]);
    expect(lastUserTexts(prompt)).toEqual(["сделай синим"]);
    const { messages, running } = await service.getHistory("anna", chat.id);
    expect(running).toBe(false);
    expect(messages.map((message) => [message.role, message.metadata?.status ?? null])).toEqual([
      ["user", null],
      ["assistant", "complete"],
      ["user", null],
      ["assistant", "complete"],
    ]);
    expect(messages[2]!.parts.some((part) => part.type === STEER_PART_TYPE)).toBe(true);
    expect(messages[1]!.parts.some((part) => part.type === "tool-build")).toBe(true);
  });

  it("префикс запроса после поправки байт в байт тот же: инструкция, инструменты и всё до прошлого вопроса", async () => {
    const { build, release, started } = slowBuild();
    const { service, model } = setup([saying("Привет"), step(call("build"))], { tools: { build } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    const first = readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "сделай сайт")));
    await started;
    await service.steer("anna", chat.id, userMessage("p1", "сделай синим"));
    release();
    await first;
    await nextTurn(service, chat.id);

    const [, before, after] = model.doStreamCalls;
    const question = before!.prompt.length - 1;
    expect(after!.prompt[question]!.role).toBe("user");
    expect(JSON.stringify(after!.prompt.slice(0, question))).toBe(JSON.stringify(before!.prompt.slice(0, question)));
    // Прошлый вопрос — тот же, без хвоста с датой: дата всегда у последнего сообщения человека, как и при обычном новом вопросе.
    const asked = before!.prompt[question]!.content as Array<{ text?: string }>;
    const repeated = after!.prompt[question]!.content as Array<{ text?: string }>;
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(asked.slice(0, repeated.length)));
    expect(withoutToday(asked.slice(repeated.length).map((part) => part.text ?? ""))).toEqual([]);
    expect(JSON.stringify(after!.tools)).toBe(JSON.stringify(before!.tools));
    expect(JSON.stringify(after!.providerOptions)).toBe(JSON.stringify(before!.providerOptions));
  });

  it("две поправки: по порядку в ленте, модель видит их одним сообщением", async () => {
    const { build, release, started } = slowBuild();
    const { service, model } = setup([step(call("build"))], { tools: { build } });
    const chat = await service.createChat("anna");
    const first = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "сделай сайт")));
    await started;
    await Promise.all([service.steer("anna", chat.id, userMessage("p1", "синим")), service.steer("anna", chat.id, userMessage("p2", "и крупнее"))]);
    release();
    await first;
    await nextTurn(service, chat.id);

    expect(lastUserTexts(model.doStreamCalls[1]!.prompt)).toEqual(["синим", "\n\nи крупнее"]);
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.map((message) => message.id).slice(2, 4)).toEqual(["p1", "p2"]);
  });

  it("ход кончился без инструментов, а поправка пришла до конца — новый ответ на неё", async () => {
    let finishFirst!: () => void;
    const held = new Promise<void>((resolve) => (finishFirst = resolve));
    let opened!: () => void;
    const streaming = new Promise<void>((resolve) => (opened = resolve));
    let calls = 0;
    const model = mockModel(() => {
      calls++;
      if (calls > 1) return streamOf(saying("Учёл"));
      return new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          controller.enqueue(streamStart);
          for (const part of textParts(["Пишу ответ"])) controller.enqueue(part);
          opened();
          await held;
          controller.enqueue(finishPart());
          controller.close();
        },
      });
    });
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты помощник." },
      env: mockEnv,
    });
    const chat = await service.createChat("anna");
    const first = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    await streaming;
    expect((await service.steer("anna", chat.id, userMessage("p1", "короче"))).status).toBe("queued");
    finishFirst();
    await first;
    await nextTurn(service, chat.id);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(lastUserTexts(model.doStreamCalls[1]!.prompt)).toEqual(["короче"]);
  });

  it("повтор той же поправки (клиент не дождался ответа) — без второй копии: тот же итог, модель видит её один раз", async () => {
    const { build, release, started } = slowBuild();
    const { service, model } = setup([step(call("build"))], { tools: { build } });
    const chat = await service.createChat("anna");
    const first = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "сделай сайт")));
    await started;
    const correction = userMessage("p1", "сделай синим");
    const [once, together] = await Promise.all([service.steer("anna", chat.id, correction), service.steer("anna", chat.id, correction)]);
    expect(once).toEqual({ status: "queued", messageId: "p1" });
    expect(together).toEqual({ status: "queued", messageId: "p1" });
    expect(await service.steer("anna", chat.id, correction)).toEqual({ status: "queued", messageId: "p1" });
    expect((await service.getHistory("anna", chat.id)).pendingMessages?.map((message) => message.id)).toEqual(["p1"]);

    release();
    await first;
    await nextTurn(service, chat.id);
    expect(lastUserTexts(model.doStreamCalls[1]!.prompt)).toEqual(["сделай синим"]);
    // Ответ уже дан — повтор всё тот же: копии нет, нового хода нет.
    expect(await service.steer("anna", chat.id, correction)).toEqual({ status: "queued", messageId: "p1" });
    const { messages, running } = await service.getHistory("anna", chat.id);
    expect(running).toBe(false);
    expect(messages.map((message) => message.id).filter((id) => id === "p1")).toHaveLength(1);
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("повтор поправки, которая начала ход сама, — тот же итог `started`, второго сообщения нет", async () => {
    const { service, model } = setup([]);
    const chat = await service.createChat("anna");
    expect(await service.steer("anna", chat.id, userMessage("u1", "привет"))).toEqual({ status: "started", messageId: "u1" });
    await nextTurn(service, chat.id).catch(() => undefined);
    await vi.waitFor(async () => expect((await service.getHistory("anna", chat.id)).running).toBe(false));
    expect(await service.steer("anna", chat.id, userMessage("u1", "привет"))).toEqual({ status: "started", messageId: "u1" });
    expect((await service.getHistory("anna", chat.id)).messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("хода нет — поправка обычным сообщением и новым ходом", async () => {
    const { service, model } = setup([]);
    const chat = await service.createChat("anna");
    expect(await service.steer("anna", chat.id, userMessage("u1", "привет"))).toEqual({ status: "started", messageId: "u1" });
    await nextTurn(service, chat.id).catch(() => undefined);
    await vi.waitFor(async () => expect((await service.getHistory("anna", chat.id)).running).toBe(false));
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0]!.parts.some((part) => part.type === STEER_PART_TYPE)).toBe(false);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("«Стоп» при ждущей поправке: ответ остановлен, новый ход по поправке начинается сам", async () => {
    const { build, started } = slowBuild();
    const { service, model } = setup([step(call("build"))], { tools: { build } });
    const chat = await service.createChat("anna");
    const first = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "сделай сайт")));
    await started;
    await service.steer("anna", chat.id, userMessage("p1", "стоп, лучше синим"));
    expect(await service.stop("anna", chat.id)).toBe(true);
    await first;
    await nextTurn(service, chat.id);
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.map((message) => [message.id === "p1" ? "p1" : message.role, message.metadata?.status ?? null])).toEqual([
      ["user", null],
      ["assistant", "stopped"],
      ["p1", null],
      ["assistant", "complete"],
    ]);
    expect(lastUserTexts(model.doStreamCalls.at(-1)!.prompt)).toEqual(["стоп, лучше синим"]);
  });

  it("на шаге агент попросил подтверждения — запрос закрыт отказом, инструмент не вызван, новый ответ видит поправку", async () => {
    const { build, release, started } = slowBuild();
    const remove = vi.fn(async () => "удалено");
    const { service, model } = setup([step(call("build", "c1"), call("remove", "c2"))], {
      tools: { build, remove: tool({ description: "Удалить", inputSchema: z.object({}), needsApproval: true, execute: remove }) },
    });
    const chat = await service.createChat("anna");
    const first = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "собери и удали старое")));
    await started;
    await service.steer("anna", chat.id, userMessage("p1", "старое не удаляй"));
    release();
    await first;
    await nextTurn(service, chat.id);
    expect(remove).not.toHaveBeenCalled();
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages[1]!.metadata?.status).toBe("complete");
    expect(messages[1]!.parts.find((part) => part.type === "tool-remove")).toMatchObject({ state: "output-denied", approval: { approved: false, reason: IGNORED_REASON } });
    expect(messages.at(-1)!.metadata?.status).toBe("complete");
    expect(JSON.stringify(model.doStreamCalls.at(-1)!.prompt)).toContain(IGNORED_REASON);
    expect(lastUserTexts(model.doStreamCalls.at(-1)!.prompt)).toEqual(["старое не удаляй"]);
  });

  it("лимит исчерпан к концу хода: поправка остаётся без ответа, приложение узнаёт причину", async () => {
    const { build, release, started } = slowBuild();
    let exhausted = false;
    const limits: SpendingLimits = {
      assertWithinLimit: async () => {
        if (exhausted) throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
      },
      status: async () => ({ state: "ok" as const, scope: "user" as const, period: "month" as const, share: 0, resetsAt: null }),
    };
    const turnNotStarted = vi.fn<TurnNotStartedHandler>();
    const { service, model } = setup([step(call("build"))], { tools: { build }, limits, turnNotStarted });
    const chat = await service.createChat("anna");
    const first = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "сделай сайт")));
    await started;
    await service.steer("anna", chat.id, userMessage("p1", "синим"));
    exhausted = true;
    release();
    await first;
    expect(await service.subscribe("anna", chat.id)).toBeNull();
    const { messages, running } = await service.getHistory("anna", chat.id);
    expect(running).toBe(false);
    expect(messages.map((message) => message.id).at(-1)).toBe("p1");
    expect(model.doStreamCalls).toHaveLength(1);
    expect(turnNotStarted).toHaveBeenCalledWith(expect.objectContaining({ action: "send", messageId: "p1", reason: "spending_limit" }));
  });

  it("ход ждёт подтверждения, а поправка не стала ходом (лимит) — запрос всё равно закрыт отказом, карточка не висит", async () => {
    const { build, release, started } = slowBuild();
    const remove = vi.fn(async () => "удалено");
    let exhausted = false;
    const limits: SpendingLimits = {
      assertWithinLimit: async () => {
        if (exhausted) throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
      },
      status: async () => ({ state: "ok" as const, scope: "user" as const, period: "month" as const, share: 0, resetsAt: null }),
    };
    const turnNotStarted = vi.fn<TurnNotStartedHandler>();
    const { service, model } = setup([step(call("build", "c1"), call("remove", "c2"))], {
      tools: { build, remove: tool({ description: "Удалить", inputSchema: z.object({}), needsApproval: true, execute: remove }) },
      limits,
      turnNotStarted,
    });
    const chat = await service.createChat("anna");
    const first = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "собери и удали старое")));
    await started;
    await service.steer("anna", chat.id, userMessage("p1", "старое не удаляй"));
    exhausted = true;
    release();
    await first;
    expect(await service.subscribe("anna", chat.id)).toBeNull();
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages[1]!.metadata?.status).toBe("complete");
    expect(messages[1]!.parts.find((part) => part.type === "tool-remove")).toMatchObject({ state: "output-denied", approval: { approved: false } });
    expect(remove).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(1);
    expect(turnNotStarted).toHaveBeenCalledWith(expect.objectContaining({ messageId: "p1", reason: "spending_limit" }));
  });

  it("ход на другой копии сервера — отказ «занято», поправка не записана", async () => {
    const { build, release, started } = slowBuild();
    const storage = createInMemoryChatStorage();
    const { service } = setup([step(call("build"))], { tools: { build }, storage });
    const other = setup([], { storage }).service;
    const chat = await service.createChat("anna");
    const first = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "сделай сайт")));
    await started;
    await expect(other.steer("anna", chat.id, userMessage("p1", "синим"))).rejects.toBeInstanceOf(ChatBusyError);
    expect((await storage.listMessages(chat.id)).some((message) => message.id === "p1")).toBe(false);
    release();
    await first;
  });

  it("история другой копии видит брошенный ответ и за хвостом поправок", async () => {
    const { build, release, started } = slowBuild();
    const storage = createInMemoryChatStorage();
    const { service } = setup([step(call("build"))], { tools: { build }, storage });
    const other = setup([], { storage }).service;
    const chat = await service.createChat("anna");
    const first = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "сделай сайт")));
    await started;
    await service.steer("anna", chat.id, userMessage("p1", "синим"));
    expect((await other.peekHistory("anna", chat.id)).detachedAnswer).toBe(true);
    release();
    await first;
    await nextTurn(service, chat.id);
  });
});

describe("поправка на лету: служебная заметка продолжения", () => {
  const promptText = (prompt: ModelMessage[]) => JSON.stringify(prompt);
  /** Все тексты последнего сообщения человека, вместе с застывшими блоками хода (дата, место). */
  const lastUserTail = (prompt: ModelMessage[]) => JSON.stringify(prompt.at(-1));

  it("продолжение после поправки получает место (`page.place`) из запроса поправки, а не из начала хода", async () => {
    const { build, release, started } = slowBuild();
    const look = tool({ description: "Посмотреть сайт", inputSchema: z.object({}), execute: async () => "вижу" });
    const { service, model } = setup([step(call("look", "c0")), step(call("build", "c1"))], { tools: { look, build } });
    const chat = await service.createChat("anna");
    const first = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "сделай сайт"), { page: { place: { description: "Версия 1" } } }));
    await started;
    await service.steer("anna", chat.id, userMessage("p1", "сделай синим"), { page: { place: { description: "Версия 2" } } });
    release();
    await first;
    await nextTurn(service, chat.id);

    // Прошлый запрос — второй шаг первого ответа: в нём уже вопрос, шаг a1 с инструментом и его результат.
    const [, before, after] = model.doStreamCalls;
    expect(promptText(before!.prompt)).toContain("Версия 1");
    expect(before!.prompt.map((message) => message.role)).toEqual(["system", "user", "assistant", "tool"]);
    // Свежая заметка — в хвосте поправки; заметка первого ответа осталась при своём вопросе: начало запроса прежнее.
    expect(lastUserTail(after!.prompt)).toContain("Версия 2");
    expect(lastUserTail(after!.prompt)).not.toContain("Версия 1");
    // Кэш: все сообщения прошлого запроса побайтно те же, новое — только после них.
    expect(after!.prompt.slice(0, before!.prompt.length).map((message) => JSON.stringify(message))).toEqual(before!.prompt.map((message) => JSON.stringify(message)));
  });

  it("несколько поправок: продолжение берёт место последней; поправка без места — место начала хода (оно не изменилось, блока нет)", async () => {
    const { build, release, started } = slowBuild();
    const { service, model } = setup([step(call("build"))], { tools: { build } });
    const chat = await service.createChat("anna");
    const first = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "сделай сайт"), { page: { place: { description: "Версия 1" } } }));
    await started;
    await service.steer("anna", chat.id, userMessage("p1", "сделай синим"), { page: { place: { description: "Версия 2" } } });
    await service.steer("anna", chat.id, userMessage("p2", "и крупнее"), { page: { place: { description: "Версия 3" } } });
    release();
    await first;
    await nextTurn(service, chat.id);
    const tail = lastUserTail(model.doStreamCalls[1]!.prompt);
    expect(tail).toContain("Версия 3");
    expect(tail).not.toContain("Версия 2");

    const second = slowBuild();
    const again = setup([step(call("build"))], { tools: { build: second.build } });
    const chat2 = await again.service.createChat("anna");
    const run = readAll(await again.service.sendMessage("anna", chat2.id, userMessage("u1", "сделай сайт"), { page: { place: { description: "Версия 1" } } }));
    await second.started;
    await again.service.steer("anna", chat2.id, userMessage("p1", "сделай синим"));
    second.release();
    await run;
    await nextTurn(again.service, chat2.id);
    // Застывшие блоки повторяются, только когда изменились: место начала хода то же — в хвосте поправки его нет.
    expect(lastUserTail(again.model.doStreamCalls[1]!.prompt)).not.toContain("screen_place");
    expect(promptText(again.model.doStreamCalls[1]!.prompt)).toContain("Версия 1");
  });

  it("поправка прислала только вкладку: место начала хода не стёрто — блок не повторён и не отменён", async () => {
    const { build, release, started } = slowBuild();
    const { service, model } = setup([step(call("build"))], { tools: { build } });
    const chat = await service.createChat("anna");
    const first = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "сделай сайт"), { page: { place: { description: "Версия 1" }, tabId: "t1" } }));
    await started;
    await service.steer("anna", chat.id, userMessage("p1", "сделай синим"), { page: { tabId: "t2" } });
    release();
    await first;
    await nextTurn(service, chat.id);
    const tail = lastUserTail(model.doStreamCalls[1]!.prompt);
    expect(tail).not.toContain("Больше не действует");
    expect(tail).not.toContain("screen_place");
  });
});
