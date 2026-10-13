import { describe, expect, it } from "vitest";
import { voiceModeHint } from "../../src/agent-run/voice-mode-texts";
import { InvalidMessageError, createChatService } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { mockCatalog, mockEnv, mockModel, readAll, reasoningAndTextParts, reasoningParts, streamOf, streamStart, withoutToday } from "./support/mock-model";

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });
const VOICE = { voiceMode: true };
const HINT = "ВХОД В ГОЛОС";
const NOTE = "ВОЗВРАТ К ТЕКСТУ";

/**
 * Ходы, которые тест назвал «думающими» (`thinkingNext`), зависают на размышлении, пока их не остановят; остальные отвечают «Ответ».
 * Так выглядит фраза «Так.», на которую человек успел добавить продолжение.
 */
function setup() {
  let calls = 0;
  const hanging = new Map<number, () => void>();
  const model = mockModel(({ abortSignal }) => {
    const index = calls++;
    const opened = hanging.get(index);
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
    agent: { instructions: "Ты помощник.", voiceModeHint: HINT, textModeNote: NOTE },
    env: mockEnv,
    logError: () => {},
  });
  /** Следующий вызов модели зависнет; обещание готово, когда модель начала «думать». */
  const thinkingNext = () =>
    new Promise<void>((resolve) => {
      hanging.set(calls, resolve);
    });
  return { service, storage, model, thinkingNext };
}

/** Текстовые части каждого сообщения запроса на n-м вызове модели (без инструкции). */
function promptParts(model: ReturnType<typeof setup>["model"], call: number): string[][] {
  return model.doStreamCalls[call]!.prompt
    .filter((message) => message.role !== "system")
    .map((message) =>
      withoutToday((message.content as Array<{ type: string; text?: string }>).filter((part) => part.type === "text").map((part) => part.text!)),
    );
}

/** Человек сказал «Так.», модель думает, ход остановлен: на сервере вопрос и пустой оборванный ответ. */
async function saidSoAndStopped(world: ReturnType<typeof setup>, chatId: string, id = "u-so") {
  const opened = world.thinkingNext();
  const stream = await world.service.sendMessage("anna", chatId, userMessage(id, "Так."), VOICE);
  await opened;
  const stopped = readAll(stream);
  world.service.stop("anna", chatId);
  await stopped;
}

describe("служба чата: правка голосовой фразы — склейка (FR-026)", () => {
  it("правка с voiceMode: новое сообщение голосовое, модель получает только склеенную фразу с подсказкой входа — ни «Так.», ни пустого ответа", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await saidSoAndStopped(world, chat.id);

    await readAll(await world.service.editMessage("anna", chat.id, "u-so", userMessage("u-glued", "Так. Дай-ка подумать."), VOICE));

    expect(promptParts(world.model, 1)).toEqual([["Так. Дай-ка подумать.", HINT]]);
    const stored = (await world.storage.listMessages(chat.id)).find((message) => message.id === "u-glued")!;
    expect(stored.parts).toEqual([
      { type: "text", text: "Так. Дай-ка подумать." },
      { type: "data-voice-mode", data: { replaces: "u-so" } },
    ]);
  });

  it("в видимой истории: склеенный вопрос и один ответ; старая фраза и пустой ответ остаются в базе, но развилки на экране нет", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await saidSoAndStopped(world, chat.id);

    await readAll(await world.service.editMessage("anna", chat.id, "u-so", userMessage("u-glued", "Так. Дай-ка подумать."), VOICE));

    const history = await world.service.getHistory("anna", chat.id);
    expect(history.messages.map((message) => message.id)).toEqual(["u-glued", expect.any(String)]);
    expect(history.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(history.forks).toEqual([]);
    const stored = await world.storage.listMessages(chat.id);
    expect(stored.map((message) => message.id)).toContain("u-so");
    expect(stored.find((message) => message.id === "u-so")!.parts).toEqual([
      { type: "text", text: "Так." },
      { type: "data-voice-mode", data: true },
    ]);
  });

  it("кэш модели и пометки режима: начало запроса то же, что у прерванного хода; подсказка входа стоит на склеенной фразе, как стояла на «Так.»", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await readAll(await world.service.sendMessage("anna", chat.id, userMessage("u0", "Привет")));
    await saidSoAndStopped(world, chat.id);
    const interrupted = promptParts(world.model, 1);

    await readAll(await world.service.editMessage("anna", chat.id, "u-so", userMessage("u-glued", "Так. Дай-ка подумать."), VOICE));

    expect(interrupted).toEqual([["Привет"], ["Ответ"], ["Так.", HINT]]);
    const glued = promptParts(world.model, 2);
    expect(glued).toEqual([["Привет"], ["Ответ"], ["Так. Дай-ка подумать.", HINT]]);
    expect(glued.slice(0, -1)).toEqual(interrupted.slice(0, -1));
    expect(JSON.stringify(world.model.doStreamCalls[2]!.prompt[0])).toBe(JSON.stringify(world.model.doStreamCalls[1]!.prompt[0]));
  });

  it("склейка повторяется: третья фраза правит склеенную, в запросе одно сообщение со всем текстом", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await saidSoAndStopped(world, chat.id);
    const opened = world.thinkingNext();

    const second = await world.service.editMessage("anna", chat.id, "u-so", userMessage("u-two", "Так. Дай-ка подумать."), VOICE);
    await opened;
    const stopped = readAll(second);
    world.service.stop("anna", chat.id);
    await stopped;
    await readAll(await world.service.editMessage("anna", chat.id, "u-two", userMessage("u-three", "Так. Дай-ка подумать. Найди новости."), VOICE));

    expect(promptParts(world.model, 2)).toEqual([["Так. Дай-ка подумать. Найди новости.", HINT]]);
  });

  it("правка без voiceMode — обычное текстовое сообщение, как раньше; отметку от клиента сервер не принимает", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await readAll(await world.service.sendMessage("anna", chat.id, userMessage("u1", "Привет"), VOICE));
    const forged = { id: "u1b", role: "user" as const, parts: [{ type: "text" as const, text: "Привет иначе" }, { type: "data-voice-mode", data: true }] };

    await readAll(await world.service.editMessage("anna", chat.id, "u1", forged as never));

    expect((await world.storage.listMessages(chat.id)).find((message) => message.id === "u1b")!.parts).toEqual([{ type: "text", text: "Привет иначе" }]);
    expect(promptParts(world.model, 1)).toEqual([["Привет иначе"]]);
  });
});

describe("служба чата: название чата при склейке", () => {
  it("«Так.» было первым сообщением и дало название: склейка меняет его на склеенную фразу", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await saidSoAndStopped(world, chat.id);
    expect((await world.service.getHistory("anna", chat.id)).chat).toBeDefined();
    expect((await world.storage.getChat(chat.id))?.title).toBe("Так.");

    await readAll(await world.service.editMessage("anna", chat.id, "u-so", userMessage("u-glued", "Так. Дай-ка подумать."), VOICE));

    expect((await world.storage.getChat(chat.id))?.title).toBe("Так. Дай-ка подумать.");
  });

  it("название, которое человек задал сам, склейка не трогает", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await saidSoAndStopped(world, chat.id);
    await world.service.renameChat("anna", chat.id, "Мои новости");

    await readAll(await world.service.editMessage("anna", chat.id, "u-so", userMessage("u-glued", "Так. Дай-ка подумать."), VOICE));

    expect((await world.storage.getChat(chat.id))?.title).toBe("Мои новости");
  });

  it("склеивается не первое сообщение чата: название по первому остаётся", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await readAll(await world.service.sendMessage("anna", chat.id, userMessage("u0", "Расскажи про погоду")));
    await saidSoAndStopped(world, chat.id);

    await readAll(await world.service.editMessage("anna", chat.id, "u-so", userMessage("u-glued", "Так. Дай-ка подумать."), VOICE));

    expect((await world.storage.getChat(chat.id))?.title).toBe("Расскажи про погоду");
  });

  it("обычная правка первого сообщения (без voiceMode) название не меняет — как и раньше", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await readAll(await world.service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));

    await readAll(await world.service.editMessage("anna", chat.id, "u1", userMessage("u1b", "Здравствуй")));

    expect((await world.storage.getChat(chat.id))?.title).toBe("Привет");
  });
});

/** «Так.» → «Так. Дай-ка подумать.»: склейка одной фразы, как её делает голосовой режим. */
async function glued(world: ReturnType<typeof setup>, chatId: string, fromId: string, toId: string, text: string) {
  await readAll(await world.service.editMessage("anna", chatId, fromId, userMessage(toId, text), VOICE));
}

describe("служба чата: склейка невидима — переключателя веток нет (FR-026)", () => {
  it("после склейки развилок нет ни в истории, ни в ответе API веток; обрывок остаётся в базе", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await saidSoAndStopped(world, chat.id);
    await glued(world, chat.id, "u-so", "u-glued", "Так. Дай-ка подумать.");

    expect((await world.service.getHistory("anna", chat.id)).forks).toEqual([]);
    expect(await world.service.getBranchForks("anna", chat.id)).toEqual({ forks: [] });
    expect((await world.storage.listMessages(chat.id)).map((message) => message.id)).toContain("u-so");
  });

  it("склейка не первого сообщения: развилок нет, прежние сообщения целы", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await readAll(await world.service.sendMessage("anna", chat.id, userMessage("u0", "Привет")));
    await saidSoAndStopped(world, chat.id);
    await glued(world, chat.id, "u-so", "u-glued", "Так. Дай-ка подумать.");

    const history = await world.service.getHistory("anna", chat.id);
    expect(history.messages.map((message) => message.id)).toEqual(["u0", expect.any(String), "u-glued", expect.any(String)]);
    expect(history.forks).toEqual([]);
  });

  it("склейка повторяется: оба обрывка скрыты, развилок нет", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await saidSoAndStopped(world, chat.id);
    const opened = world.thinkingNext();
    const second = await world.service.editMessage("anna", chat.id, "u-so", userMessage("u-two", "Так. Дай-ка подумать."), VOICE);
    await opened;
    const stopped = readAll(second);
    world.service.stop("anna", chat.id);
    await stopped;
    await glued(world, chat.id, "u-two", "u-three", "Так. Дай-ка подумать. Найди новости.");

    const history = await world.service.getHistory("anna", chat.id);
    expect(history.messages[0]!.id).toBe("u-three");
    expect(history.forks).toEqual([]);
  });

  it("после перезагрузки (новая служба на той же базе) — то же самое: склейку выдаёт отметка в базе, а не память службы", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await saidSoAndStopped(world, chat.id);
    await glued(world, chat.id, "u-so", "u-glued", "Так. Дай-ка подумать.");
    const reopened = createChatService({
      storage: world.storage,
      catalog: mockCatalog({ mock: world.model }),
      agent: { instructions: "Ты помощник." },
      env: mockEnv,
      logError: () => {},
    });

    const history = await reopened.getHistory("anna", chat.id);
    expect(history.messages[0]!.id).toBe("u-glued");
    expect(history.forks).toEqual([]);
  });

  it("обрывок нельзя выбрать: выбор ветки отказывает, текущей остаётся склеенная", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await saidSoAndStopped(world, chat.id);
    await glued(world, chat.id, "u-so", "u-glued", "Так. Дай-ка подумать.");

    await expect(world.service.selectBranch("anna", chat.id, "u-so")).rejects.toBeInstanceOf(InvalidMessageError);

    expect((await world.service.getHistory("anna", chat.id)).messages[0]!.id).toBe("u-glued");
  });

  it("выбор, записанный на обрывок раньше (до этого правила), склеенное сообщение не вытесняет", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await saidSoAndStopped(world, chat.id);
    await glued(world, chat.id, "u-so", "u-glued", "Так. Дай-ка подумать.");
    await world.storage.insertBranchSelection({ id: "old-pick", chatId: chat.id, messageId: "u-so", selectedAt: "2099-01-01T00:00:00.000Z" });

    const history = await world.service.getHistory("anna", chat.id);

    expect(history.messages[0]!.id).toBe("u-glued");
    expect(history.forks).toEqual([]);
  });

  it("человек потом правит склеенное сообщение руками: настоящая развилка 2/2, обрывок в счёт не входит и недоступен", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await saidSoAndStopped(world, chat.id);
    await glued(world, chat.id, "u-so", "u-glued", "Так. Дай-ка подумать.");

    await readAll(await world.service.editMessage("anna", chat.id, "u-glued", userMessage("u-manual", "Совсем другой вопрос")));

    const history = await world.service.getHistory("anna", chat.id);
    expect(history.messages[0]!.id).toBe("u-manual");
    expect(history.forks).toEqual([{ messageId: "u-manual", siblingIds: ["u-glued", "u-manual"] }]);
    // Назад — на склеенное сообщение, дальше обрывка пути нет.
    const back = await world.service.selectBranch("anna", chat.id, "u-glued");
    expect(back.messages[0]!.id).toBe("u-glued");
    expect(back.forks).toEqual([{ messageId: "u-glued", siblingIds: ["u-glued", "u-manual"] }]);
    await expect(world.service.selectBranch("anna", chat.id, "u-so")).rejects.toBeInstanceOf(InvalidMessageError);
  });

  it("правка с voiceMode сообщения, которое голосовым не было, склейкой не считается: прежняя ветка остаётся доступной", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await readAll(await world.service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));

    await glued(world, chat.id, "u1", "u1b", "Привет иначе");

    const stored = (await world.storage.listMessages(chat.id)).find((message) => message.id === "u1b")!;
    expect(stored.parts).toEqual([{ type: "text", text: "Привет иначе" }, { type: "data-voice-mode", data: true }]);
    expect((await world.service.getHistory("anna", chat.id)).forks).toEqual([{ messageId: "u1b", siblingIds: ["u1", "u1b"] }]);
  });

  it("обычная правка текстового сообщения по-прежнему даёт развилку", async () => {
    const world = setup();
    const chat = await world.service.createChat("anna");
    await readAll(await world.service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
    await readAll(await world.service.editMessage("anna", chat.id, "u1", userMessage("u1b", "Привет иначе")));

    expect((await world.service.getHistory("anna", chat.id)).forks).toEqual([{ messageId: "u1b", siblingIds: ["u1", "u1b"] }]);
  });
});

describe("служба чата: голос склеенного сообщения", () => {
  it("склеенное сообщение хранит голос человека, как обычное голосовое: подсказка входа остаётся с набором тегов этого голоса", async () => {
    const model = mockModel(() => streamOf(reasoningAndTextParts(["Ответ"])));
    const storage = createInMemoryChatStorage();
    const service = createChatService({
      storage,
      catalog: mockCatalog({ mock: model }),
      agent: { instructions: "Ты помощник.", voices: { current: async () => "pirate", tagsOf: () => ({ allowed: ["laughs"] }) } },
      env: mockEnv,
      logError: () => {},
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u-so", "Так."), VOICE));

    await readAll(await service.editMessage("anna", chat.id, "u-so", userMessage("u-glued", "Так. Дай-ка подумать."), VOICE));

    const stored = (await storage.listMessages(chat.id)).find((message) => message.id === "u-glued")!;
    expect(stored.parts).toContainEqual({ type: "data-voice-mode", data: { voice: "pirate", replaces: "u-so" } });
    expect(promptParts(model, 1)[0]![1]).toBe(voiceModeHint({ allowed: ["laughs"] }));
  });
});
