import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentTurnInput } from "../../../src/agent-run/run-agent-turn";
import { STEP_RESET_PART_TYPE } from "../../../src/agent-run/step-reset";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { newStoredMessage } from "../../../src/conversation/types";
import { finishPart, readAll, streamOf, streamStart, textParts } from "../support/mock-model";
import { chatId, runTurn, startTurn, storageWithQuestion, textOf } from "../support/turn-fixtures";

const ANSWER = "Деньги, отложенные сразу, не успевают потратиться. Что будет, если отложить в конце месяца?";
const GARBLE = "\n\nuserНу, наверное, ничего не останется. Кажется, понял.\n\nОн сам просит тест.Вызвать start_quiz.";

const startQuiz = vi.fn(async () => "тест открыт");
const tools = { start_quiz: tool({ description: "Открывает тест.", inputSchema: z.object({}), execute: startQuiz }) };

/** Модель, которая на каждом шаге отдаёт следующий заготовленный поток. */
function steppedModel(steps: LanguageModelV4StreamPart[][]): MockLanguageModelV4 {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const next = steps[step++];
      if (!next) throw new Error(`шаг ${step} не заготовлен`);
      return { stream: streamOf(next) };
    },
  });
}

/** Что видит человек: текст на экране после сбросов шагов. */
function screenText(chunks: readonly UIMessageChunk[]): string {
  const steps: string[][] = [[]];
  for (const chunk of chunks) {
    if (chunk.type === "start-step") steps.push([]);
    else if (chunk.type === STEP_RESET_PART_TYPE) steps.pop();
    else if (chunk.type === "text-delta") steps.at(-1)!.push(chunk.delta);
  }
  return steps.flat().join("");
}

describe("runAgentTurn: ответ, сорвавшийся в кашу", () => {
  it("реплика за человека и вызов после неё: хвост отрезан, вызов не запущен, следующего шага нет, строка в журнал", async () => {
    startQuiz.mockClear();
    const model = steppedModel([
      [streamStart, ...textParts([ANSWER, GARBLE]), { type: "tool-call", toolCallId: "q1", toolName: "start_quiz", input: "{}" }, finishPart("tool-calls")],
      [streamStart, ...textParts(["Тест открылся — отвечай в карточке."]), finishPart()],
    ]);
    const logError = vi.fn();
    const { answer, chunks } = await runTurn(model, { tools, logError });

    expect(answer.status).toBe("complete");
    expect(textOf(answer.parts)).toBe(ANSWER);
    expect(answer.parts.some((part) => part.type.startsWith("tool-"))).toBe(false);
    expect(startQuiz).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(1);
    expect(logError).toHaveBeenCalledWith(
      expect.stringMatching(/^\[хвост обрезан\] чат=chat-1 ответ=a1 модель=mock-model провайдер=mock признаки=role,restart,tool знаков=\d+ вызовов_не_запущено=1$/),
    );
    expect(screenText(chunks)).toBe(ANSWER);
  });

  it("вызов с подтверждением после срыва: запроса подтверждения нет, ход закончен", async () => {
    const deleteAll = vi.fn(async () => "удалено");
    const risky = { delete_all: tool({ description: "Удаляет всё.", inputSchema: z.object({}), needsApproval: true, execute: deleteAll }) };
    const model = steppedModel([
      [streamStart, ...textParts([ANSWER, GARBLE]), { type: "tool-call", toolCallId: "q1", toolName: "delete_all", input: "{}" }, finishPart("tool-calls")],
    ]);
    const { answer, chunks } = await runTurn(model, { tools: risky, logError: () => {} });
    expect(answer.status).toBe("complete");
    expect(chunks.some((chunk) => chunk.type === "tool-approval-request")).toBe(false);
    expect(deleteAll).not.toHaveBeenCalled();
    expect(textOf(answer.parts)).toBe(ANSWER);
  });

  it("вызов до срыва в том же шаге выполнен и остаётся в записи; нового шага нет", async () => {
    startQuiz.mockClear();
    const model = steppedModel([
      [streamStart, { type: "tool-call", toolCallId: "q0", toolName: "start_quiz", input: "{}" }, ...textParts([ANSWER, GARBLE]), finishPart("tool-calls")],
      [streamStart, ...textParts(["ХВОСТ-СЛЕДУЮЩЕГО-ШАГА"]), finishPart()],
    ]);
    const { answer } = await runTurn(model, { tools, logError: () => {} });
    expect(startQuiz).toHaveBeenCalledTimes(1);
    expect(answer.parts.some((part) => part.type === "tool-start_quiz")).toBe(true);
    expect(textOf(answer.parts)).toBe(ANSWER);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("обычный многошаговый ход с <|im_end|> прозой: шаги идут дальше, ничего не обрезано", async () => {
    const search = vi.fn(async () => "найдено");
    const model = steppedModel([
      [streamStart, ...textParts(["Токен <|im_end|> — конец хода. Проверю в документации."]), { type: "tool-call", toolCallId: "q1", toolName: "search", input: "{}" }, finishPart("tool-calls")],
      [streamStart, ...textParts(["Да, это конец хода."]), finishPart()],
    ]);
    const logError = vi.fn();
    const { answer } = await runTurn(model, { tools: { search: tool({ description: "Ищет.", inputSchema: z.object({}), execute: search }) }, logError });
    expect(model.doStreamCalls).toHaveLength(2);
    expect(search).toHaveBeenCalledTimes(1);
    expect(answer.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text)).toEqual([
      "Токен <|im_end|> — конец хода. Проверю в документации.",
      "Да, это конец хода.",
    ]);
    expect(logError).not.toHaveBeenCalledWith(expect.stringContaining("[хвост"));
  });

  it.each([
    ["одна строка user и вызов", "Пример запроса.\nuser\nПривет.\nСейчас проверю."],
    ["ChatML без ограждения и вызов", "Формат такой.\n<|im_start|>user\nПривет<|im_end|>\n<|im_start|>assistant\nЗдравствуйте<|im_end|>\nЭто ChatML."],
    ["два </think> прозой и вызов", "Тег </think> закрывает, а второй </think> лишний. Сейчас проверю."],
  ])("%s: вызов выполнен, ход идёт дальше, ничего не обрезано", async (_name, said) => {
    const search = vi.fn(async () => "найдено");
    const model = steppedModel([
      [streamStart, ...textParts([said]), { type: "tool-call", toolCallId: "q1", toolName: "search", input: "{}" }, finishPart("tool-calls")],
      [streamStart, ...textParts(["Готово."]), finishPart()],
    ]);
    const logError = vi.fn();
    const { answer } = await runTurn(model, { tools: { search: tool({ description: "Ищет.", inputSchema: z.object({}), execute: search }) }, logError });
    expect(model.doStreamCalls).toHaveLength(2);
    expect(search).toHaveBeenCalledTimes(1);
    expect(answer.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text)).toEqual([said, "Готово."]);
    expect(logError).not.toHaveBeenCalledWith(expect.stringContaining("[хвост"));
  });

  it("DeepSeek: </think> в начале второго шага — не срыв, все шаги и вызовы на месте", async () => {
    const search = vi.fn(async () => "найдено");
    const model = steppedModel([
      [streamStart, ...textParts(["Сейчас посмотрю."]), { type: "tool-call", toolCallId: "q1", toolName: "search", input: "{}" }, finishPart("tool-calls")],
      [streamStart, ...textParts(["</think>Нашёл. Проверю ещё."]), { type: "tool-call", toolCallId: "q2", toolName: "search", input: "{}" }, finishPart("tool-calls")],
      [streamStart, ...textParts(["Итог: всё хорошо."]), finishPart()],
    ]);
    const { answer } = await runTurn(model, { tools: { search: tool({ description: "Ищет.", inputSchema: z.object({}), execute: search }) }, logError: () => {} });
    expect(model.doStreamCalls).toHaveLength(3);
    expect(search).toHaveBeenCalledTimes(2);
    expect(textOf(answer.parts)).toContain("Итог: всё хорошо.");
  });

  it("поток не решает на незаконченной строке: «user» в начале куска, дальше — обычное слово", async () => {
    const whole = "Готово.\nusername задаётся в настройках.\nДальше всё как обычно.";
    const model = steppedModel([[streamStart, ...textParts(["Готово.\nuser", "name задаётся в настройках.\n", "Дальше всё как обычно."]), finishPart()]]);
    const { answer, chunks } = await runTurn(model, { logError: () => {} });
    expect(textOf(answer.parts)).toBe(whole);
    expect(screenText(chunks)).toBe(whole);
  });

  it("срыв без текста до него — ответ не режется, строка в журнал", async () => {
    const logError = vi.fn();
    const empty = "</think>…\n\nuser\nА?\n\nuser\nБ?";
    const { answer } = await runTurn(steppedModel([[streamStart, ...textParts([empty]), finishPart()]]), { logError });
    expect(textOf(answer.parts)).toBe(empty);
    expect(logError).toHaveBeenCalledWith(expect.stringMatching(/^\[хвост не обрезан: ответ остался бы пустым\] чат=chat-1 /));
  });

  it("в потоке хвост перестаёт идти, как только строка с признаками закончилась; на экране в конце — обрезанный ответ", async () => {
    const model = steppedModel([[streamStart, ...textParts([ANSWER, "\n\nuserНу ладно.", " Он понял.Дальше спросить\nХВОСТ", "-ПОСЛЕ-СРЫВА"]), finishPart()]]);
    const { answer, chunks } = await runTurn(model, { logError: () => {} });

    const deltas = chunks.flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : []));
    expect(deltas.join("")).not.toContain("ХВОСТ-ПОСЛЕ-СРЫВА");
    expect(textOf(answer.parts)).toBe(ANSWER);
    expect(screenText(chunks)).toBe(ANSWER);
  });

  it.each<[string, Partial<AgentTurnInput>]>([
    ["придержка текста до проверки (web: hold)", { replyChecks: { checks: [], web: "hold" } }],
    ["мессенджер", { replyChecks: { checks: [], web: "replace" }, channel: "telegram" }],
  ])("%s: придержанный текст уходит уже обрезанным", async (_name, extra) => {
    const model = steppedModel([[streamStart, ...textParts([ANSWER, "\n\nuserНу ладно.", " Он понял.Дальше спросить"]), finishPart()]]);
    const { answer, chunks } = await runTurn(model, { ...extra, logError: () => {} });
    expect(textOf(answer.parts)).toBe(ANSWER);
    expect(screenText(chunks)).toBe(ANSWER);
    expect(chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta.includes("userНу"))).toBe(false);
  });

  it("обычный ответ с диалогом по просьбе — как был, без сбросов и строк в журнал", async () => {
    const dialog = "Вот сценарий.\n\nuser\nПривет!\n\nassistant\nЗдравствуйте.Чем помочь?";
    const logError = vi.fn();
    const { answer, chunks } = await runTurn(steppedModel([[streamStart, ...textParts([dialog]), finishPart()]]), { logError });
    expect(textOf(answer.parts)).toBe(dialog);
    expect(chunks.some((chunk) => chunk.type === STEP_RESET_PART_TYPE)).toBe(false);
    expect(logError).not.toHaveBeenCalledWith(expect.stringContaining("[хвост обрезан]"));
  });

  it("старый ответ с кашей в истории: модель видит его обрезанным, запись не меняется, запрос тот же от хода к ходу", async () => {
    const garbled: AgentChatMessage = { id: "a0", role: "assistant", parts: [{ type: "step-start" }, { type: "text", text: ANSWER + GARBLE, state: "done" }] };
    const history: AgentChatMessage[] = [
      { id: "u0", role: "user", parts: [{ type: "text", text: "Расскажи" }] },
      garbled,
      { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] },
    ];
    const storage = await storageWithQuestion();
    await storage.insertMessage(newStoredMessage({ ...garbled, role: "assistant", chatId, createdAt: "2025-12-31T00:00:00.000Z" }));
    const stored = async () => JSON.stringify((await storage.listMessages(chatId)).find((message) => message.id === "a0"));
    const before = await stored();
    const first = steppedModel([[streamStart, ...textParts(["Ок."]), finishPart()]]);
    const second = steppedModel([[streamStart, ...textParts(["Ок."]), finishPart()]]);
    await readAll(startTurn(storage, first, { history }));
    await readAll(startTurn(storage, second, { history, messageId: "a2" }));

    const assistantOf = (model: MockLanguageModelV4) => model.doStreamCalls[0]!.prompt.find((message) => message.role === "assistant")!;
    expect(JSON.stringify(assistantOf(first).content)).toContain(ANSWER);
    expect(JSON.stringify(assistantOf(first).content)).not.toContain("userНу");
    expect(JSON.stringify(first.doStreamCalls[0]!.prompt)).toBe(JSON.stringify(second.doStreamCalls[0]!.prompt));
    expect(await stored()).toBe(before);
    expect(before).toContain("userНу");
  });
});
