import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { createStepCacheMarks } from "../../../src/agent-run/step-cache-mark";

const mark = { openrouter: { cacheControl: { type: "ephemeral" } } };

const user = (text: string, providerOptions?: ModelMessage["providerOptions"]): ModelMessage => ({
  role: "user",
  content: [{ type: "text", text }],
  ...(providerOptions && { providerOptions }),
});
const assistant = (text: string): ModelMessage => ({ role: "assistant", content: [{ type: "text", text }] });
const resultPart = (id: string) => ({ type: "tool-result" as const, toolCallId: id, toolName: "lookup", output: { type: "text" as const, value: "найдено" } });
const toolResult = (...ids: string[]): ModelMessage => ({ role: "tool", content: ids.map(resultPart) });
/** Результаты инструментов с меткой на последнем результате: так метка одна, сколько бы ни было результатов. */
const markedResult = (...ids: string[]): ModelMessage => ({
  role: "tool",
  content: ids.map((id, index) => (index === ids.length - 1 ? { ...resultPart(id), providerOptions: mark } : resultPart(id))),
});

/** Сообщения с меткой (на сообщении или на части), по порядку. */
const marked = (messages: ModelMessage[]) =>
  messages.filter((message) => message.providerOptions?.openrouter || (Array.isArray(message.content) && message.content.some((part) => "providerOptions" in part && part.providerOptions?.openrouter)));

describe("метка кэша на конце шага (createStepCacheMarks)", () => {
  it("провайдер без явных меток: сообщения не трогаются ни на одном шаге — тот же массив", () => {
    const marks = createStepCacheMarks(undefined);
    const step0 = [user("Привет")];
    expect(marks.messagesFor({ messages: step0, stepNumber: 0 })).toBe(step0);
    const step1 = [...step0, assistant("вызов"), toolResult("c1")];
    expect(marks.messagesFor({ messages: step1, stepNumber: 1 })).toBe(step1);
  });

  it("шаг 0: метка уже стоит на последнем сообщении истории — сообщения те же", () => {
    const marks = createStepCacheMarks(mark);
    const step0 = [user("Привет", mark)];
    expect(marks.messagesFor({ messages: step0, stepNumber: 0 })).toBe(step0);
  });

  it("шаг 1: метка на последнем сообщении, остальные сообщения — те же объекты", () => {
    const marks = createStepCacheMarks(mark);
    const question = user("Привет", mark);
    const call = assistant("вызов");
    const result = toolResult("c1");
    const messages = marks.messagesFor({ messages: [question, call, result], stepNumber: 1 });
    expect(messages[0]).toBe(question);
    expect(messages[1]).toBe(call);
    expect(messages[2]).toEqual(markedResult("c1"));
    expect(result).toEqual(toolResult("c1"));
  });

  it("шаг 2: метка прошлого шага, перенесённая AI SDK, снята — на её месте исходное сообщение; новая на конце", () => {
    const marks = createStepCacheMarks(mark);
    const question = user("Привет", mark);
    const firstResult = toolResult("c1");
    const step1 = marks.messagesFor({ messages: [question, assistant("вызов 1"), firstResult], stepNumber: 1 });
    const secondResult = toolResult("c2");
    const step2 = marks.messagesFor({ messages: [...step1, assistant("вызов 2"), secondResult], stepNumber: 2 });
    expect(step2[2]).toBe(firstResult);
    expect(step2.at(-1)).toEqual(markedResult("c2"));
    // метки: последнее сообщение истории и конец шага
    expect(marked(step2)).toEqual([question, step2.at(-1)]);
  });

  it("свои опции последнего сообщения сохраняются рядом с меткой", () => {
    const marks = createStepCacheMarks(mark);
    const own = { ...assistant("ответ"), providerOptions: { other: { flag: true } } } as ModelMessage;
    const [, last] = marks.messagesFor({ messages: [user("Привет", mark), own], stepNumber: 1 });
    expect(last!.providerOptions).toEqual({ other: { flag: true }, ...mark });
  });

  it("несколько результатов инструментов: метка одна — на последнем результате, не на сообщении", () => {
    const marks = createStepCacheMarks(mark);
    const [, , last] = marks.messagesFor({ messages: [user("Привет", mark), assistant("вызовы"), toolResult("c1", "c2", "c3")], stepNumber: 1 });
    expect(last).toEqual(markedResult("c1", "c2", "c3"));
    expect(last!.providerOptions).toBeUndefined();
  });
});
