import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TOOL_ENDED_NOTE } from "../../src/agent-run/end-turn";
import { SUGGESTIONS_SHOWN_AFTER_ANSWER } from "../../src/agent-run/sealed-answer";
import { newStoredMessage } from "../../src/conversation/types";
import type { AnswerStatus, StoredMessage } from "../../src/conversation/types";
import { finishPart, mockCatalog, mockModelId, readAll, streamStart, textParts } from "./support/mock-model";
import type { WidgetChatSetup } from "./support/widget-chat";
import { CHOICE_INPUT, answerAndFinish, ask, lastAnswer, promptText, scriptedModel, toolPart, userMessage, widgetCall, widgetChat } from "./support/widget-chat";

const QUESTION = "Что соберём первым: игру или сайт?";
const AFTERTHOUGHT = "Жду ваш выбор.";
const BUTTONS = { replies: ["Игру", "Сайт"] };

const flowNote = tool({ description: "Заметка сценария", inputSchema: z.object({ note: z.string() }), execute: async () => "записано" });
const search = tool({ description: "Поиск", inputSchema: z.object({ q: z.string() }), execute: async () => "нашлось" });

/** Шаг модели: текст (если есть), затем вызовы. */
const textStep = (text: string | undefined, id: string, ...calls: LanguageModelV4StreamPart[]): LanguageModelV4StreamPart[] => [
  streamStart,
  ...(text === undefined ? [] : textParts([text], id)),
  ...calls,
  finishPart(calls.length > 0 ? "tool-calls" : "stop"),
];

const texts = (message: { parts: readonly { type: string; text?: string }[] }) => message.parts.flatMap((part) => (part.type === "text" ? [part.text!] : []));
const streamedText = (chunks: readonly { type: string; delta?: string }[]) => chunks.flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta!] : [])).join("");

type Script = LanguageModelV4StreamPart[] | Error;

function chat(scripts: Script[], service: WidgetChatSetup["service"] = {}) {
  return widgetChat(scripts, {
    widgets: { basic: ["suggest_replies", "ask_choice"] },
    agent: { tools: { flow_note: flowNote, search }, serviceTools: ["flow_note"] },
    service,
  });
}

const busy = () => new APICallError({ message: "503", url: "https://p.test", requestBodyValues: {}, statusCode: 503, responseHeaders: { "retry-after-ms": "1" } });

const noMoney = () => new APICallError({ message: "402", url: "https://p.test", requestBodyValues: {}, statusCode: 402, responseBody: "Insufficient Balance", responseHeaders: {} });

type Part = StoredMessage["parts"][number];
const shownButtons: Part[] = [
  { type: "step-start" },
  { type: "text", text: QUESTION, state: "done" },
  { type: "tool-suggest_replies", toolCallId: "s1", state: "output-available", input: BUTTONS, output: "показано" } as Part,
];

/** Чат «c1»: вопрос и записанный ответ с частями `parts` и статусом `status` — для «Повторить». */
async function chatWithAnswer(storage: ReturnType<typeof chat>["storage"], status: AnswerStatus, parts: Part[]) {
  await storage.createChat({ id: "c1", ownerId: "anna", modelId: mockModelId, providerId: "mock" });
  await storage.insertMessage(newStoredMessage({ id: "u1", chatId: "c1", role: "user", parts: [{ type: "text", text: "помоги выбрать" }], createdAt: "2026-01-01T00:00:00.000Z" }));
  await storage.insertMessage(
    newStoredMessage({ id: "a1", chatId: "c1", parentId: "u1", role: "assistant", parts, status, modelId: mockModelId, providerId: "mock", createdAt: "2026-01-01T00:00:01.000Z" }),
  );
}

describe("ответ закрыт подсказками", () => {
  it("вопрос и кнопки → flow_note → дописка: вопрос и заметка на месте, дописки нет ни в потоке, ни в записи", async () => {
    const { service, model, storage } = chat([
      textStep(QUESTION, "t1", widgetCall("s1", "suggest_replies", BUTTONS)),
      textStep(undefined, "t2", widgetCall("n1", "flow_note", { note: "спросил про игру" })),
      textStep(AFTERTHOUGHT, "t3"),
    ]);
    const { chat: started, chunks } = await ask(service);

    expect(model.doStreamCalls).toHaveLength(3);
    expect(streamedText(chunks)).toBe(QUESTION);
    const answer = await lastAnswer(service, started.id);
    expect(answer.metadata?.status).toBe("complete");
    expect(texts(answer)).toEqual([QUESTION]);
    expect(toolPart(answer, "s1")).toMatchObject({ type: "tool-suggest_replies", state: "output-available", output: SUGGESTIONS_SHOWN_AFTER_ANSWER });
    expect(toolPart(answer, "n1")).toMatchObject({ type: "tool-flow_note", state: "output-available", output: "записано" });
    // Модель знает, что ответ закончен; дописки нет и в её следующих запросах
    expect(promptText(model, 1)).toContain(SUGGESTIONS_SHOWN_AFTER_ANSWER);
    // Ответ кончился вызовом: на следующем ходе модель видит отметку конца хода, а не вопрос сразу за результатом
    const stored = (await storage.listMessages(started.id)).filter((message) => message.role === "assistant").at(-1)!;
    expect(stored.parts.at(-1)).toMatchObject({ type: "data-end-turn" });
    await readAll(await service.sendMessage("anna", started.id, userMessage("u2", "Игру")));
    const next = promptText(model, 3);
    expect(next).toContain(TOOL_ENDED_NOTE);
    expect(next).not.toContain(AFTERTHOUGHT);
  });

  it("вопрос и кнопки → дописка: человек получает вопрос, дописка не показывается", async () => {
    const { service, logError, storage } = chat([textStep(QUESTION, "t1", widgetCall("s1", "suggest_replies", BUTTONS)), textStep(AFTERTHOUGHT, "t2")]);
    const { chat: started, chunks } = await ask(service);
    expect(streamedText(chunks)).toBe(QUESTION);
    expect(texts(await lastAnswer(service, started.id))).toEqual([QUESTION]);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("[дописка после подсказок не показана]"));
    const stored = (await storage.listMessages(started.id)).filter((message) => message.role === "assistant").at(-1)!;
    expect(stored.parts.at(-1)).toMatchObject({ type: "data-end-turn" });
  });

  it("вопрос, кнопки и flow_note в одном шаге → дописка: служебный вызов закрытию не мешает", async () => {
    const { service } = chat([
      textStep(QUESTION, "t1", widgetCall("s1", "suggest_replies", BUTTONS), widgetCall("n1", "flow_note", { note: "спросил" })),
      textStep(AFTERTHOUGHT, "t2"),
    ]);
    const { chat: started, chunks } = await ask(service);
    expect(streamedText(chunks)).toBe(QUESTION);
    const answer = await lastAnswer(service, started.id);
    expect(texts(answer)).toEqual([QUESTION]);
    expect(toolPart(answer, "s1")).toMatchObject({ output: SUGGESTIONS_SHOWN_AFTER_ANSWER });
  });

  it("текст, кнопки и поиск в одном шаге → ответ по поиску: ответ не закрыт, текст после поиска остаётся", async () => {
    const ANSWER = "Нашёл три варианта.";
    const { service } = chat([
      textStep("Ищу варианты.", "t1", widgetCall("s1", "suggest_replies", BUTTONS), widgetCall("q1", "search", { q: "игры" })),
      textStep(ANSWER, "t2"),
    ]);
    const { chat: started, chunks } = await ask(service);
    expect(streamedText(chunks)).toContain(ANSWER);
    const answer = await lastAnswer(service, started.id);
    expect(texts(answer)).toEqual(["Ищу варианты.", ANSWER]);
    expect(toolPart(answer, "s1")).toMatchObject({ output: "показано" });
  });

  it("текст и кнопки с ошибкой → пояснение: кнопки не показаны, ответ не закрыт", async () => {
    const AFTER_ERROR = "Выберите: игра или сайт.";
    const { service } = chat([
      textStep(QUESTION, "t1", widgetCall("s1", "suggest_replies", { replies: ["1", "2", "3", "4", "5"] })),
      textStep(AFTER_ERROR, "t2"),
    ]);
    const { chat: started } = await ask(service);
    const answer = await lastAnswer(service, started.id);
    expect(toolPart(answer, "s1")?.state).toBe("output-error");
    expect(texts(answer)).toEqual([QUESTION, AFTER_ERROR]);
  });

  it("пробелы и невидимые знаки вместо текста + кнопки → ответ: невидимый текст ответ не закрывает", async () => {
    const { service } = chat([textStep(" \u200b\n", "t1", widgetCall("s1", "suggest_replies", BUTTONS)), textStep(QUESTION, "t2")]);
    const { chat: started } = await ask(service);
    expect(texts(await lastAnswer(service, started.id))).toContain(QUESTION);
  });

  it("текст, кнопки и вопрос-виджет в одном шаге → ответ человека → текст модели показан", async () => {
    const AFTER_CHOICE = "Отлично, берём Про.";
    const { service } = chat([
      textStep(QUESTION, "t1", widgetCall("s1", "suggest_replies", BUTTONS), widgetCall("w1", "ask_choice", CHOICE_INPUT)),
      textStep(AFTER_CHOICE, "t2"),
    ]);
    const { chat: started } = await ask(service);
    await answerAndFinish(service, started.id, "w1", { выбрано: "Про" });
    const answer = await lastAnswer(service, started.id);
    expect(texts(answer)).toContain(AFTER_CHOICE);
    expect(toolPart(answer, "s1")).toMatchObject({ output: "показано" });
  });

  it.each([
    ["повтор попытки после сбоя связи", busy, "mock"],
    ["запасной провайдер после отказа по деньгам", noMoney, "mock-backup"],
  ] as const)("кнопки → %s → дописка: дописка не показана, вопрос на месте", async (_case, failure, writer) => {
    const after = [textStep(AFTERTHOUGHT, "b1")];
    const primary = scriptedModel([textStep(QUESTION, "t1", widgetCall("s1", "suggest_replies", BUTTONS)), failure(), ...(writer === "mock" ? [after[0]!] : [])]);
    const backup = scriptedModel(writer === "mock-backup" ? after : []);
    const { service, storage } = chat([], { catalog: mockCatalog({ mock: primary, "mock-backup": backup }) });
    const { chat: started, chunks } = await ask(service);
    expect((writer === "mock" ? primary : backup).doStreamCalls).toHaveLength(writer === "mock" ? 3 : 1);
    expect(streamedText(chunks)).toBe(QUESTION);
    const stored = (await storage.listMessages(started.id)).filter((message) => message.role === "assistant").at(-1)!;
    expect(stored.status).toBe("complete");
    expect(texts(stored)).toEqual([QUESTION]);
    expect(stored.parts.at(-1)).toMatchObject({ type: "data-end-turn" });
  });

  it.each<AnswerStatus>(["error", "interrupted", "stopped"])("«Повторить» после ответа %s с вопросом и кнопками: дописка не показана", async (status) => {
    const { service, storage, model } = chat([textStep(AFTERTHOUGHT, "t2")]);
    await chatWithAnswer(storage, status, shownButtons);
    const chunks = await readAll(await service.retry("anna", "c1"));
    expect(model.doStreamCalls).toHaveLength(1);
    expect(streamedText(chunks)).not.toContain(AFTERTHOUGHT);
    const answer = (await storage.listMessages("c1")).filter((message) => message.role === "assistant").at(-1)!;
    expect(texts(answer)).toEqual([QUESTION]);
    expect(answer.parts.at(-1)).toMatchObject({ type: "data-end-turn" });
  });

  it("черновик → поиск → ответ: настоящий ответ после поиска остаётся", async () => {
    const ANSWER = "Нашёл три варианта.";
    const { service } = chat([textStep("Собираю запрос.", "t1", widgetCall("q1", "search", { q: "игры" })), textStep(ANSWER, "t2")]);
    const { chat: started, chunks } = await ask(service);
    expect(streamedText(chunks)).toContain(ANSWER);
    expect(texts(await lastAnswer(service, started.id))).toEqual(["Собираю запрос.", ANSWER]);
  });

  it("черновик → поиск → кнопки без текста → ответ: ответ не закрыт черновиком, ответ после кнопок остаётся", async () => {
    const { service, model } = chat([
      textStep("Собираю запрос.", "t1", widgetCall("q1", "search", { q: "игры" })),
      textStep(undefined, "t2", widgetCall("s1", "suggest_replies", BUTTONS)),
      textStep(QUESTION, "t3"),
    ]);
    const { chat: started } = await ask(service);
    expect(model.doStreamCalls).toHaveLength(3);
    const answer = await lastAnswer(service, started.id);
    expect(texts(answer)).toEqual(["Собираю запрос.", QUESTION]);
    expect(toolPart(answer, "s1")).toMatchObject({ output: "показано" });
  });
});
