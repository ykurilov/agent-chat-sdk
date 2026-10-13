import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { catalogWithModel, usage } from "./support/mock-catalog";
import { createTestChat, message } from "./support/test-chat";

function recordingModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: "Ок" });
          controller.enqueue({ type: "text-end", id: "t" });
          controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
          controller.close();
        },
      }),
    }),
  });
}

function setup(agent: { voiceModeHint?: string } = {}) {
  const model = recordingModel();
  const chat = createTestChat({ catalog: catalogWithModel(model), agent: { instructions: "Ты помощник.", ...agent } });
  return { ...chat, model };
}

/** Текстовые части каждого сообщения человека в запросе к модели; без хвоста с сегодняшней датой — он меняется по дням. */
const userTexts = (model: MockLanguageModelV4, call = 0) =>
  model.doStreamCalls[call]!.prompt.filter((item) => item.role === "user").map((item) =>
    (item.content as Array<{ text?: string }>).map((part) => part.text ?? "").filter((text) => !text.startsWith("Сегодня: ")),
  );

describe("обработчик чата: voiceMode в теле POST …/messages", () => {
  it("voiceMode: true — сообщение запоминается голосовым, модель получает подсказку входа в его конце; текста подсказки в истории нет", async () => {
    const { call, createChat, history, model } = setup({ voiceModeHint: "ПОДСКАЗКА" });
    const chatId = await createChat();

    const response = await call("POST", `/${chatId}/messages`, { body: { ...message("u1", "Привет"), voiceMode: true } });
    expect(response.status).toBe(200);
    await response.text();

    expect(userTexts(model)).toEqual([["Привет", "ПОДСКАЗКА"]]);
    const saved = JSON.stringify(await history(chatId));
    expect(saved).toContain("data-voice-mode");
    expect(saved).not.toContain("ПОДСКАЗКА");
  });

  it("без voiceMode или с false — запрос прежний", async () => {
    const { call, createChat, model } = setup({ voiceModeHint: "ПОДСКАЗКА" });
    const chatId = await createChat();

    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();
    await (await call("POST", `/${chatId}/messages`, { body: { ...message("u2", "Ещё"), voiceMode: false } })).text();

    expect(userTexts(model, 0)).toEqual([["Привет"]]);
    expect(userTexts(model, 1)).toEqual([["Привет"], ["Ещё"]]);
  });

  it.each([["строка", "true"], ["число", 1], ["объект", {}], ["null", null]])("voiceMode не булево (%s) — 400 invalid, ничего не записано", async (_name, value) => {
    const { call, createChat, history, model } = setup();
    const chatId = await createChat();

    const response = await call("POST", `/${chatId}/messages`, { body: { ...message("u1", "Привет"), voiceMode: value } });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { kind: "invalid" } });
    expect((await history(chatId)).messages).toEqual([]);
    expect(model.doStreamCalls).toHaveLength(0);
  });
});

describe("обработчик чата: voiceMode в теле POST …/edit (склейка голосовых фраз)", () => {
  const edit = (editedMessageId: string, newId: string, text: string, extra: Record<string, unknown> = {}) => ({
    body: { editedMessageId, message: message(newId, text).message, ...extra },
  });

  it("voiceMode: true — правка запоминается голосовой, модель получает подсказку входа в конце склеенной фразы", async () => {
    const { call, createChat, history, model } = setup({ voiceModeHint: "ПОДСКАЗКА" });
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: { ...message("u1", "Так."), voiceMode: true } })).text();

    const response = await call("POST", `/${chatId}/edit`, edit("u1", "u2", "Так. Дай-ка подумать.", { voiceMode: true }));
    expect(response.status).toBe(200);
    await response.text();

    expect(userTexts(model, 1)).toEqual([["Так. Дай-ка подумать.", "ПОДСКАЗКА"]]);
    expect(JSON.stringify((await history(chatId)).messages[0])).toContain("data-voice-mode");
  });

  it("без voiceMode правка — обычное сообщение, как раньше", async () => {
    const { call, createChat, history, model } = setup({ voiceModeHint: "ПОДСКАЗКА" });
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();

    await (await call("POST", `/${chatId}/edit`, edit("u1", "u2", "Привет иначе"))).text();

    expect(userTexts(model, 1)).toEqual([["Привет иначе"]]);
    expect(JSON.stringify((await history(chatId)).messages[0])).not.toContain("data-voice-mode");
  });

  it.each([["строка", "true"], ["число", 1], ["null", null]])("voiceMode не булево (%s) — 400 invalid, правка не записана", async (_name, value) => {
    const { call, createChat, history, model } = setup();
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();

    const response = await call("POST", `/${chatId}/edit`, edit("u1", "u2", "Иначе", { voiceMode: value }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { kind: "invalid" } });
    expect((await history(chatId)).messages.map((item) => item.id)).toEqual(["u1", expect.any(String)]);
    expect(model.doStreamCalls).toHaveLength(1);
  });
});

describe("обработчик чата: voiceSounds (звуки человека, FR-027)", () => {
  const edit = (editedMessageId: string, newId: string, text: string, extra: Record<string, unknown> = {}) => ({
    body: { editedMessageId, message: message(newId, text).message, ...extra },
  });

  it("POST …/messages: звуки ложатся в отметку сообщения, модель получает пометку звуков; в базе текста пометки нет", async () => {
    const { call, createChat, history, model } = setup({ voiceModeHint: "ПОДСКАЗКА" });
    const chatId = await createChat();

    const response = await call("POST", `/${chatId}/messages`, { body: { ...message("u1", "Ха-ха"), voiceMode: true, voiceSounds: ["laughter"] } });
    expect(response.status).toBe(200);
    await response.text();

    const [texts] = userTexts(model);
    expect(texts).toHaveLength(3);
    expect(texts![2]).toMatch(/смех/);
    const saved = JSON.stringify(await history(chatId));
    expect(saved).toContain('"sounds":["laughter"]');
    expect(saved).not.toContain("Служебная пометка");
  });

  it("POST …/edit: звуки склейки доходят до сообщения", async () => {
    const { call, createChat, history } = setup({ voiceModeHint: "ПОДСКАЗКА" });
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: { ...message("u1", "Ха-ха."), voiceMode: true, voiceSounds: ["laughter"] } })).text();

    await (await call("POST", `/${chatId}/edit`, edit("u1", "u2", "Ха-ха. Ну даёшь.", { voiceMode: true, voiceSounds: ["sigh"] }))).text();

    expect(JSON.stringify((await history(chatId)).messages[0])).toContain('"sounds":["laughter","sigh"]');
  });

  it("POST …/edit: правка обычного сообщения (без голосовой отметки) со звуками — отметка и звуки ставятся только новые", async () => {
    const { call, createChat, history, model } = setup({ voiceModeHint: "ПОДСКАЗКА" });
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();

    await (await call("POST", `/${chatId}/edit`, edit("u1", "u2", "Привет, ха-ха", { voiceMode: true, voiceSounds: ["laughter"] }))).text();

    const saved = JSON.stringify((await history(chatId)).messages[0]);
    expect(saved).toContain("data-voice-mode");
    expect(saved).toContain('"sounds":["laughter"]');
    const [texts] = userTexts(model, 1);
    expect(texts).toHaveLength(3);
    expect(texts![2]).toMatch(/смех/);
  });

  it("POST …/edit: звуки без voiceMode не записываются — правка остаётся обычным сообщением", async () => {
    const { call, createChat, history, model } = setup({ voiceModeHint: "ПОДСКАЗКА" });
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();

    await (await call("POST", `/${chatId}/edit`, edit("u1", "u2", "Привет иначе", { voiceSounds: ["laughter"] }))).text();

    const saved = JSON.stringify((await history(chatId)).messages[0]);
    expect(saved).not.toContain("data-voice-mode");
    expect(saved).not.toContain("laughter");
    expect(userTexts(model, 1)).toEqual([["Привет иначе"]]);
  });

  it.each([
    ["строка", "laughter"],
    ["число", 1],
    ["null", null],
    ["неизвестный вид", ["dance"]],
    ["не строка в списке", [5]],
    ["объект", {}],
  ])("voiceSounds неверное (%s) — 400 invalid, ничего не записано", async (_name, value) => {
    const { call, createChat, history, model } = setup();
    const chatId = await createChat();

    const response = await call("POST", `/${chatId}/messages`, { body: { ...message("u1", "Привет"), voiceMode: true, voiceSounds: value } });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { kind: "invalid" } });
    expect((await history(chatId)).messages).toEqual([]);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("voiceSounds неверное у правки — 400 invalid, правка не записана", async () => {
    const { call, createChat, history } = setup();
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();

    const response = await call("POST", `/${chatId}/edit`, edit("u1", "u2", "Иначе", { voiceMode: true, voiceSounds: ["dance"] }));

    expect(response.status).toBe(400);
    expect((await history(chatId)).messages.map((item) => item.id)).toEqual(["u1", expect.any(String)]);
  });
});
