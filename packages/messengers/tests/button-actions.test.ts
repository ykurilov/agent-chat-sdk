import { ApprovalNotPendingError, ChatBusyError, ChatClosedError, InvalidWidgetAnswerError, TurnRefusedError, WidgetNotPendingError } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { approvalCard, createButtonActions, suggestionRows, widgetCard } from "../src/button-actions";
import type { ButtonPress } from "../src/messenger-adapter";
import { createMemoryMessengerStore } from "../src/store/memory-store";
import type { ConversationKey } from "../src/types";
import { account, createFakeAdapter, privateChat } from "./support/fake-adapter";
import { createFakeChatService } from "./support/fake-chat-service";

const key: ConversationKey = { messenger: "telegram", botId: "bot1", externalChatId: "100" };

function setup() {
  const store = createMemoryMessengerStore();
  const chat = createFakeChatService();
  const fake = createFakeAdapter();
  const buttons = createButtonActions({ store, service: chat.service });
  /** Отправляет карточку и сохраняет её кнопки, как это делает доставка. */
  async function sendCard(card: { text: string; rows: Parameters<typeof buttons.prepare>[1] }) {
    const prepared = buttons.prepare(key, card.rows);
    const sent = await fake.adapter.send(privateChat, { text: card.text, markup: "plain", buttons: prepared.buttons });
    await prepared.save(sent, { text: card.text, markup: "plain" });
    return prepared.buttons;
  }
  const press = (buttonId: string): Promise<Awaited<ReturnType<typeof buttons.press>>> =>
    buttons.press({ key, adapter: fake.adapter, ownerId: "anna", press: { chat: privateChat, account: account(), buttonId, callbackId: `cb-${buttonId}` } satisfies ButtonPress });
  return { store, chat, fake, buttons, sendCard, press };
}

describe("кнопки: короткий номер → действие", () => {
  it("номер — 8 знаков, у каждой кнопки свой; действие отдаётся один раз и только своему чату", async () => {
    const { store, buttons, sendCard } = setup();
    const rows = await sendCard({ text: "?", rows: [[{ text: "A", action: { type: "reply", text: "A" } }], [{ text: "B", action: { type: "reply", text: "B" } }]] });
    const ids = rows.flat().map((button) => button.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(new Set(ids).size).toBe(2);
    expect(await buttons.take({ ...key, externalChatId: "999" }, ids[0] as string)).toBeNull();
    expect(await buttons.take(key, ids[0] as string)).toMatchObject({ type: "reply", text: "A" });
    expect(await buttons.take(key, ids[0] as string)).toBeNull();
    void store;
  });

  it("подтверждение: «Разрешить / Запретить / Разрешать всегда», нажатие — answerApproval и продолжение хода", async () => {
    const { chat, fake, sendCard, press } = setup();
    const card = approvalCard({ chatId: "chat-1", approvalId: "ap1", toolName: "send_email" });
    expect(card.text).toBe("Нужно ваше разрешение: send_email.");
    expect(card.rows.map((row) => row.map((button) => button.text))).toEqual([["Разрешить", "Запретить"], ["Разрешать всегда"]]);
    const rows = await sendCard(card);
    const [allow, deny] = rows[0] ?? [];
    expect(await press(allow?.id as string)).toEqual({ resume: { chatId: "chat-1", stream: null } });
    expect(chat.approvals).toEqual([{ userId: "anna", chatId: "chat-1", approvalId: "ap1", answer: "allow" }]);
    expect(fake.answers.at(-1)).toMatchObject({ text: "Принято." });
    // Повтор той же кнопки — «уже отвечено», инструмент второй раз не запускается.
    expect(await press(allow?.id as string)).toEqual({});
    expect(fake.answers.at(-1)).toMatchObject({ text: "Уже отвечено." });
    // Соседние кнопки карточки отключены: «Запретить» после «Разрешить» до ядра не доходит.
    expect(await press(deny?.id as string)).toEqual({});
    expect(fake.answers.at(-1)).toMatchObject({ text: "Уже отвечено." });
    expect(chat.approvals).toHaveLength(1);
  });

  it("подтверждение уже закрыто в вебе — ядро говорит «не ждёт» → «уже отвечено»", async () => {
    const { chat, fake, sendCard, press } = setup();
    chat.service.approvalResult = () => new ApprovalNotPendingError("ap1");
    const rows = await sendCard(approvalCard({ chatId: "chat-1", approvalId: "ap1", toolName: "x" }));
    expect(await press(rows[0]?.[1]?.id as string)).toEqual({});
    expect(fake.answers.at(-1)).toMatchObject({ text: "Уже отвечено." });
    expect(fake.edits).toEqual([]);
  });

  it("«Разрешать всегда» и ответ без продолжения хода", async () => {
    const { chat, sendCard, press } = setup();
    chat.service.approvalResult = () => ({ resumed: false });
    const rows = await sendCard(approvalCard({ chatId: "chat-1", approvalId: "ap2", toolName: "x" }));
    expect(await press(rows[1]?.[0]?.id as string)).toEqual({});
    expect(chat.approvals[0]?.answer).toBe("always");
  });

  it("занятый чат или сбой службы — «не получилось» и свежие кнопки на той же карточке, повтор работает", async () => {
    const { chat, fake, sendCard, press } = setup();
    chat.service.approvalResult = () => new ChatBusyError("chat-1");
    const card = approvalCard({ chatId: "chat-1", approvalId: "ap3", toolName: "x" });
    const rows = await sendCard(card);
    expect(await press(rows[0]?.[0]?.id as string)).toEqual({});
    expect(fake.answers.at(-1)).toMatchObject({ text: "Не получилось. Попробуйте ещё раз." });
    const restored = fake.edits.at(-1);
    expect(restored?.sent.messageId).toBe(fake.sent[0]?.messageId);
    expect(restored?.message.text).toBe(card.text);
    expect(restored?.message.buttons?.map((row) => row.map((button) => button.text))).toEqual([["Разрешить", "Запретить"], ["Разрешать всегда"]]);
    chat.service.approvalResult = () => ({ resumed: true });
    expect(await press(restored?.message.buttons?.[0]?.[1]?.id as string)).toEqual({ resume: { chatId: "chat-1", stream: null } });
    expect(chat.approvals.at(-1)?.answer).toBe("deny");
  });

  it("приложение отказало в ходе — на кнопку приходит текст отказа, а не «не получилось»", async () => {
    const { chat, fake, sendCard, press } = setup();
    chat.service.approvalResult = () => new TurnRefusedError({ code: "lesson_closed", message: "Урок закрыт" });
    const rows = await sendCard(approvalCard({ chatId: "chat-1", approvalId: "ap5", toolName: "x" }));
    expect(await press(rows[0]?.[0]?.id as string)).toEqual({});
    expect(fake.answers.at(-1)).toMatchObject({ text: "Урок закрыт" });
  });

  it("чат закрыт — на кнопку приходит текст закрытия", async () => {
    const { chat, fake, sendCard, press } = setup();
    chat.service.approvalResult = () => new ChatClosedError({ code: "form_completed", message: "Заявка отправлена." });
    const rows = await sendCard(approvalCard({ chatId: "chat-1", approvalId: "ap6", toolName: "x" }));
    expect(await press(rows[0]?.[0]?.id as string)).toEqual({});
    expect(fake.answers.at(-1)).toMatchObject({ text: "Заявка отправлена." });
  });

  it("одновременные нажатия одной кнопки засчитываются один раз", async () => {
    const { chat, sendCard, press } = setup();
    const rows = await sendCard(approvalCard({ chatId: "chat-1", approvalId: "ap4", toolName: "x" }));
    await Promise.all([1, 2, 3].map(() => press(rows[0]?.[0]?.id as string)));
    expect(chat.approvals).toHaveLength(1);
  });

  it("выбор одного варианта → { выбрано }", async () => {
    const { chat, sendCard, press } = setup();
    const card = widgetCard({ chatId: "chat-1", toolCallId: "w1", toolName: "ask_choice", input: { question: "Какой цвет?", options: ["Синий", "Красный"] } });
    expect(card.text).toBe("Какой цвет?");
    expect(card.rows.map((row) => row.map((button) => button.text))).toEqual([["Синий"], ["Красный"]]);
    const rows = await sendCard(card);
    expect(await press(rows[1]?.[0]?.id as string)).toEqual({ resume: { chatId: "chat-1", stream: null } });
    expect(chat.widgets).toEqual([{ chatId: "chat-1", ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Красный" } }]);
  });

  it("виджет уже закрыт или ответ не подошёл — «уже отвечено» / «не получилось»", async () => {
    const { chat, fake, sendCard, press } = setup();
    const rows = await sendCard(widgetCard({ chatId: "chat-1", toolCallId: "w1", toolName: "ask_choice", input: { question: "?", options: ["a", "b"] } }));
    chat.service.widgetResult = () => new WidgetNotPendingError("w1");
    await press(rows[0]?.[0]?.id as string);
    expect(fake.answers.at(-1)).toMatchObject({ text: "Уже отвечено." });
    // Соседняя кнопка уже погасла вместе с нажатой.
    await press(rows[1]?.[0]?.id as string);
    expect(chat.widgets).toHaveLength(1);
    chat.service.widgetResult = () => new InvalidWidgetAnswerError("w2");
    const fresh = await sendCard(widgetCard({ chatId: "chat-1", toolCallId: "w2", toolName: "ask_choice", input: { question: "?", options: ["a", "b"] } }));
    await press(fresh[1]?.[0]?.id as string);
    expect(fake.answers.at(-1)).toMatchObject({ text: "Не получилось. Попробуйте ещё раз." });
  });

  it("оценка: звёзды 1–5 и шкала с подписями краёв → { оценка }", async () => {
    const { chat, sendCard, press } = setup();
    const stars = widgetCard({ chatId: "chat-1", toolCallId: "r1", toolName: "ask_rating", input: { question: "Как вам?", scale: "stars" } });
    expect(stars.rows.flat().map((button) => button.text)).toEqual(["1 ★", "2 ★", "3 ★", "4 ★", "5 ★"]);
    const range = widgetCard({ chatId: "chat-1", toolCallId: "r2", toolName: "ask_rating", input: { question: "Шанс?", scale: "range", from: 0, to: 10, fromLabel: "никогда", toLabel: "точно" } });
    expect(range.text).toBe("Шанс?\n0 — никогда, 10 — точно");
    expect(range.rows.flat().map((button) => button.text)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(range.rows.every((row) => row.length <= 6)).toBe(true);
    const rows = await sendCard(stars);
    await press(rows[0]?.[3]?.id as string);
    expect(chat.widgets[0]?.answer).toEqual({ оценка: 4 });
  });

  it("несколько вариантов: нажатие отмечает вариант в том же сообщении, «Готово» — когда выбрано от min до max", async () => {
    const { chat, fake, sendCard, press } = setup();
    const card = widgetCard({ chatId: "chat-1", toolCallId: "m1", toolName: "ask_multi_choice", input: { question: "Что взять?", options: ["Чай", "Кофе", "Сок"], min: 2 } });
    expect(card.text).toBe("Что взять?\nВыберите варианты и нажмите «Готово».");
    expect(card.rows.map((row) => row.map((button) => button.text))).toEqual([["◻️ Чай"], ["◻️ Кофе"], ["◻️ Сок"]]);
    const first = await sendCard(card);
    // Сок, потом чай: после второго — «Готово».
    expect(await press(first[2]?.[0]?.id as string)).toEqual({});
    const afterOne = fake.edits.at(-1);
    expect(afterOne?.sent.messageId).toBe(fake.sent[0]?.messageId);
    expect(afterOne?.message.buttons?.map((row) => row.map((button) => button.text))).toEqual([["◻️ Чай"], ["◻️ Кофе"], ["✅ Сок"]]);
    await press(afterOne?.message.buttons?.[0]?.[0]?.id as string);
    const afterTwo = fake.edits.at(-1);
    expect(afterTwo?.message.buttons?.map((row) => row.map((button) => button.text))).toEqual([["✅ Чай"], ["◻️ Кофе"], ["✅ Сок"], ["Готово"]]);
    expect(afterTwo?.message.text).toBe(card.text);
    expect(await press(afterTwo?.message.buttons?.[3]?.[0]?.id as string)).toEqual({ resume: { chatId: "chat-1", stream: null } });
    expect(chat.widgets).toEqual([{ chatId: "chat-1", ownerId: "anna", toolCallId: "m1", answer: { выбрано: ["Чай", "Сок"] } }]);
  });

  it("несколько вариантов: больше max не отметить; по умолчанию min 1 и max — все варианты", async () => {
    const { fake, sendCard, press } = setup();
    const card = widgetCard({ chatId: "chat-1", toolCallId: "m2", toolName: "ask_multi_choice", input: { question: "Один?", options: ["a", "b"], max: 1 } });
    const first = await sendCard(card);
    await press(first[0]?.[0]?.id as string);
    const afterOne = fake.edits.at(-1);
    expect(afterOne?.message.buttons?.map((row) => row.map((button) => button.text))).toEqual([["✅ a"], ["◻️ b"], ["Готово"]]);
    await press(afterOne?.message.buttons?.[1]?.[0]?.id as string);
    expect(fake.answers.at(-1)?.text).toBe("Можно выбрать не больше 1.");
    expect(fake.edits).toHaveLength(1);
    // Отказ не тратит кнопки: «b» после снятия «a» снова нажимается.
    await press(afterOne?.message.buttons?.[0]?.[0]?.id as string);
    const cleared = fake.edits.at(-1);
    expect(cleared?.message.buttons?.map((row) => row.map((button) => button.text))).toEqual([["◻️ a"], ["◻️ b"]]);
    const defaults = widgetCard({ chatId: "chat-1", toolCallId: "m3", toolName: "ask_multi_choice", input: { question: "?", options: ["a", "b"] } });
    const rows = await sendCard(defaults);
    await press(rows[0]?.[0]?.id as string);
    await press(fake.edits.at(-1)?.message.buttons?.[1]?.[0]?.id as string);
    expect(fake.edits.at(-1)?.message.buttons?.map((row) => row.map((button) => button.text))).toEqual([["✅ a"], ["✅ b"], ["Готово"]]);
  });

  it("подсказки ответа — кнопки, нажатие уходит агенту обычным сообщением", async () => {
    const { chat, fake, sendCard, press } = setup();
    const rows = await sendCard({ text: "Ответ", rows: suggestionRows(["Да, давай", "Позже"]) });
    expect(rows.map((row) => row.map((button) => button.text))).toEqual([["Да, давай"], ["Позже"]]);
    expect(await press(rows[1]?.[0]?.id as string)).toEqual({ userText: "Позже" });
    expect(fake.answers.at(-1)?.text).toBeUndefined();
    expect(chat.widgets).toEqual([]);
  });

  it("форма и свой виджет — текстом и «ответьте сообщением»; «Открыть в приложении» только при webChatUrl", async () => {
    const form = {
      chatId: "chat-1",
      toolCallId: "f1",
      toolName: "ask_form",
      input: {
        title: "Заявка",
        fields: [
          { name: "name", label: "Имя", kind: "text", required: true },
          { name: "size", label: "Размер", kind: "select", options: ["S", "M"] },
        ],
      },
    };
    expect(widgetCard(form)).toEqual({ text: "Заявка\n• Имя (обязательно)\n• Размер: S, M\nОтветьте сообщением.", rows: [] });
    const withUrl = widgetCard(form, (chatId) => `https://app.test/chat/${chatId}`);
    expect(withUrl.rows).toEqual([[{ text: "Открыть в приложении", action: { type: "open_link", url: "https://app.test/chat/chat-1" } }]]);
    const custom = widgetCard({ chatId: "chat-1", toolCallId: "c1", toolName: "pick_date", input: { title: "Когда удобно?" } });
    expect(custom).toEqual({ text: "Когда удобно?\nОтветьте сообщением.", rows: [] });
    expect(widgetCard({ chatId: "chat-1", toolCallId: "c2", toolName: "pick_date", input: {} }).text).toBe("Ответьте сообщением.");
  });

  it("«Открыть в приложении» — кнопка-ссылка, нажатие присылает ссылку и не отключает соседей; отмена задачи и решение по задаче идут в фон", async () => {
    const { chat, fake, sendCard, press } = setup();
    const rows = await sendCard({
      text: "?",
      rows: [
        [{ text: "Открыть", action: { type: "open_link", url: "https://app.test/chat/chat-1" } }],
        [{ text: "Отменить", action: { type: "task_cancel", chatId: "chat-1", taskId: "t1" } }],
      ],
    });
    // Мессенджер открывает ссылку сам; нажатие старой кнопки без адреса — ссылка сообщением.
    expect(rows[0]?.[0]?.url).toBe("https://app.test/chat/chat-1");
    expect(rows[1]?.[0]?.url).toBeUndefined();
    await press(rows[0]?.[0]?.id as string);
    expect(fake.sent.at(-1)?.message.text).toBe("Откройте: https://app.test/chat/chat-1");
    await press(rows[1]?.[0]?.id as string);
    expect(fake.answers.at(-1)?.text).toBe("Задача отменена.");
    const approval = await sendCard({ text: "?", rows: [[{ text: "Разрешить", action: { type: "task_approval", chatId: "chat-1", taskId: "t2", approvalId: "ap-1", decision: "allow" } }]] });
    await press(approval[0]?.[0]?.id as string);
    expect(fake.answers.at(-1)?.text).toBe("Принято.");
    // Кнопка старой карточки: задача ждёт ответа уже на другой вопрос — нажатие его не одобряет.
    const stale = await sendCard({ text: "?", rows: [[{ text: "Разрешить", action: { type: "task_approval", chatId: "chat-1", taskId: "t2", approvalId: "ap-old", decision: "allow" } }]] });
    await press(stale[0]?.[0]?.id as string);
    expect(fake.answers.at(-1)?.text).toBe("Уже отвечено.");
    expect(chat.taskCalls).toEqual([
      { kind: "cancel", ownerId: "anna", chatId: "chat-1", taskId: "t1" },
      { kind: "approval", ownerId: "anna", chatId: "chat-1", taskId: "t2", approvalId: "ap-1", decision: "allow" },
      { kind: "approval", ownerId: "anna", chatId: "chat-1", taskId: "t2", approvalId: "ap-old", decision: "allow" },
    ]);
  });

  it("выбор чата возвращается шлюзу", async () => {
    const { sendCard, press } = setup();
    const rows = await sendCard({ text: "Чаты", rows: [[{ text: "Отчёт", action: { type: "select_chat", chatId: "chat-7" } }]] });
    expect(await press(rows[0]?.[0]?.id as string)).toEqual({ selectChat: "chat-7" });
  });

  it("без кнопок подтверждение принимается словами «да» и «нет», один раз", async () => {
    const { chat, buttons } = setup();
    buttons.rememberWordsApproval(key, { chatId: "chat-1", approvalId: "ap9" });
    expect(await buttons.answerByWords(key, "anna", "Может быть")).toBeNull();
    expect(await buttons.answerByWords(key, "anna", "Да")).toEqual({ resume: { chatId: "chat-1", stream: null } });
    expect(chat.approvals).toEqual([{ userId: "anna", chatId: "chat-1", approvalId: "ap9", answer: "allow" }]);
    expect(await buttons.answerByWords(key, "anna", "да")).toBeNull();
    // Ядро уже не ждёт (ответили в вебе) — человеку «уже отвечено».
    buttons.rememberWordsApproval(key, { chatId: "chat-1", approvalId: "ap11" });
    chat.service.approvalResult = () => new ApprovalNotPendingError("ap11");
    expect(await buttons.answerByWords(key, "anna", "да")).toEqual({ reply: "Уже отвечено." });
    chat.service.approvalResult = () => ({ resumed: true });
    buttons.rememberWordsApproval(key, { chatId: "chat-1", approvalId: "ap10" });
    expect(await buttons.answerByWords(key, "anna", "нет.")).toEqual({ resume: { chatId: "chat-1", stream: null } });
    expect(chat.approvals.at(-1)?.answer).toBe("deny");
  });
});
