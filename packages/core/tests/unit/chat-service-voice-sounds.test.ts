import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_MODE_HINT, createChatService, voiceSoundsNote } from "../../src/index";
import type { ChatServiceOptions } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { mockCatalog, mockEnv, mockModel, readAll, reasoningAndTextParts, reasoningParts, streamOf, streamStart, withoutToday } from "./support/mock-model";

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });
const HINT = "ВХОД В ГОЛОС";

function setup(agent: Partial<ChatServiceOptions["agent"]> = {}) {
  let calls = 0;
  const hanging = new Map<number, () => void>();
  const model = mockModel(({ abortSignal }) => {
    const opened = hanging.get(calls++);
    if (!opened) return streamOf(reasoningAndTextParts(["Ответ"]));
    return new ReadableStream({
      start(controller) {
        controller.enqueue(streamStart);
        for (const part of reasoningParts()) controller.enqueue(part);
        abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
        opened();
      },
    });
  });
  const storage = createInMemoryChatStorage();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    agent: { instructions: "Ты помощник.", voiceModeHint: HINT, ...agent },
    env: mockEnv,
    logError: () => {},
  });
  const thinkingNext = () => new Promise<void>((resolve) => hanging.set(calls, resolve));
  return { service, storage, model, thinkingNext };
}

function promptParts(model: ReturnType<typeof setup>["model"], call = 0): string[][] {
  return model.doStreamCalls[call]!.prompt
    .filter((message) => message.role !== "system")
    .map((message) => withoutToday((message.content as Array<{ type: string; text?: string }>).filter((part) => part.type === "text").map((part) => part.text!)));
}

const SOUNDS_NOTE = voiceSoundsNote(["laughter"]);

describe("служба чата: звуки человека (FR-027)", () => {
  it("voiceSounds с voiceMode: звуки в отметке сообщения; модель получает пометку звуков после пометки входа; текста пометки в базе нет", async () => {
    const { service, storage, model } = setup();
    const chat = await service.createChat("anna");

    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Ха-ха, смешно"), { voiceMode: true, voiceSounds: ["laughter"] }));

    expect(promptParts(model)).toEqual([["Ха-ха, смешно", HINT, SOUNDS_NOTE]]);
    const stored = (await storage.listMessages(chat.id)).find((message) => message.id === "u1")!;
    expect(stored.parts).toEqual([
      { type: "text", text: "Ха-ха, смешно" },
      { type: "data-voice-mode", data: { sounds: ["laughter"] } },
    ]);
    expect(JSON.stringify(await storage.listMessages(chat.id))).not.toContain("Служебная пометка");
  });

  it("voiceSounds без voiceMode игнорируются: сообщение обычное, запрос прежний", async () => {
    const { service, storage, model } = setup();
    const chat = await service.createChat("anna");

    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет"), { voiceSounds: ["laughter"] }));

    expect(promptParts(model)).toEqual([["Привет"]]);
    expect((await storage.listMessages(chat.id))[0]!.parts).toEqual([{ type: "text", text: "Привет" }]);
  });

  it("пустой список звуков — сообщение как раньше (data: true)", async () => {
    const { service, storage } = setup();
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет"), { voiceMode: true, voiceSounds: [] }));
    expect((await storage.listMessages(chat.id))[0]!.parts).toContainEqual({ type: "data-voice-mode", data: true });
  });

  it("история не меняется задним числом: прежние сообщения идут в запросе теми же, звуки добавляются только своему сообщению", async () => {
    const { service, model } = setup();
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Раз"), { voiceMode: true, voiceSounds: ["laughter"] }));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Два"), { voiceMode: true }));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u3", "Три"), { voiceMode: true, voiceSounds: ["sigh", "cough"] }));

    const second = promptParts(model, 1);
    const third = promptParts(model, 2);
    expect(second).toEqual([["Раз", HINT, SOUNDS_NOTE], ["Ответ"], ["Два"]]);
    expect(third).toEqual([["Раз", HINT, SOUNDS_NOTE], ["Ответ"], ["Два"], ["Ответ"], ["Три", voiceSoundsNote(["sigh", "cough"])]]);
    // Начало запроса то же; у вопроса «Два» в прошлом запросе был хвост с датой — он только в своём запросе (кэш до него).
    expect(JSON.stringify(model.doStreamCalls[2]!.prompt.slice(0, 3))).toBe(JSON.stringify(model.doStreamCalls[1]!.prompt.slice(0, 3)));
  });

  it("повтор ответа и перезагрузка строят те же пометки: запрос идёт из сохранённых отметок", async () => {
    const { service, model } = setup();
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Раз"), { voiceMode: true, voiceSounds: ["laughter"] }));
    const first = model.doStreamCalls[0]!.prompt;

    const history = await service.getHistory("anna", chat.id);
    const answerId = history.messages.find((message) => message.role === "assistant")!.id;
    await readAll(await service.regenerate("anna", chat.id, answerId));

    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toBe(JSON.stringify(first));
  });

  it("правка-склейка сохраняет звуки заменяемого сообщения и добавляет новые, без повторов", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    const opened = world.thinkingNext();
    const stream = await world.service.sendMessage("anna", chat.id, userMessage("u-so", "Ха-ха."), { voiceMode: true, voiceSounds: ["laughter"] });
    await opened;
    const stopped = readAll(stream);
    world.service.stop("anna", chat.id);
    await stopped;

    await readAll(await world.service.editMessage("anna", chat.id, "u-so", userMessage("u-glued", "Ха-ха. Это смешно."), { voiceMode: true, voiceSounds: ["laughter", "sigh"] }));

    const glued = (await world.storage.listMessages(chat.id)).find((message) => message.id === "u-glued")!;
    expect(glued.parts).toContainEqual({ type: "data-voice-mode", data: { replaces: "u-so", sounds: ["laughter", "sigh"] } });
    expect(promptParts(world.model, 1)).toEqual([["Ха-ха. Это смешно.", HINT, voiceSoundsNote(["laughter", "sigh"])]]);
  });

  it("правка-склейка без новых звуков оставляет прежние", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    const opened = world.thinkingNext();
    const stream = await world.service.sendMessage("anna", chat.id, userMessage("u-so", "Ха-ха."), { voiceMode: true, voiceSounds: ["laughter"] });
    await opened;
    const stopped = readAll(stream);
    world.service.stop("anna", chat.id);
    await stopped;

    await readAll(await world.service.editMessage("anna", chat.id, "u-so", userMessage("u-glued", "Ха-ха. Ладно."), { voiceMode: true }));

    expect(promptParts(world.model, 1)).toEqual([["Ха-ха. Ладно.", HINT, SOUNDS_NOTE]]);
  });

  it("пометка входа по умолчанию несёт правило о звуках; свой voiceModeHint правило не получает, а пометка звуков остаётся", async () => {
    expect(DEFAULT_VOICE_MODE_HINT).toMatch(/не каждый раз/);
    const { service, model } = setup({ voiceModeHint: "Своя." });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет"), { voiceMode: true, voiceSounds: ["laughter"] }));
    expect(promptParts(model)).toEqual([["Привет", "Своя.", SOUNDS_NOTE]]);
  });
});
