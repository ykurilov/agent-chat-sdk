import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { readUIMessageStream, tool } from "ai";
import type { UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AfterTurnHandler, AgentChatMessage, ReplyCheck, ReplyCheckInput, ReplyChecksSetting, UsageRecord } from "../../../src/index";
import { STEP_RESET_PART_TYPE, withoutResetSteps } from "../../../src/index";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { finishPart, generateResult, readAll, streamOf, streamStart, textParts } from "../support/mock-model";
import { noticeService, saying, userMessage } from "../support/notice-chat";

/** Модель: ответы хода по сценарию, переписки (`doGenerate`) — по списку. */
function checkedModel(scripts: LanguageModelV4StreamPart[][], rewrites: string[] = []) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => ({ stream: streamOf(scripts[call++] ?? saying(`ответ ${call}`)) }),
    doGenerate: async () => generateResult(rewrites.shift() ?? "", { output: 7 }),
  });
}

function setup(replyChecks: ReplyChecksSetting | undefined, scripts: LanguageModelV4StreamPart[][], extra: Parameters<typeof noticeService>[1] = {}, rewrites: string[] = []) {
  const storage = createInMemoryChatStorage();
  const written: UsageRecord[] = [];
  const insert = storage.insertUsageRecord.bind(storage);
  storage.insertUsageRecord = async (record) => {
    written.push(record);
    return insert(record);
  };
  const logged: string[] = [];
  const afterTurn = vi.fn<AfterTurnHandler>();
  const model = checkedModel(scripts, rewrites);
  const { service } = noticeService(model, { storage, logError: (line) => void logged.push(String(line)), afterTurn, ...(replyChecks && { replyChecks }), ...extra });
  return { service, storage, model, logged, afterTurn, written };
}

const textOf = (message: Pick<AgentChatMessage, "parts">) =>
  message.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text).join("|");

/** Что видит экран: сообщение, собранное из кусков потока, без стёртых шагов. */
async function shownAnswer(chunks: UIMessageChunk[]): Promise<AgentChatMessage> {
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  let last: AgentChatMessage | undefined;
  for await (const message of readUIMessageStream<AgentChatMessage>({ stream })) last = message;
  return { ...last!, parts: withoutResetSteps(last!.parts) };
}

const deltasOf = (chunks: UIMessageChunk[]) => chunks.flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : []));

/** Проверка, которая меняет слово и запоминает, что получила. */
function replacing(from: string, to: string, seen: ReplyCheckInput[] = []): ReplyCheck {
  return async (input) => {
    seen.push(input);
    return input.text.includes(from) ? { text: input.text.replace(from, to), note: `заменено ${from}` } : undefined;
  };
}

async function ask(service: ReturnType<typeof setup>["service"], text = "привет", options?: Parameters<ReturnType<typeof setup>["service"]["sendMessage"]>[3]) {
  const chat = await service.createChat("anna");
  const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", text), options));
  const { messages } = await service.getHistory("anna", chat.id);
  return { chat, chunks, answer: messages.at(-1)! };
}

describe("061 T205: replyChecks — проверка законченного ответа перед записью", () => {
  it("исправленный текст записан, ушёл в afterTurn; заметка проверки — строка в журнал", async () => {
    const { service, afterTurn, logged } = setup([replacing("Пpивет", "Привет")], [saying("Пpивет, Анна!")]);
    const { answer } = await ask(service);
    expect(textOf(answer)).toBe("Привет, Анна!");
    expect(afterTurn).toHaveBeenCalledWith(expect.objectContaining({ text: "Привет, Анна!", status: "complete" }));
    expect(logged.some((line) => line.includes("[replyChecks]") && line.includes("заменено Пpивет") && line.includes(answer.id))).toBe(true);
  });

  it("проверки по очереди: следующая получает текст предыдущей; ответ без правок — без записи в журнал", async () => {
    const second: ReplyCheckInput[] = [];
    const { service, logged } = setup([replacing("A", "Б"), replacing("Б", "В", second)], [saying("A")]);
    const { answer, chat } = await ask(service);
    expect(second[0]).toMatchObject({ text: "Б", ownerId: "anna", chatId: chat.id, messageId: answer.id });
    expect(textOf(answer)).toBe("В");
    const { service: clean, logged: cleanLog } = setup([replacing("нет такого", "x")], [saying("Всё хорошо.")]);
    expect(textOf((await ask(clean)).answer)).toBe("Всё хорошо.");
    expect(cleanLog.filter((line) => line.includes("[replyChecks]"))).toEqual([]);
    expect(logged.length).toBeGreaterThan(0);
  });

  it("правится только последняя текстовая часть; части инструментов не трогаются", async () => {
    const lookup = tool({ description: "Найти.", inputSchema: z.object({}), execute: async () => ({ found: "Пpивет из инструмента" }) });
    const scripts = [
      [streamStart, ...textParts(["Пpивет, ищу."], "t1"), { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: "{}" }, finishPart("tool-calls")],
      [streamStart, ...textParts(["Пpивет, нашёл."], "t2"), finishPart()],
    ] as LanguageModelV4StreamPart[][];
    const { service } = setup([replacing("Пpивет", "Привет")], scripts, { agent: { tools: { lookup } } });
    const { answer } = await ask(service);
    expect(textOf(answer)).toBe("Пpивет, ищу.|Привет, нашёл.");
    expect(JSON.stringify(answer.parts)).toContain("Пpивет из инструмента");
  });

  it("seenTexts: инструкция, блоки контекста, реплики человека, выводы инструментов; прошлые ответы агента — нет", async () => {
    const seen: ReplyCheckInput[] = [];
    const lookup = tool({ description: "Найти.", inputSchema: z.object({}), execute: async () => ({ url: "https://tool.example/x" }) });
    const scripts = [
      saying("Прошлый ответ: https://made-up.example/old"),
      [streamStart, { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: "{}" }, finishPart("tool-calls")],
      saying("Готово."),
    ] as LanguageModelV4StreamPart[][];
    const { service } = setup([replacing("никогда", "x", seen)], scripts, {
      agent: { instructions: "Инструкция: https://instr.example", tools: { lookup }, contextBlocks: () => [{ key: "skills", text: "Блок: https://block.example" }] },
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "первый https://human.example")));
    seen.length = 0;
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "второй")));
    const all = seen[0]!.seenTexts.join("\n");
    for (const expected of ["https://instr.example", "https://block.example", "https://human.example", "второй", "https://tool.example/x"]) expect(all).toContain(expected);
    expect(all).not.toContain("https://made-up.example/old");
  });

  it("rewrite: модель хода, расход answer_correction на этот ответ", async () => {
    const rewriting: ReplyCheck = async ({ text, rewrite }) => ({ text: await rewrite("Ты редактор.", text) });
    const { service, written, model } = setup([rewriting], [saying("Черновик")], {}, ["Чистовик"]);
    const { answer } = await ask(service);
    expect(textOf(answer)).toBe("Чистовик");
    expect(model.doGenerateCalls).toHaveLength(1);
    const call = model.doGenerateCalls[0]!;
    expect(JSON.stringify(call.prompt)).toContain("Ты редактор.");
    expect(JSON.stringify(call.prompt)).toContain("Черновик");
    expect(call.tools ?? []).toEqual([]);
    expect(written.map((record) => [record.source, record.messageId]).sort()).toEqual([
      ["answer", answer.id],
      ["answer_correction", answer.id],
    ]);
  });

  it("проверка упала — текст до неё, строка в журнал; следующие проверки идут", async () => {
    const broken: ReplyCheck = async () => {
      throw new Error("сломалась");
    };
    const { service, logged } = setup([broken, replacing("A", "Б")], [saying("A")]);
    const { answer } = await ask(service);
    expect(textOf(answer)).toBe("Б");
    expect(logged.some((line) => line.includes("[replyChecks]") && line.includes("сломалась"))).toBe(true);
  });

  it("проверка вернула пустой текст (ответ был одной выдуманной ссылкой) — пустое не уходит: текст до неё, строка в журнал", async () => {
    const cutsAll: ReplyCheck = async () => ({ text: "  \n", note: "ссылки вырезаны" });
    const { service, logged } = setup([cutsAll, replacing("https", "https")], [saying("https://fake.example/a")]);
    const { answer } = await ask(service);
    expect(textOf(answer)).toBe("https://fake.example/a");
    expect(logged.some((line) => line.includes("[replyChecks]") && line.includes("пустой текст"))).toBe(true);
  });

  it("не законченный ответ (сбой модели) и готовый текст приложения — не проверяются", async () => {
    const check = vi.fn<ReplyCheck>(async () => ({ text: "x" }));
    const failing = Array.from({ length: 6 }, () => [streamStart, { type: "error", error: new Error("упал") }]) as LanguageModelV4StreamPart[][];
    const { service } = setup([check], failing);
    expect((await ask(service)).answer.metadata?.status).toBe("error");
    expect(check).not.toHaveBeenCalled();
    const { service: replying } = setup([check], [], { beforeTurn: () => ({ reply: { text: "Готовая фраза." } }) });
    expect(textOf((await ask(replying)).answer)).toBe("Готовая фраза.");
    expect(check).not.toHaveBeenCalled();
  });
});

describe("061 T205: настройка replyChecks", () => {
  it("не функция в списке или неизвестный режим веб-чата — TypeError при создании службы", () => {
    expect(() => setup(["нет" as never], [])).toThrow(TypeError);
    expect(() => setup({ checks: [], web: "live" as never }, [])).toThrow(/replace.*hold/);
  });
});

describe("061 T205: поток в веб-чат (В2)", () => {
  it("replace (по умолчанию): печатается как обычно, затем шаг заменяется исправленным; экран = запись", async () => {
    const { service } = setup([replacing("Пpивет", "Привет")], [[streamStart, ...textParts(["Пpи", "вет!"]), finishPart()]]);
    const { chunks, answer } = await ask(service);
    expect(deltasOf(chunks).slice(0, 2)).toEqual(["Пpи", "вет!"]);
    expect(chunks.some((chunk) => chunk.type === STEP_RESET_PART_TYPE)).toBe(true);
    expect(textOf(await shownAnswer(chunks))).toBe("Привет!");
    expect(textOf(answer)).toBe("Привет!");
  });

  it("replace: правка в шаге до последнего — заменяются все шаги от него", async () => {
    const scripts = [
      [streamStart, ...textParts(["Пpивет, ищу."], "t1"), { type: "tool-call", toolCallId: "c1", toolName: "endTurn_like", input: "{}" }, finishPart("tool-calls")],
      [streamStart, finishPart()],
    ] as LanguageModelV4StreamPart[][];
    const endTurnLike = tool({ description: "x", inputSchema: z.object({}), execute: async () => "ok" });
    const { service } = setup([replacing("Пpивет", "Привет")], scripts, { agent: { tools: { endTurn_like: endTurnLike } } });
    const { chunks, answer } = await ask(service);
    expect(textOf(answer)).toBe("Привет, ищу.");
    const shown = await shownAnswer(chunks);
    expect(textOf(shown)).toBe("Привет, ищу.");
    expect(shown.parts.filter((part) => part.type === "text")).toHaveLength(1);
  });

  it("ответ без правки — поток прежний, без сброса шага", async () => {
    const { service } = setup([replacing("нет такого", "x")], [saying("Всё хорошо.")]);
    const { chunks } = await ask(service);
    expect(chunks.some((chunk) => chunk.type === STEP_RESET_PART_TYPE)).toBe(false);
    expect(deltasOf(chunks)).toEqual(["Всё хорошо."]);
  });

  it("hold: исходный текст не печатается, экран получает только проверенный", async () => {
    const { service } = setup({ checks: [replacing("Пpивет", "Привет")], web: "hold" }, [[streamStart, ...textParts(["Пpи", "вет!"]), finishPart()]]);
    const { chunks, answer } = await ask(service);
    expect(deltasOf(chunks)).toEqual(["Привет!"]);
    expect(chunks.some((chunk) => chunk.type === STEP_RESET_PART_TYPE)).toBe(false);
    expect(textOf(await shownAnswer(chunks))).toBe("Привет!");
    expect(textOf(answer)).toBe("Привет!");
  });

  it("hold: текст перед вызовом инструмента уходит сразу, до вызова", async () => {
    const lookup = tool({ description: "Найти.", inputSchema: z.object({}), execute: async () => "ok" });
    const scripts = [
      [streamStart, ...textParts(["Ищу."], "t1"), { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: "{}" }, finishPart("tool-calls")],
      saying("Нашёл."),
    ] as LanguageModelV4StreamPart[][];
    const { service } = setup({ checks: [replacing("нет", "x")], web: "hold" }, scripts, { agent: { tools: { lookup } } });
    const { chunks } = await ask(service);
    const order = chunks.map((chunk) => (chunk.type === "text-delta" ? chunk.delta : chunk.type));
    expect(order.indexOf("Ищу.")).toBeLessThan(order.indexOf("tool-input-available"));
    expect(textOf(await shownAnswer(chunks))).toBe("Ищу.|Нашёл.");
  });

  it("мессенджер (не веб) — текст придерживается и в режиме replace: наружу только проверенный", async () => {
    const { service } = setup([replacing("Пpивет", "Привет")], [[streamStart, ...textParts(["Пpи", "вет!"]), finishPart()]]);
    const { chunks } = await ask(service, "привет", { channel: "telegram" });
    expect(deltasOf(chunks)).toEqual(["Привет!"]);
  });

  it("без replyChecks — поток и запись прежние (тот же набор кусков)", async () => {
    const plain = setup(undefined, [[streamStart, ...textParts(["Пpи", "вет!"]), finishPart()]]);
    const empty = setup([], [[streamStart, ...textParts(["Пpи", "вет!"]), finishPart()]]);
    const strip = (chunks: UIMessageChunk[]) => JSON.stringify(chunks).replace(/"messageId":"[^"]+"/g, "").replace(/"(usage|reasoningDurationsMs)":\{[^}]*\}/g, "");
    expect(strip((await ask(empty.service)).chunks)).toBe(strip((await ask(plain.service)).chunks));
  });
});

describe("061 этап 7: служба сообщает, что проверяет ответы (`checksReplies`)", () => {
  it("есть проверки — true; пустой список и без replyChecks — false", () => {
    expect(setup([replacing("а", "б")], []).service.checksReplies).toBe(true);
    expect(setup({ checks: [replacing("а", "б")], web: "hold" }, []).service.checksReplies).toBe(true);
    expect(setup([], []).service.checksReplies).toBe(false);
    expect(setup(undefined, []).service.checksReplies).toBe(false);
  });
});
