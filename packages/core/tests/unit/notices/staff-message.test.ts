import { describe, expect, it } from "vitest";
import type { ReplyCheck, ReplyCheckInput } from "../../../src/index";
import { UNANSWERED_NOTE } from "../../../src/agent-run/unanswered-messages";
import { controlledModel, readAll } from "../support/mock-model";
import { askInNewChat, noticeService, saying, scriptedModel, userMessage, waitTurn } from "../support/notice-chat";

// 068: реплика живого сотрудника в истории — не слова человека: модель видит её как слова сотрудника, экран получает её
// сообщением сотрудника, ход сама не запускает. Для проверок ответа агента её текст известен: агент вправе повторить
// ссылку сотрудника. Ссылкой человека (`person_link_view`) она не становится — это проверяет web-tools.

const STAFF_TEXT = "Здравствуйте! Вот запись эфира: https://staff.example/record";

/** Проверка, которая ничего не меняет и запоминает, что получила. */
const watching =
  (seen: ReplyCheckInput[]): ReplyCheck =>
  async (input) => {
    seen.push(input);
  };

const promptOf = (call: { prompt: unknown }) => JSON.stringify(call.prompt);

describe("068: appendStaffMessage — реплика сотрудника", () => {
  it("пишется в конец ветки без хода; модель видит её словами сотрудника в следующем ходе, после прежних сообщений", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await askInNewChat(service);
    const before = promptOf(model.doStreamCalls[0]!);

    const result = await service.appendStaffMessage({ ownerId: "anna", chatId: chat.id, text: STAFF_TEXT, staffName: "Ольга" });
    expect(result).toMatchObject({ status: "delivered", turnStarted: false, messageId: expect.any(String) });
    expect(model.doStreamCalls).toHaveLength(1);

    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "спасибо")));
    const prompt = promptOf(model.doStreamCalls[1]!);
    expect(prompt).toContain(STAFF_TEXT);
    expect(prompt).toContain("Ольга");
    expect(prompt).toMatch(/сотрудник/i);
    // Добавлено в конец: начало запроса прежнее, кэш цел.
    expect(prompt.startsWith(before.slice(0, before.lastIndexOf("]")))).toBe(true);
  });

  it("история для экрана: сообщение сотрудника с текстом и именем, не сообщение человека", async () => {
    const { service } = noticeService(scriptedModel());
    const chat = await askInNewChat(service);
    await service.appendStaffMessage({ ownerId: "anna", chatId: chat.id, text: STAFF_TEXT, staffName: "Ольга" });
    const { messages } = (await service.getHistory("anna", chat.id))!;
    const last = messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.parts).toEqual([
      expect.objectContaining({ type: "data-agent-notice", data: expect.objectContaining({ notices: [{ kind: "staff", title: STAFF_TEXT, staffName: "Ольга" }] }) }),
    ]);
  });

  it("ссылка из реплики сотрудника — известная для проверок ответа агента, в ходе и вне хода", async () => {
    const seen: ReplyCheckInput[] = [];
    const { service } = noticeService(scriptedModel(), { replyChecks: { checks: [watching(seen)] } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "мой сайт https://human.example")));
    await service.appendStaffMessage({ ownerId: "anna", chatId: chat.id, text: STAFF_TEXT });
    seen.length = 0;
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "а что дальше?")));
    const onTurn = seen[0]!.seenTexts.join("\n");
    expect(onTurn).toContain("https://human.example");
    expect(onTurn).toContain("https://staff.example/record");

    seen.length = 0;
    await service.checkReply({ ownerId: "anna", chatId: chat.id, text: "Черновик" });
    expect(seen[0]!.seenTexts.join("\n")).toContain("https://staff.example/record");
  });

  it("wakeAgent — агент отвечает сразу после реплики", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await askInNewChat(service);
    const result = await service.appendStaffMessage({ ownerId: "anna", chatId: chat.id, text: "Передаю разговор агенту", wakeAgent: true });
    expect(result).toMatchObject({ status: "delivered", turnStarted: true });
    await waitTurn(service, chat.id);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(promptOf(model.doStreamCalls[1]!)).toContain("Передаю разговор агенту");
  });

  it("чат занят ходом — busy, ничего не записано; пустой текст — TypeError", async () => {
    const { model, opened, push, end } = controlledModel();
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");
    const stream = await service.sendMessage("anna", chat.id, userMessage("u1", "привет"));
    await opened;
    expect(await service.appendStaffMessage({ ownerId: "anna", chatId: chat.id, text: STAFF_TEXT })).toEqual({ status: "busy", turnStarted: false });
    push(...saying("ок"));
    end();
    await readAll(stream);
    expect((await service.getHistory("anna", chat.id))!.messages).toHaveLength(2);
    await expect(service.appendStaffMessage({ ownerId: "anna", chatId: chat.id, text: "  " })).rejects.toThrow(TypeError);
  });
});

describe("068: реплика сотрудника не выглядит оборванным ходом", () => {
  it("вопрос, реплика сотрудника без хода, новый вопрос — в запросе нет пометки «ход оборвался»", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await askInNewChat(service);
    await service.appendStaffMessage({ ownerId: "anna", chatId: chat.id, text: STAFF_TEXT, staffName: "Ольга" });
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "спасибо")));
    expect(promptOf(model.doStreamCalls[1]!)).not.toContain(UNANSWERED_NOTE);
  });
});
