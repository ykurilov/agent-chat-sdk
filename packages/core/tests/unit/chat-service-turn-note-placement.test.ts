import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FROZEN_CONTEXT_PART_TYPE } from "../../src/frozen-context/context-blocks";
import { finishPart, readAll, streamStart, textParts } from "./support/mock-model";
import { CHOICE_INPUT, lastAnswer, removeTool, step, userMessage, widgetCall, widgetChat } from "./support/widget-chat";
import type { ChatService } from "../../src/chat-service";

type Prompt = ReturnType<typeof widgetChat>["model"]["doStreamCalls"][number]["prompt"];

const cardOne = { description: "Карточка клиента «ООО Ромашка»" };
const cardTwo = { description: "Карточка клиента «ИП Лютик»" };
const saying = (value: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts([value]), finishPart()];
const removeCall: LanguageModelV4StreamPart = { type: "tool-call", toolCallId: "r1", toolName: "remove", input: JSON.stringify({ path: "/tmp/a" }) };

const bytes = (prompt: Prompt) => prompt.map((message) => JSON.stringify(message));
/** Запрос `next` начинается побайтно с запроса `previous`. */
function expectPrefix(previous: Prompt, next: Prompt) {
  expect(bytes(next).slice(0, previous.length)).toEqual(bytes(previous));
}
const textsOf = (message: Prompt[number]) =>
  typeof message.content === "string" ? [message.content] : message.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`));
const roles = (prompt: Prompt) => prompt.map((message) => message.role);

async function send(service: ChatService, chatId: string, id: string, text: string, place?: { description: string } | null) {
  await readAll(await service.sendMessage("anna", chatId, userMessage(id, text), place === undefined ? {} : { page: { place } }));
}

async function answerWidget(service: ChatService, chatId: string, toolCallId: string, page?: { place?: { description: string } | null }) {
  const result = await service.answerWidget({ chatId, ownerId: "anna", toolCallId, answer: { выбрано: "Про" }, ...(page && { page }) });
  if (result.resumed) await readAll((await service.subscribe("anna", chatId))!);
}

async function answerApproval(service: ChatService, chatId: string, page?: { place?: { description: string } | null }) {
  const answer = await lastAnswer(service, chatId);
  const asked = answer.parts.find((part) => (part as { toolCallId?: string }).toolCallId === "r1") as { approval?: { id: string } };
  const result = await service.answerApproval("anna", chatId, asked.approval!.id, "allow", page);
  if (result.resumed) await readAll((await service.subscribe("anna", chatId))!);
}

describe("заметка хода — у последнего входа хода", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 1, 12));
  });
  afterEach(() => vi.useRealTimers());

  it("ход начат ответом на виджет: свежая заметка — последней, после ответа; начало запроса прежнее", async () => {
    const { service, model } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT)), saying("Беру Про.")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1", "помоги выбрать", cardOne);
    await answerWidget(service, chat.id, "w1", { place: cardTwo });

    const [paused, resumed] = model.doStreamCalls.map((call) => call.prompt);
    expectPrefix(paused!, resumed!);
    expect(roles(resumed!).slice(-3)).toEqual(["assistant", "tool", "user"]);
    expect(textsOf(resumed!.at(-1)!).join("\n")).toContain("ИП Лютик");
    // Вопрос хода — прежний: в нём только старое место.
    expect(JSON.stringify(resumed!.slice(0, paused!.length))).not.toContain("ИП Лютик");
  });

  it("ответ на виджет, ничего не изменилось: запрос как раньше — заметки после ответа нет", async () => {
    const { service, model } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT)), saying("Беру Про.")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1", "помоги выбрать", cardOne);
    await answerWidget(service, chat.id, "w1", { place: cardOne });

    const resumed = model.doStreamCalls[1]!.prompt;
    expect(roles(resumed).slice(-2)).toEqual(["assistant", "tool"]);
    expect(JSON.stringify(resumed).match(/ООО Ромашка/g)).toHaveLength(1);
    expect((await lastAnswer(service, chat.id)).parts.filter((part) => part.type === FROZEN_CONTEXT_PART_TYPE)).toHaveLength(0);
  });

  it("страница без места: место прежнее, заметки нет", async () => {
    const { service, model } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT)), saying("Беру Про.")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1", "помоги выбрать", cardOne);
    await answerWidget(service, chat.id, "w1");

    expect(roles(model.doStreamCalls[1]!.prompt).slice(-2)).toEqual(["assistant", "tool"]);
  });

  it("ход 1 — ответ на виджет, ход 2 — обычное сообщение: начало запроса то же, место не повторяется", async () => {
    const { service, model } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT)), saying("Беру Про."), saying("Пожалуйста.")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1", "помоги выбрать", cardOne);
    await answerWidget(service, chat.id, "w1", { place: cardTwo });
    await send(service, chat.id, "u2", "спасибо", cardTwo);

    const [, resumed, next] = model.doStreamCalls.map((call) => call.prompt);
    expectPrefix(resumed!, next!);
    // Заметка продолжения осталась на своём месте, вопрос 2 — без повтора места.
    expect(textsOf(next!.at(-1)!)).toEqual(["спасибо"]);
    expect(JSON.stringify(next).match(/ИП Лютик/g)).toHaveLength(1);
  });

  it("ход 1 — обычное сообщение, ход 2 — ответ на виджет, ход 3 — снова обычное: каждый запрос начинается с прошлого", async () => {
    const { service, model } = widgetChat([saying("Здравствуйте."), step(widgetCall("w1", "ask_choice", CHOICE_INPUT)), saying("Беру Про."), saying("Пожалуйста.")]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1", "привет", cardOne);
    await send(service, chat.id, "u2", "помоги выбрать", cardOne);
    await answerWidget(service, chat.id, "w1", { place: cardTwo });
    await send(service, chat.id, "u3", "спасибо", cardOne);

    const prompts = model.doStreamCalls.map((call) => call.prompt);
    expect(prompts).toHaveLength(4);
    for (let index = 1; index < prompts.length; index += 1) expectPrefix(prompts[index - 1]!, prompts[index]!);
    // Вопрос 2 без места (оно то же), заметка продолжения — после ответа на виджет.
    expect(textsOf(prompts[1]!.at(-1)!)).toEqual(["помоги выбрать"]);
    expect(textsOf(prompts[2]!.at(-1)!).join("\n")).toContain("ИП Лютик");
    // Ход 3 сравнивает место с заметкой продолжения: Ромашка снова пришла новой.
    expect(textsOf(prompts[3]!.at(-1)!)[0]).toBe("спасибо");
    expect(textsOf(prompts[3]!.at(-1)!).join("\n")).toContain("ООО Ромашка");
  });

  it("два ответа на виджеты подряд: каждая заметка у своего ответа, прошлые не переезжают", async () => {
    const { service, model } = widgetChat([
      step(widgetCall("w1", "ask_choice", CHOICE_INPUT)),
      step(widgetCall("w2", "ask_choice", CHOICE_INPUT)),
      saying("Собираю."),
    ]);
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1", "помоги выбрать", cardOne);
    await answerWidget(service, chat.id, "w1", { place: cardTwo });
    await answerWidget(service, chat.id, "w2", { place: { description: "План приложения" } });

    const prompts = model.doStreamCalls.map((call) => call.prompt);
    expectPrefix(prompts[0]!, prompts[1]!);
    expectPrefix(prompts[1]!, prompts[2]!);
    expect(textsOf(prompts[2]!.at(-1)!).join("\n")).toContain("План приложения");
    expect(roles(prompts[2]!).slice(-6)).toEqual(["assistant", "tool", "user", "assistant", "tool", "user"]);
  });

  it("подтверждение: инструмент выполнен, заметка — после его результата; следующий ход начинается с этого запроса", async () => {
    const execute = vi.fn(async ({ path }: { path: string }) => `удалено ${path}`);
    const { service, model } = widgetChat([step(removeCall), saying("Удалил."), saying("Пожалуйста.")], { agent: { tools: { remove: removeTool(execute) } } });
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1", "удали", cardOne);
    await answerApproval(service, chat.id, { place: cardTwo });

    expect(execute).toHaveBeenCalledTimes(1);
    const [paused, resumed] = model.doStreamCalls.map((call) => call.prompt);
    expectPrefix(paused!, resumed!);
    expect(roles(resumed!).at(-1)).toBe("user");
    expect(textsOf(resumed!.at(-1)!).join("\n")).toContain("ИП Лютик");
    expect(JSON.stringify(resumed!.at(-2))).toContain("удалено /tmp/a");

    await send(service, chat.id, "u2", "спасибо", cardTwo);
    const next = model.doStreamCalls[2]!.prompt;
    expectPrefix(resumed!, next);
    expect(textsOf(next.at(-1)!)).toEqual(["спасибо"]);
  });

  it("«Повторить» после сбоя продолжения: заметка на том же месте, запрос тот же", async () => {
    const { service, model } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT)), new Error("сбой"), saying("Беру Про.")], {
      agent: { providerFallback: false },
    });
    const chat = await service.createChat("anna");
    await send(service, chat.id, "u1", "помоги выбрать", cardOne);
    await answerWidget(service, chat.id, "w1", { place: cardTwo });
    expect((await lastAnswer(service, chat.id)).metadata?.status).not.toBe("complete");

    await readAll(await service.retry("anna", chat.id, { place: cardTwo }));
    const prompts = model.doStreamCalls.map((call) => call.prompt);
    const [failed, retried] = [prompts.at(-2)!, prompts.at(-1)!];
    expect(bytes(retried)).toEqual(bytes(failed));
    expect(textsOf(retried.at(-1)!).join("\n")).toContain("ИП Лютик");
  });
});
