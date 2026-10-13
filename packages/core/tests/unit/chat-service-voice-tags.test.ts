import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_MODE_HINT, VOICE_TAGS, createChatService, voiceChangeNote, voiceModeHint } from "../../src/index";
import type { ChatServiceOptions } from "../../src/chat-service";
import type { VoiceTagSet } from "../../src/index";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { mockCatalog, mockEnv, mockModel, readAll, reasoningAndTextParts, streamOf, withoutToday } from "./support/mock-model";

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });
const VOICE = { voiceMode: true };

const sets: Record<string, VoiceTagSet | undefined> = {
  narrator: { allowed: ["sighs", "curious"], avoid: ["whispers", "softly"] },
  pirate: { allowed: ["laughs", "wheezing", "low, gravelly voice"] },
  plain: undefined,
  plain2: undefined,
};

/** Голос человека задаёт тест: `voice.current` читается в момент отправки, как каталог голосов. */
function setup(agent: Partial<ChatServiceOptions["agent"]> = {}, initial = "narrator", storage = createInMemoryChatStorage()) {
  const model = mockModel(() => streamOf(reasoningAndTextParts(["Ответ"])));
  const voice = { current: initial };
  const build = () =>
    createChatService({
      storage,
      catalog: mockCatalog({ mock: model }),
      agent: { instructions: "Ты помощник.", voices: { current: async () => voice.current, tagsOf: (id: string) => sets[id] }, ...agent },
      env: mockEnv,
      logError: () => {},
    });
  return { service: build(), rebuild: build, storage, model, voice };
}

function promptParts(model: ReturnType<typeof setup>["model"], call = 0): string[][] {
  return model.doStreamCalls[call]!.prompt
    .filter((message) => message.role !== "system")
    .map((message) => withoutToday((message.content as Array<{ type: string; text?: string }>).filter((part) => part.type === "text").map((part) => part.text!)));
}

const send = async (s: ReturnType<typeof setup>, chatId: string, id: string, text: string, options: { voiceMode?: boolean } = VOICE) =>
  readAll(await s.service.sendMessage("anna", chatId, userMessage(id, text), options));

describe("служба чата: теги голоса (FR-024)", () => {
  it("пометка входа несёт теги текущего голоса; отметка хранит id голоса", async () => {
    const s = setup();
    const chat = await s.service.createChat("anna");

    await send(s, chat.id, "u1", "Привет");

    expect(promptParts(s.model)).toEqual([["Привет", voiceModeHint(sets.narrator)]]);
    const [stored] = await s.storage.listMessages(chat.id);
    expect(stored!.parts).toContainEqual({ type: "data-voice-mode", data: { voice: "narrator" } });
    expect(JSON.stringify(await s.storage.listMessages(chat.id))).not.toContain("Других тегов не ставь");
  });

  it("голос без набора: общая пометка по умолчанию, как без настройки голосов", async () => {
    const s = setup({}, "plain");
    const chat = await s.service.createChat("anna");

    await send(s, chat.id, "u1", "Привет");

    expect(promptParts(s.model)[0]).toEqual(["Привет", DEFAULT_VOICE_MODE_HINT]);
  });

  it("голоса не настроены: отметка прежняя (true), пометка общая, смен нет", async () => {
    const s = setup({ voices: undefined });
    const chat = await s.service.createChat("anna");

    await send(s, chat.id, "u1", "раз");
    s.voice.current = "pirate";
    await send(s, chat.id, "u2", "два");

    expect(promptParts(s.model, 1)).toEqual([["раз", DEFAULT_VOICE_MODE_HINT], ["Ответ"], ["два"]]);
    const [stored] = await s.storage.listMessages(chat.id);
    expect(stored!.parts).toContainEqual({ type: "data-voice-mode", data: true });
  });

  it("голос сменился посреди разговора: пометка со списком нового голоса один раз, на первом сообщении после смены", async () => {
    const s = setup();
    const chat = await s.service.createChat("anna");

    await send(s, chat.id, "u1", "раз");
    await send(s, chat.id, "u2", "два");
    s.voice.current = "pirate";
    await send(s, chat.id, "u3", "три");
    await send(s, chat.id, "u4", "четыре");

    expect(promptParts(s.model, 3)).toEqual([
      ["раз", voiceModeHint(sets.narrator)],
      ["Ответ"],
      ["два"],
      ["Ответ"],
      ["три", voiceChangeNote(sets.pirate)],
      ["Ответ"],
      ["четыре"],
    ]);
  });

  it("у обоих голосов набора нет (общий список): смена голоса пометки не даёт", async () => {
    const s = setup({}, "plain");
    const chat = await s.service.createChat("anna");

    await send(s, chat.id, "u1", "раз");
    s.voice.current = "plain2";
    await send(s, chat.id, "u2", "два");

    expect(promptParts(s.model, 1)).toEqual([["раз", DEFAULT_VOICE_MODE_HINT], ["Ответ"], ["два"]]);
  });

  it("голос с набором сменился на голос без набора: пометка возвращает общий список", async () => {
    const s = setup();
    const chat = await s.service.createChat("anna");

    await send(s, chat.id, "u1", "раз");
    s.voice.current = "plain";
    await send(s, chat.id, "u2", "два");

    const note = promptParts(s.model, 1)[2]![1]!;
    expect(note).toBe(voiceChangeNote(undefined));
    for (const tag of VOICE_TAGS) expect(note).toContain(`[${tag}]`);
  });

  it("смена голоса через текстовый режим: возврат к тексту, потом пометка входа с новым голосом", async () => {
    const s = setup();
    const chat = await s.service.createChat("anna");

    await send(s, chat.id, "u1", "раз");
    await send(s, chat.id, "u2", "два", {});
    s.voice.current = "pirate";
    await send(s, chat.id, "u3", "три");

    const last = promptParts(s.model, 2);
    expect(last[2]![1]).toMatch(/разговор снова идёт текстом/);
    expect(last[4]).toEqual(["три", voiceModeHint(sets.pirate)]);
  });

  it("свой текст пометки входа задан приложением: голосовых пометок о тегах нет, смена голоса тоже ничего не добавляет", async () => {
    const s = setup({ voiceModeHint: "Говори как диктор." });
    const chat = await s.service.createChat("anna");

    await send(s, chat.id, "u1", "раз");
    s.voice.current = "pirate";
    await send(s, chat.id, "u2", "два");

    expect(promptParts(s.model, 1)).toEqual([["раз", "Говори как диктор."], ["Ответ"], ["два"]]);
  });

  it("кэш: запрос каждого хода начинается с тех же сообщений, что запрос предыдущего, и при смене голоса", async () => {
    const s = setup();
    const chat = await s.service.createChat("anna");

    await send(s, chat.id, "u1", "раз");
    await send(s, chat.id, "u2", "два");
    s.voice.current = "pirate";
    await send(s, chat.id, "u3", "три");
    s.voice.current = "narrator";
    await send(s, chat.id, "u4", "четыре");
    await send(s, chat.id, "u5", "пять", {});

    for (let call = 1; call < s.model.doStreamCalls.length; call++) {
      const previous = promptParts(s.model, call - 1);
      expect(promptParts(s.model, call).slice(0, previous.length)).toEqual(previous);
    }
  });

  it("повтор ответа и перезагрузка строят тот же запрос, хотя голос человека уже другой", async () => {
    const s = setup();
    const chat = await s.service.createChat("anna");
    await send(s, chat.id, "u1", "раз");
    s.voice.current = "pirate";
    await send(s, chat.id, "u2", "два");
    const original = promptParts(s.model, 1);
    s.voice.current = "plain";

    const history = await s.service.getHistory("anna", chat.id);
    await readAll(await s.service.regenerate("anna", chat.id, history.messages.at(-1)!.id));
    expect(promptParts(s.model, 2)).toEqual(original);

    const reloaded = s.rebuild();
    const again = await reloaded.getHistory("anna", chat.id);
    await readAll(await reloaded.regenerate("anna", chat.id, again.messages.at(-1)!.id));
    expect(promptParts(s.model, 3)).toEqual(original);
  });

  it("правка последнего сообщения и продолжение не ломают пометки прежних сообщений", async () => {
    const s = setup();
    const chat = await s.service.createChat("anna");
    await send(s, chat.id, "u1", "раз");
    s.voice.current = "pirate";
    await send(s, chat.id, "u2", "два");
    const history = await s.service.getHistory("anna", chat.id);
    const second = history.messages.find((message) => message.id === "u2")!;

    await readAll(await s.service.editMessage("anna", chat.id, second.id, userMessage("u2b", "два, поправлено")));

    const edited = promptParts(s.model, 2);
    expect(edited.slice(0, 2)).toEqual(promptParts(s.model, 1).slice(0, 2));
  });
});
