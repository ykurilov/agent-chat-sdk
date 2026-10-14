import { describe, expect, it, vi } from "vitest";
import type { ChatEvent, PrepareTurn, UsageRecord } from "../../../src/index";
import { SpendingLimitReachedError } from "../../../src/spending/spending-limits";
import type { SpendingLimits } from "../../../src/spending/spending-limits";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import type { DeliverNoticesInput } from "../../../src/notices/agent-notice";
import { finishPart, readAll, streamStart, textParts } from "../support/mock-model";
import { doneNotice, noticeService, scriptedModel, textsOf, userMessage, waitTurn } from "../support/notice-chat";

// 5 января 2031, 10:00 UTC: в Новосибирске (UTC+7) воскресенье 5-е, на Киритимати (UTC+14) — уже понедельник 6-е.
const FIXED = new Date(Date.UTC(2031, 0, 5, 10, 0));

function setup(extra: Parameters<typeof noticeService>[1] = {}, scripts: Parameters<typeof scriptedModel>[0] = []) {
  const storage = createInMemoryChatStorage();
  const written: UsageRecord[] = [];
  const insert = storage.insertUsageRecord.bind(storage);
  storage.insertUsageRecord = async (record) => {
    written.push(record);
    return insert(record);
  };
  const model = scriptedModel(scripts);
  const { service } = noticeService(model, { storage, now: () => FIXED, ...extra, agent: { timeZone: "Asia/Novosibirsk", ...extra.agent } });
  const events: ChatEvent[] = [];
  service.subscribeEvents((event) => void events.push(event));
  return { model, service, storage, written, events };
}

const notice = (chatId: string, extra: Partial<DeliverNoticesInput> = {}): DeliverNoticesInput => ({
  ownerId: "anna",
  chatId,
  notices: [doneNotice("Отчёт", "готово")],
  wakeAgent: true,
  deliveryKey: "k1",
  ...extra,
});

const todayOf = (call: { prompt: Parameters<typeof textsOf>[0][] }) => call.prompt.flatMap(textsOf).filter((text) => text.startsWith("Сегодня:"));

describe("061 T203: deliverNotices({ timeZone })", () => {
  it("пояс хода — из запроса: дата в запросе и prepareTurn.timeZone", async () => {
    const prepareTurn = vi.fn<PrepareTurn>(() => undefined);
    const { model, service } = setup({ agent: { prepareTurn } });
    const chat = await service.createChat("anna");
    await service.deliverNotices(notice(chat.id, { timeZone: "Pacific/Kiritimati" }));
    await waitTurn(service, chat.id);
    expect(todayOf(model.doStreamCalls[0]!)).toContain("Сегодня: понедельник, 6 января 2031 г.");
    expect(prepareTurn.mock.calls[0]![0].timeZone).toBe("Pacific/Kiritimati");
  });

  it("неверный пояс — пояс службы", async () => {
    const { model, service } = setup();
    const chat = await service.createChat("anna");
    await service.deliverNotices(notice(chat.id, { timeZone: "Луна/Море_Спокойствия" }));
    await waitTurn(service, chat.id);
    expect(todayOf(model.doStreamCalls[0]!)).toContain("Сегодня: воскресенье, 5 января 2031 г.");
  });
});

describe("061 T203: deliverNotices({ awaitAnswer: true })", () => {
  it("результат ждёт конец хода и отдаёт готовый ответ; чат к этому мигу свободен", async () => {
    const { service, events } = setup();
    const chat = await service.createChat("anna");
    const result = await service.deliverNotices(notice(chat.id, { awaitAnswer: true }));
    expect(result).toMatchObject({ status: "delivered", turnStarted: true });
    const { messages, running } = await service.getHistory("anna", chat.id);
    expect(running).toBe(false);
    const answer = messages.at(-1)!;
    expect(result.answer).toEqual({ messageId: answer.id, text: "ответ 1", status: "complete" });
    // Доставит приложение: каналы SDK по этому событию ход не провожают.
    expect(events).toContainEqual(expect.objectContaining({ type: "turn-started", messageId: answer.id, trigger: "notice", deliveredByApp: true }));
  });

  it("без awaitAnswer — как прежде: результат сразу, ответа в нём нет, событие без deliveredByApp", async () => {
    const { service, events } = setup();
    const chat = await service.createChat("anna");
    const result = await service.deliverNotices(notice(chat.id));
    expect(result).toEqual({ status: "delivered", messageId: expect.any(String), turnStarted: true });
    await waitTurn(service, chat.id);
    const started = events.find((event) => event.type === "turn-started")!;
    expect("deliveredByApp" in started).toBe(false);
  });

  it("текст ответа — текстовые части подряд, без рассуждений и инструментов", async () => {
    const { service } = setup({}, [[streamStart, ...textParts(["Привет, ", "Анна."]), finishPart()]]);
    const chat = await service.createChat("anna");
    const result = await service.deliverNotices(notice(chat.id, { awaitAnswer: true }));
    expect(result.answer?.text).toBe("Привет, Анна.");
  });

  it("готовый текст (reply) с awaitAnswer — он же в ответе", async () => {
    const { model, service } = setup();
    const chat = await service.createChat("anna");
    const result = await service.deliverNotices(notice(chat.id, { awaitAnswer: true, reply: { text: "Доброе утро!" } }));
    expect(model.doStreamCalls).toHaveLength(0);
    expect(result.answer).toMatchObject({ text: "Доброе утро!", status: "complete" });
  });

  it("занятый чат — busy без ответа и без записи", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let gated = true;
    // Ход человека держится на проверке перед ходом, а ход уже запускается: чат занят.
    const { service, storage } = setup({ agent: { prepareTurn: () => (gated ? gate.then(() => undefined) : undefined) } });
    const chat = await service.createChat("anna");
    const sending = service.sendMessage("anna", chat.id, userMessage("u1", "привет"));
    await vi.waitFor(async () => expect((await service.getHistory("anna", chat.id)).running).toBe(true));
    expect(await service.deliverNotices(notice(chat.id, { awaitAnswer: true }))).toEqual({ status: "busy", turnStarted: false });
    gated = false;
    release();
    await readAll(await sending);
    expect((await storage.listMessages(chat.id)).map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("лимит исчерпан — сообщение записано без хода, ответа нет", async () => {
    const limits: SpendingLimits = {
      assertWithinLimit: vi.fn(async () => {
        throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
      }),
      status: vi.fn(async () => ({ state: "exhausted" as const, scope: "user" as const, period: "month" as const, share: 1, resetsAt: null })),
    };
    const { model, service } = setup({ limits });
    const chat = await service.createChat("anna");
    const result = await service.deliverNotices(notice(chat.id, { awaitAnswer: true }));
    expect(result).toEqual({ status: "delivered", messageId: expect.any(String), turnStarted: false });
    expect(model.doStreamCalls).toHaveLength(0);
  });
});

describe("061 T203: deliverNotices({ usageSource })", () => {
  it("first_message — своя метка расхода хода; без настройки — answer", async () => {
    const { service, written } = setup();
    const chat = await service.createChat("anna");
    await service.deliverNotices(notice(chat.id, { awaitAnswer: true, usageSource: "first_message" }));
    expect(written.map((record) => record.source)).toEqual(["first_message"]);
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    expect(written.map((record) => record.source)).toEqual(["first_message", "answer"]);
  });
});
