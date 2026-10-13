import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverAnswer } from "../src/answer-delivery";
import { createButtonActions } from "../src/button-actions";
import type { AnswerChunk } from "../src/chat-port";
import { MessengerApiError, MessengerBlockedError, MessengerMarkupError } from "../src/messenger-api";
import type { ExternalChat, MessengerAbilities } from "../src/messenger-adapter";
import { messengerTexts } from "../src/messenger-texts";
import { createOutboundQueue } from "../src/outbound-queue";
import { createMemoryMessengerStore } from "../src/store/memory-store";
import type { ConversationKey } from "../src/types";
import { account, createFakeAdapter, groupChat, privateChat } from "./support/fake-adapter";
import { controlledStream, createFakeChatService, streamOf, textAnswer } from "./support/fake-chat-service";

const NOW = Date.UTC(2026, 9, 5, 12, 0);
const key: ConversationKey = { messenger: "telegram", botId: "bot1", externalChatId: "100" };

function setup(abilities: Partial<MessengerAbilities> = {}, chat: ExternalChat = privateChat) {
  const fake = createFakeAdapter({ abilities });
  const store = createMemoryMessengerStore();
  const service = createFakeChatService();
  const blocked: string[] = [];
  const queue = createOutboundQueue({ gapMs: fake.adapter.abilities.editEveryMs, onBlocked: (chatKey) => blocked.push(chatKey) });
  const buttons = createButtonActions({ store, service: service.service });
  const live = controlledStream();
  const deliver = (stream: ReadableStream<AnswerChunk> = live.stream, options: { signal?: AbortSignal; webChatUrl?: (chatId: string) => string; liveDemos?: boolean } = {}) =>
    deliverAnswer({ adapter: fake.adapter, chat, chatKey: "telegram/bot1/100", queue, buttons, key, chatId: "chat-1", stream, ...options });
  return { fake, store, service, queue, buttons, live, blocked, deliver };
}

const delta = (text: string, id = "t1"): AnswerChunk => ({ type: "text-delta", id, delta: text });
const toolStart = (toolCallId: string, toolName: string): AnswerChunk => ({ type: "tool-input-start", toolCallId, toolName });
const toolInput = (toolCallId: string, toolName: string, input: unknown): AnswerChunk => ({ type: "tool-input-available", toolCallId, toolName, input });
const toolOutput = (toolCallId: string, output: unknown = "ok"): AnswerChunk => ({ type: "tool-output-available", toolCallId, output });

describe("доставка ответа", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("короткий ответ — одно сообщение без правок; Markdown → разметка; возвращает текст и номер ответа", async () => {
    const { fake, deliver } = setup();
    const outcome = await deliver(streamOf(textAnswer("Привет, **Анна**!", "answer-7")));
    expect(fake.sent.map((item) => item.message)).toEqual([{ text: "Привет, <b>Анна</b>!", markup: "html" }]);
    expect(fake.edits).toEqual([]);
    expect(fake.typing).toHaveLength(1);
    expect(outcome).toMatchObject({ status: "finished", messageId: "answer-7", text: "Привет, **Анна**!" });
    expect(outcome.sent).toHaveLength(1);
  });

  it("живая демонстрация: у агента включены демонстрации — фраза «доступна на сайте», выключены — блок кодом (043)", async () => {
    const answer = "Смотрите:\n\n```html-demo\n<p>x</p>\n```";
    const on = setup();
    await on.deliver(streamOf(textAnswer(answer)), { liveDemos: true });
    expect(on.fake.texts()).toEqual(["Смотрите:\n\nДемонстрация доступна на сайте."]);
    const off = setup();
    await off.deliver(streamOf(textAnswer(answer)));
    expect(off.fake.texts()).toEqual(["Смотрите:\n\n<pre>&lt;p&gt;x&lt;/p&gt;</pre>"]);
  });

  it("событие приложения (data-app-event) в потоке — не в тексте человеку", async () => {
    const { fake, deliver } = setup();
    const [start, ...rest] = textAnswer("Работа принята: зачёт.", "answer-8");
    const finish = rest.pop()!;
    const event = { type: "data-app-event", data: { type: "lesson_passed", data: { lesson: 3 } } } as unknown as AnswerChunk;
    const outcome = await deliver(streamOf([start!, ...rest, event, finish]));
    expect(fake.texts()).toEqual(["Работа принята: зачёт."]);
    expect(JSON.stringify(fake.sent)).not.toContain("lesson_passed");
    expect(outcome).toMatchObject({ status: "finished", messageId: "answer-8", text: "Работа принята: зачёт." });
  });

  it("правки (по умолчанию): первое сообщение после ~40 знаков, дальше правки не чаще editEveryMs, итог полный", async () => {
    const { fake, live, deliver } = setup();
    const done = deliver();
    live.push({ type: "start", messageId: "a1" }, { type: "text-start", id: "t1" }, delta("Короткое начало "));
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.sent).toEqual([]);
    live.push(delta("и ещё немного текста, чтобы перевалить за порог"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.sent).toHaveLength(1);
    for (let index = 0; index < 10; index++) {
      live.push(delta(` слово${index}`));
      await vi.advanceTimersByTimeAsync(100);
    }
    // 1000 мс прошло с первого сообщения: ровно одна правка с последним текстом на тот момент.
    expect(fake.edits).toHaveLength(1);
    live.push(delta(" конец."), { type: "text-end", id: "t1" }, { type: "finish" });
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    const full = "Короткое начало и ещё немного текста, чтобы перевалить за порог слово0 слово1 слово2 слово3 слово4 слово5 слово6 слово7 слово8 слово9 конец.";
    expect(fake.texts()).toEqual([full]);
    expect(fake.edits.at(-1)?.message.text).toBe(full);
    expect(fake.edits.length).toBeLessThanOrEqual(3);
  });

  it("правки и в группе, даже если мессенджер умеет черновик", async () => {
    const { fake, live, deliver } = setup({ liveText: "draft" }, groupChat);
    const done = deliver();
    live.push({ type: "text-start", id: "t1" }, delta("Текст длиннее сорока знаков, чтобы появилось сообщение."));
    await vi.advanceTimersByTimeAsync(0);
    live.push(delta(" Ещё."), { type: "finish" });
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(fake.drafts).toEqual([]);
    expect(fake.texts()).toEqual(["Текст длиннее сорока знаков, чтобы появилось сообщение. Ещё."]);
  });

  it("черновик в личном чате: не чаще editEveryMs, в конце обычное сообщение", async () => {
    const { fake, live, deliver } = setup({ liveText: "draft" });
    const done = deliver();
    live.push({ type: "text-start", id: "t1" }, delta("Раз"));
    await vi.advanceTimersByTimeAsync(0);
    live.push(delta(" два"));
    await vi.advanceTimersByTimeAsync(500);
    live.push(delta(" три"));
    await vi.advanceTimersByTimeAsync(500);
    expect(fake.drafts.map((draft) => [draft.text, draft.at - NOW])).toEqual([
      ["Раз", 0],
      ["Раз два три", 1000],
    ]);
    live.push({ type: "finish" });
    await done;
    expect(fake.texts()).toEqual(["Раз два три"]);
    expect(fake.edits).toEqual([]);
  });

  it("без печати по ходу: «печатает…» раз в 4 с, затем готовый ответ", async () => {
    const { fake, live, deliver } = setup({ liveText: "none" });
    const done = deliver();
    live.push({ type: "text-start", id: "t1" }, delta("Долгий ответ, который набирается больше десяти секунд."));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake.sent).toEqual([]);
    expect(fake.typing.map((item) => item.at - NOW)).toEqual([0, 4000, 8000]);
    live.push({ type: "finish" });
    await done;
    expect(fake.texts()).toEqual(["Долгий ответ, который набирается больше десяти секунд."]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake.typing).toHaveLength(3);
  });

  it("части текста разделены пустой строкой; длинный ответ режется на сообщения по абзацам", async () => {
    const { fake, deliver } = setup({ textLimit: 120 });
    const paragraph = (index: number) => `Абзац ${index}: ${"слово ".repeat(8).trim()}.`;
    const outcome = await deliver(
      streamOf([
        { type: "text-start", id: "t1" },
        delta(`${paragraph(1)}\n\n${paragraph(2)}`, "t1"),
        { type: "text-end", id: "t1" },
        toolStart("c1", "web_search"),
        toolOutput("c1"),
        { type: "text-start", id: "t2" },
        delta(`${paragraph(3)}\n\n${paragraph(4)}`, "t2"),
        { type: "finish" },
      ]),
    );
    expect(outcome.text).toBe(`${paragraph(1)}\n\n${paragraph(2)}\n\n${paragraph(3)}\n\n${paragraph(4)}`);
    const texts = fake.texts();
    expect(texts.length).toBeGreaterThan(1);
    for (const text of texts) expect((text ?? "").length).toBeLessThanOrEqual(120);
    expect(texts.join("\n\n")).toBe(outcome.text);
  });

  it("правки: первая часть длинного ответа закрывается, дальше — новое сообщение", async () => {
    const { fake, live, deliver } = setup({ textLimit: 100 });
    const done = deliver();
    const first = `Первый абзац, достаточно длинный для сообщения: ${"а".repeat(30)}.`;
    live.push({ type: "text-start", id: "t1" }, delta(first));
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.sent).toHaveLength(1);
    live.push(delta(`\n\nВторой абзац, тоже длинный: ${"б".repeat(40)}.`));
    await vi.advanceTimersByTimeAsync(1000);
    live.push({ type: "finish" });
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(fake.texts()).toEqual([first, `Второй абзац, тоже длинный: ${"б".repeat(40)}.`]);
  });

  it("мессенджер не принял разметку — тот же кусок простым текстом", async () => {
    const { fake, deliver } = setup();
    fake.failures.send.push(new MessengerMarkupError("can't parse entities"));
    await deliver(streamOf(textAnswer("Жирный **текст** & <тег>")));
    expect(fake.sent.map((item) => item.message)).toEqual([{ text: "Жирный текст & <тег>", markup: "plain" }]);
  });

  it("шаг начат заново у другого провайдера (data-step-reset): текст шага стирается из живого сообщения и итога", async () => {
    const { fake, live, deliver } = setup();
    const done = deliver();
    live.push({ type: "start", messageId: "a1" }, { type: "start-step" }, { type: "text-start", id: "t1" }, delta("Первый шаг готов."), { type: "text-end", id: "t1" }, { type: "finish-step" });
    live.push({ type: "start-step" }, { type: "text-start", id: "t2" }, delta("Стёртое начало второго шага, длиннее сорока знаков.", "t2"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.texts()).toEqual(["Первый шаг готов.\n\nСтёртое начало второго шага, длиннее сорока знаков."]);
    live.push({ type: "text-end", id: "t2" }, { type: "data-step-reset", data: { providerId: "backup" } } as unknown as AnswerChunk);
    live.push({ type: "start-step" }, { type: "text-start", id: "t3" }, delta("Ответ запасного.", "t3"), { type: "text-end", id: "t3" }, { type: "finish" });
    await vi.advanceTimersByTimeAsync(1000);
    const outcome = await done;
    expect(outcome.text).toBe("Первый шаг готов.\n\nОтвет запасного.");
    expect(fake.texts()).toEqual(["Первый шаг готов.\n\nОтвет запасного."]);
    expect(fake.sent).toHaveLength(1);
  });

  it("шаги могут стираться (data-steps-may-reset): длинный шаг не уходит постоянными сообщениями до конца шага — стёртое не остаётся", async () => {
    const { fake, live, deliver } = setup({ textLimit: 100 });
    const done = deliver();
    const armed = { type: "data-steps-may-reset", data: true, transient: true } as unknown as AnswerChunk;
    live.push({ type: "start", messageId: "a1" }, armed, { type: "start-step" }, { type: "text-start", id: "t1" }, delta("Первый шаг готов."), { type: "text-end", id: "t1" }, { type: "finish-step" });
    live.push({ type: "start-step" }, { type: "text-start", id: "t2" }, delta(`Стёртый абзац, длинный: ${"а".repeat(60)}.\n\nСтёртый второй: ${"б".repeat(60)}.`, "t2"));
    await vi.advanceTimersByTimeAsync(1000);
    live.push({ type: "data-step-reset", data: { providerId: "backup" } } as unknown as AnswerChunk);
    live.push({ type: "start-step" }, { type: "text-start", id: "t3" }, delta("Ответ запасного.", "t3"), { type: "text-end", id: "t3" }, { type: "finish" });
    await vi.advanceTimersByTimeAsync(2000);
    const outcome = await done;
    expect(outcome.text).toBe("Первый шаг готов.\n\nОтвет запасного.");
    expect(fake.texts()).toEqual(["Первый шаг готов.\n\nОтвет запасного."]);
  });

  it("без пометки data-steps-may-reset длинный шаг уходит частями по ходу, как раньше", async () => {
    const { fake, live, deliver } = setup({ textLimit: 100 });
    const done = deliver();
    live.push({ type: "start", messageId: "a1" }, { type: "start-step" }, { type: "text-start", id: "t1" }, delta(`Абзац один: ${"а".repeat(60)}.\n\nАбзац два: ${"б".repeat(60)}.`));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.sent.length).toBeGreaterThanOrEqual(1);
    expect(fake.texts()[0]).toBe(`Абзац один: ${"а".repeat(60)}.`);
    live.push({ type: "finish" });
    await vi.advanceTimersByTimeAsync(2000);
    await done;
  });

  for (const liveText of ["edit", "draft"] as const) {
    it(`стёрт весь текст (${liveText}): живое сообщение не держит стёртое — показана фраза «пишу заново»`, async () => {
      const { fake, live, deliver } = setup({ liveText });
      const shown = () => (liveText === "draft" ? [fake.drafts.at(-1)?.text] : fake.texts());
      const done = deliver();
      live.push({ type: "start", messageId: "a1" }, { type: "start-step" }, { type: "text-start", id: "t1" }, delta("Стёртое начало шага, длиннее сорока знаков точно."));
      await vi.advanceTimersByTimeAsync(1000);
      expect(shown()).toEqual(["Стёртое начало шага, длиннее сорока знаков точно."]);
      live.push({ type: "data-step-reset", data: { providerId: "backup" } } as unknown as AnswerChunk);
      await vi.advanceTimersByTimeAsync(1000);
      expect(shown()).toEqual([messengerTexts.rewritingAnswer]);
      live.push({ type: "start-step" }, { type: "text-start", id: "t2" }, delta("Ответ запасного.", "t2"), { type: "finish" });
      await vi.advanceTimersByTimeAsync(2000);
      await done;
      expect(fake.texts()).toEqual(["Ответ запасного."]);
    });
  }

  it("строка статуса: вызов инструмента — одна меняющаяся строка, исчезает с текстом", async () => {
    const { fake, live, deliver } = setup();
    const done = deliver();
    live.push({ type: "start", messageId: "a1" }, toolStart("c1", "web_search"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.texts()).toEqual(["Ищу в интернете…"]);
    live.push(toolInput("c1", "web_search", { query: "погода" }), toolOutput("c1"), toolStart("c2", "read_page"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.texts()).toEqual(["Читаю страницу…"]);
    live.push({ type: "text-start", id: "t1" }, delta("Завтра солнечно."), { type: "finish" });
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(fake.texts()).toEqual(["Завтра солнечно."]);
    expect(fake.sent).toHaveLength(1);
  });

  it("строка статуса после текста — ниже текста, пока идёт инструмент", async () => {
    const { fake, live, deliver } = setup();
    const done = deliver();
    live.push({ type: "text-start", id: "t1" }, delta("Сейчас посмотрю."), { type: "text-end", id: "t1" }, toolStart("c1", "helper_research"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.texts()).toEqual(["Сейчас посмотрю.\n\nПоручил помощнику…"]);
    live.push(toolOutput("c1"), { type: "text-start", id: "t2" }, delta("Нашёл."), { type: "finish" });
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(fake.texts()).toEqual(["Сейчас посмотрю.\n\nНашёл."]);
  });

  it("черновик Telegram не пропадает при долгом инструменте: обновление раньше 30 с", async () => {
    const { fake, live, deliver } = setup({ liveText: "draft" });
    const done = deliver();
    live.push(toolStart("c1", "web_search"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.drafts.map((draft) => draft.text)).toEqual(["Ищу в интернете…"]);
    await vi.advanceTimersByTimeAsync(60_000);
    const times = fake.drafts.map((draft) => draft.at - NOW);
    for (let index = 1; index < times.length; index++) expect((times[index] as number) - (times[index - 1] as number)).toBeLessThan(30_000);
    expect(times.at(-1)).toBeGreaterThan(30_000);
    live.push(toolOutput("c1"), { type: "text-start", id: "t1" }, delta("Готово."), { type: "finish" });
    await done;
    const count = fake.drafts.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.drafts).toHaveLength(count);
    expect(fake.texts()).toEqual(["Готово."]);
  });

  it("подтверждение — карточка с кнопками после текста; нажатие работает", async () => {
    const { fake, service, buttons, deliver } = setup();
    const outcome = await deliver(
      streamOf([
        { type: "text-start", id: "t1" },
        delta("Отправлю письмо."),
        toolStart("c1", "send_email"),
        toolInput("c1", "send_email", { to: "x@y.z" }),
        { type: "tool-approval-request", approvalId: "ap1", toolCallId: "c1" },
        { type: "finish" },
      ]),
    );
    expect(outcome.status).toBe("finished");
    // Пока шёл инструмент, в сообщении была строка статуса; итог — без неё.
    expect(fake.texts()).toEqual(["Отправлю письмо.", "Нужно ваше разрешение: send_email."]);
    const card = fake.sent[1]?.message;
    expect(card?.markup).toBe("plain");
    expect(card?.buttons?.map((row) => row.map((button) => button.text))).toEqual([["Разрешить", "Запретить"], ["Разрешать всегда"]]);
    await buttons.press({ key, adapter: fake.adapter, ownerId: "anna", press: { chat: privateChat, account: account(), buttonId: card?.buttons?.[0]?.[0]?.id as string, callbackId: "cb" } });
    expect(service.approvals).toEqual([{ userId: "anna", chatId: "chat-1", approvalId: "ap1", answer: "allow" }]);
  });

  it("кнопки не отправились — подтверждение словами «да» / «нет»", async () => {
    const { fake, service, buttons, deliver } = setup();
    const answer = textAnswer("Отправлю.");
    answer.splice(-1, 0, toolStart("c1", "send_email"), { type: "tool-approval-request", approvalId: "ap1", toolCallId: "c1" });
    const original = fake.adapter.send.bind(fake.adapter);
    fake.adapter.send = async (chat, message) => {
      if (message.buttons) throw new MessengerApiError("BUTTON_DATA_INVALID", 400);
      return original(chat, message);
    };
    await deliver(streamOf(answer));
    expect(fake.texts()).toEqual(["Отправлю.", "Нужно ваше разрешение: send_email.\nОтветьте «да» или «нет»."]);
    expect(await buttons.answerByWords(key, "anna", "да")).toEqual({ resume: { chatId: "chat-1", stream: null } });
    expect(service.approvals[0]?.approvalId).toBe("ap1");
  });

  it("виджет без ответа — карточка; подсказки ответа — кнопки под итоговым сообщением", async () => {
    const { fake, deliver } = setup();
    await deliver(
      streamOf([
        { type: "text-start", id: "t1" },
        delta("Выберите."),
        toolStart("c1", "suggest_replies"),
        toolInput("c1", "suggest_replies", { replies: ["Да", "Нет"] }),
        toolOutput("c1", "показано"),
        toolStart("c2", "ask_choice"),
        toolInput("c2", "ask_choice", { question: "Какой цвет?", options: ["Синий", "Красный"] }),
        { type: "finish" },
      ]),
    );
    expect(fake.sent.map((item) => [item.message.text, item.message.buttons?.flat().map((button) => button.text)])).toEqual([
      ["Выберите.", ["Да", "Нет"]],
      ["Какой цвет?", ["Синий", "Красный"]],
    ]);
  });

  it("форма — текстом, «Открыть в приложении» при webChatUrl", async () => {
    const { fake, deliver } = setup();
    await deliver(
      streamOf([toolStart("c1", "ask_form"), toolInput("c1", "ask_form", { title: "Заявка", fields: [{ name: "n", label: "Имя", kind: "text" }] }), { type: "finish" }]),
      { webChatUrl: (chatId) => `https://app.test/c/${chatId}` },
    );
    expect(fake.texts()).toEqual(["Заявка\n• Имя\nОтветьте сообщением."]);
    expect(fake.sent.at(-1)?.message.buttons?.flat().map((button) => button.text)).toEqual(["Открыть в приложении"]);
  });

  it("человек заблокировал бота — доставка останавливается, поток закрывается", async () => {
    const { fake, live, blocked, deliver } = setup();
    fake.failures.send.push(new MessengerBlockedError("blocked"));
    const done = deliver();
    live.push({ type: "text-start", id: "t1" }, delta("Текст длиннее сорока знаков, чтобы ушло сообщение."));
    await vi.advanceTimersByTimeAsync(0);
    expect((await done).status).toBe("blocked");
    expect(blocked).toEqual(["telegram/bot1/100"]);
    expect(fake.sent).toEqual([]);
  });

  it("/stop: показанное закрепляется итогом, карточек нет", async () => {
    const { fake, live, deliver } = setup({ liveText: "draft" });
    const abort = new AbortController();
    const done = deliver(live.stream, { signal: abort.signal });
    live.push({ type: "text-start", id: "t1" }, delta("Начал отвечать"), toolStart("c1", "ask_choice"));
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    const outcome = await done;
    expect(outcome.status).toBe("stopped");
    expect(fake.texts()).toEqual(["Начал отвечать"]);
  });

  it("ошибка хода — сохранённый текст и «не получилось ответить»", async () => {
    const { fake, deliver } = setup();
    const outcome = await deliver(streamOf([{ type: "text-start", id: "t1" }, delta("Часть"), { type: "error", errorText: "boom" }]));
    expect(outcome.status).toBe("failed");
    expect(fake.texts()).toEqual(["Часть", "Не получилось ответить. Попробуйте ещё раз."]);
  });

  it("сломанный поток — тоже «не получилось ответить»", async () => {
    const { fake, deliver } = setup();
    const broken = new ReadableStream<AnswerChunk>({
      start(controller) {
        controller.error(new Error("connection reset"));
      },
    });
    expect((await deliver(broken)).status).toBe("failed");
    expect(fake.texts()).toEqual(["Не получилось ответить. Попробуйте ещё раз."]);
  });
});
