import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_MODE_NOTE, DEFAULT_VOICE_MODE_HINT, createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { finishPart, mockCatalog, mockEnv, mockModel, readAll, reasoningAndTextParts, streamOf, streamStart, withoutToday } from "./support/mock-model";

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });
const VOICE = { voiceMode: true };

function setup(agent: Partial<ChatServiceOptions["agent"]> = {}) {
  const model = mockModel(() => streamOf(reasoningAndTextParts(["Ответ"])));
  const storage = createInMemoryChatStorage();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    agent: { instructions: "Ты помощник.", ...agent },
    env: mockEnv,
    logError: () => {},
  });
  return { service, storage, model };
}

/** Сообщения запроса на n-м вызове модели (без инструкции): для каждого — его текстовые части. */
function promptParts(model: ReturnType<typeof setup>["model"], call = 0): string[][] {
  return model.doStreamCalls[call]!.prompt
    .filter((message) => message.role !== "system")
    .map((message) =>
      withoutToday((message.content as Array<{ type: string; text?: string }>).filter((part) => part.type === "text").map((part) => part.text!)),
    );
}

const HINT = "ВХОД В ГОЛОС";
const NOTE = "ВОЗВРАТ К ТЕКСТУ";
const custom = { voiceModeHint: HINT, textModeNote: NOTE };

describe("служба чата: пометки голосового режима (FR-023)", () => {
  it("первое голосовое сообщение: подсказка по умолчанию — отдельной частью в конце этого сообщения, лишних сообщений нет", async () => {
    const { service, model } = setup();
    const chat = await service.createChat("anna");

    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Как дела?"), VOICE));

    const messages = promptParts(model);
    expect(messages).toHaveLength(1);
    expect(messages[0]![0]).toBe("Как дела?");
    expect(messages[0]![1]).toBe(DEFAULT_VOICE_MODE_HINT);
    expect(DEFAULT_VOICE_MODE_HINT).toMatch(/коротко и разговорно/i);
  });

  it("свои тексты пометок из настроек агента вместо умолчаний", async () => {
    const { service, model } = setup({ voiceModeHint: "Говори как диктор.", textModeNote: "Снова текст." });
    const chat = await service.createChat("anna");

    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет"), VOICE));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Пишу")));

    expect(promptParts(model, 1)).toEqual([["Привет", "Говори как диктор."], ["Ответ"], ["Пишу", "Снова текст."]]);
  });

  it("возврат к тексту по умолчанию: служебная пометка, что ответ не озвучивается", async () => {
    const { service, model } = setup();
    const chat = await service.createChat("anna");

    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет"), VOICE));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Пишу")));

    expect(promptParts(model, 1)[2]).toEqual(["Пишу", DEFAULT_TEXT_MODE_NOTE]);
    expect(DEFAULT_TEXT_MODE_NOTE).toMatch(/Служебная пометка приложения/);
    expect(DEFAULT_TEXT_MODE_NOTE).toMatch(/текстом/);
  });

  it("вход один раз, возврат один раз, повторный вход — снова пометка", async () => {
    const { service, model } = setup(custom);
    const chat = await service.createChat("anna");

    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "раз"), VOICE));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "два"), VOICE));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u3", "три")));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u4", "четыре")));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u5", "пять"), VOICE));

    expect(promptParts(model, 4)).toEqual([
      ["раз", HINT],
      ["Ответ"],
      ["два"],
      ["Ответ"],
      ["три", NOTE],
      ["Ответ"],
      ["четыре"],
      ["Ответ"],
      ["пять", HINT],
    ]);
  });

  it("обычный чат: ни подсказок, ни пометок", async () => {
    const { service, model } = setup(custom);
    const chat = await service.createChat("anna");

    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Ещё"), { voiceMode: false }));

    expect(promptParts(model, 1)).toEqual([["Привет"], ["Ответ"], ["Ещё"]]);
  });

  it("кэш: запрос каждого следующего хода начинается с тех же сообщений, что запрос предыдущего, включая пометки", async () => {
    const { service, model } = setup(custom);
    const chat = await service.createChat("anna");

    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "раз"), VOICE));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "два"), VOICE));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u3", "три")));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u4", "четыре"), VOICE));

    for (let call = 1; call < model.doStreamCalls.length; call++) {
      const previous = promptParts(model, call - 1);
      expect(promptParts(model, call).slice(0, previous.length)).toEqual(previous);
      expect(JSON.stringify(model.doStreamCalls[call]!.prompt[0])).toBe(JSON.stringify(model.doStreamCalls[0]!.prompt[0]));
    }
  });

  it("отметка хранится в сообщении человека и не рисуется текстом; текст подсказки в историю не пишется", async () => {
    const { service, storage } = setup(custom);
    const chat = await service.createChat("anna");

    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет"), VOICE));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Пишу")));

    const [voice, , text] = await storage.listMessages(chat.id);
    expect(voice!.parts).toEqual([
      { type: "text", text: "Привет" },
      { type: "data-voice-mode", data: true },
    ]);
    expect(text!.parts).toEqual([{ type: "text", text: "Пишу" }]);
    expect(JSON.stringify(await storage.listMessages(chat.id))).not.toContain(HINT);
    expect(JSON.stringify((await service.getHistory("anna", chat.id)).messages)).not.toContain(NOTE);
  });

  it("отметка не приходит от клиента: свою часть-отметку в сообщении сервер отбрасывает", async () => {
    const { service, storage } = setup(custom);
    const chat = await service.createChat("anna");
    const forged = { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: "Привет" }, { type: "data-voice-mode", data: true }] };

    await readAll(await service.sendMessage("anna", chat.id, forged as never));

    expect((await storage.listMessages(chat.id))[0]!.parts).toEqual([{ type: "text", text: "Привет" }]);
  });

  it("повтор ответа на голосовое сообщение: пометка входа на месте, запрос тот же", async () => {
    const { service, model } = setup(custom);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет"), VOICE));
    const answerId = (await service.getHistory("anna", chat.id)).messages[1]!.id;

    await readAll(await service.regenerate("anna", chat.id, answerId));

    expect(promptParts(model, 1)).toEqual([["Привет", HINT]]);
    expect(promptParts(model, 1)).toEqual(promptParts(model, 0));
  });

  it("повтор ответа на текстовое сообщение после голосового: пометка возврата на месте", async () => {
    const { service, model } = setup(custom);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет"), VOICE));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Пишу")));
    const answerId = (await service.getHistory("anna", chat.id)).messages[3]!.id;

    await readAll(await service.regenerate("anna", chat.id, answerId));

    expect(promptParts(model, 2)).toEqual(promptParts(model, 1));
    expect(promptParts(model, 2)[2]).toEqual(["Пишу", NOTE]);
  });

  it("«Повторить» после пустого ответа (retry) для голосового сообщения: пометка входа на месте", async () => {
    let call = 0;
    const model = mockModel(() => streamOf(call++ === 0 ? [streamStart, finishPart()] : reasoningAndTextParts(["Ответ"])));
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: mockCatalog({ mock: model }),
      agent: { instructions: "Ты помощник.", ...custom },
      env: mockEnv,
      logError: () => {},
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет"), VOICE));

    await readAll(await service.retry("anna", chat.id));

    expect(promptParts(model, 1)).toEqual([["Привет", HINT]]);
    expect(promptParts(model, 1)).toEqual(promptParts(model, 0));
  });

  it("правка голосового сообщения текстом: правка — обычное сообщение, пометок нет; правка сообщения после голоса — возврат остаётся", async () => {
    const { service, model } = setup(custom);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет"), VOICE));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Пишу")));

    await readAll(await service.editMessage("anna", chat.id, "u2", userMessage("u2b", "Пишу иначе")));
    expect(promptParts(model, 2)).toEqual([["Привет", HINT], ["Ответ"], ["Пишу иначе", NOTE]]);

    await readAll(await service.editMessage("anna", chat.id, "u1", userMessage("u1b", "Привет иначе")));
    expect(promptParts(model, 3)).toEqual([["Привет иначе"]]);
  });

  it("продолжение после перезагрузки: новая служба над тем же хранилищем строит те же пометки", async () => {
    const first = setup(custom);
    const chat = await first.service.createChat("anna");
    await readAll(await first.service.sendMessage("anna", chat.id, userMessage("u1", "раз"), VOICE));
    await readAll(await first.service.sendMessage("anna", chat.id, userMessage("u2", "два")));

    const model = mockModel(() => streamOf(reasoningAndTextParts(["Ответ"])));
    const reloaded = createChatService({
      storage: first.storage,
      catalog: mockCatalog({ mock: model }),
      agent: { instructions: "Ты помощник.", ...custom },
      env: mockEnv,
      logError: () => {},
    });
    await readAll(await reloaded.sendMessage("anna", chat.id, userMessage("u3", "три"), VOICE));

    expect(promptParts(model)).toEqual([
      ["раз", HINT],
      ["Ответ"],
      ["два", NOTE],
      ["Ответ"],
      ["три", HINT],
    ]);
    expect(promptParts(model).slice(0, 3)).toEqual(promptParts(first.model, 1));
  });
});
