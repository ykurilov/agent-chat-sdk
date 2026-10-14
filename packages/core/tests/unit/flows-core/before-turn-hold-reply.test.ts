import { describe, expect, it, vi } from "vitest";
import { TurnRefusedError } from "../../../src/index";
import type { AfterTurnHandler, BeforeTurnDecision, BeforeTurnHandler, ChatEvent, TurnNotStartedHandler } from "../../../src/index";
import { AGENT_NOTICE_PART_TYPE } from "../../../src/notices/agent-notice";
import { SpendingLimitReachedError } from "../../../src/spending/spending-limits";
import type { SpendingLimits } from "../../../src/spending/spending-limits";
import { readAll } from "../support/mock-model";
import { doneNotice, noticeService, scriptedModel, userMessage, waitTurn } from "../support/notice-chat";

/** Служба, где `beforeTurn` отвечает тем, что лежит в `decision.next` (нет — пускает). */
function setup(extra: Parameters<typeof noticeService>[1] = {}) {
  const decision: { next?: BeforeTurnDecision } = {};
  const beforeTurn = vi.fn<BeforeTurnHandler>(() => decision.next);
  const turnNotStarted = vi.fn<TurnNotStartedHandler>();
  const afterTurn = vi.fn<AfterTurnHandler>();
  const model = scriptedModel();
  const { service, storage } = noticeService(model, { beforeTurn, turnNotStarted, afterTurn, ...extra });
  const events: ChatEvent[] = [];
  service.subscribeEvents((event) => void events.push(event));
  return { decision, beforeTurn, turnNotStarted, afterTurn, model, service, storage, events };
}

const textOf = (message: { parts: Array<{ type: string; text?: string }> }) =>
  message.parts.filter((part) => part.type === "text").map((part) => part.text).join("");

describe("061 T202: beforeTurn — «записать и промолчать» ({ hold: true })", () => {
  it("send: сообщение записано, модели нет, ответа нет; клиент получил «ответ позже»; чат свободен", async () => {
    const { decision, model, service, turnNotStarted, afterTurn, events } = setup();
    const chat = await service.createChat("anna");
    decision.next = { hold: true };
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));

    expect(model.doStreamCalls).toHaveLength(0);
    expect(chunks).toEqual([{ type: "data-turn-held", data: { messageId: "u1" }, transient: true }]);
    const { messages, running } = await service.getHistory("anna", chat.id);
    expect(messages.map((message) => message.id)).toEqual(["u1"]);
    expect(running).toBe(false);
    // Не пропуск: ни хода, ни turnNotStarted.
    expect(turnNotStarted).not.toHaveBeenCalled();
    expect(afterTurn).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: "turn-held", ownerId: "anna", chatId: chat.id, messageId: "u1", trigger: "human" });

    decision.next = undefined;
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё")));
    expect(model.doStreamCalls).toHaveLength(1);
    const { messages: after } = await service.getHistory("anna", chat.id);
    expect(after.map((message) => message.role)).toEqual(["user", "user", "assistant"]);
  });

  it("send: лимит расходов исчерпан — сообщение всё равно записано, денег запись не стоит", async () => {
    const limits: SpendingLimits = {
      assertWithinLimit: vi.fn(async () => {
        throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
      }),
      status: vi.fn(async () => ({ state: "exhausted" as const, scope: "user" as const, period: "month" as const, share: 1, resetsAt: null })),
    };
    const { decision, service, storage } = setup({ limits });
    const chat = await service.createChat("anna");
    decision.next = { hold: true };
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    expect((await storage.listMessages(chat.id)).map((message) => message.id)).toEqual(["u1"]);
  });

  it("edit: правленое сообщение записано соседом, ответа нет", async () => {
    const { decision, model, service } = setup();
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    decision.next = { hold: true };
    const chunks = await readAll(await service.editMessage("anna", chat.id, "u1", userMessage("u1b", "здравствуй")));
    expect(chunks).toEqual([{ type: "data-turn-held", data: { messageId: "u1b" }, transient: true }]);
    expect(model.doStreamCalls).toHaveLength(1);
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.map((message) => message.id)).toEqual(["u1b"]);
  });

  it("steer без идущего хода: сообщение записано, статус held, хода нет", async () => {
    const { decision, model, service } = setup();
    const chat = await service.createChat("anna");
    decision.next = { hold: true };
    expect(await service.steer("anna", chat.id, userMessage("u1", "привет"))).toEqual({ status: "held", messageId: "u1" });
    expect(model.doStreamCalls).toHaveLength(0);
    expect((await service.getHistory("anna", chat.id)).messages.map((message) => message.id)).toEqual(["u1"]);
  });

  it("regenerate, retry: записывать нечего — отказ turn_held, ничего не меняется", async () => {
    const { decision, model, service } = setup();
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    decision.next = { hold: true };
    const answer = (await service.getHistory("anna", chat.id)).messages[1]!;
    const refused = await service.regenerate("anna", chat.id, answer.id).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(TurnRefusedError);
    expect((refused as TurnRefusedError).code).toBe("turn_held");
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("служебное сообщение: записано без хода", async () => {
    const { decision, model, service } = setup();
    const chat = await service.createChat("anna");
    decision.next = { hold: true };
    const result = await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Отчёт", "готово")], wakeAgent: true, deliveryKey: "k1" });
    expect(result).toMatchObject({ status: "delivered", turnStarted: false });
    expect(model.doStreamCalls).toHaveLength(0);
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.parts.some((part) => part.type === AGENT_NOTICE_PART_TYPE)).toBe(true);
  });

  it("assertTurnAllowed: «записать и промолчать» — не отказ", async () => {
    const { decision, service } = setup();
    const chat = await service.createChat("anna");
    decision.next = { hold: true };
    await expect(service.assertTurnAllowed("anna", chat.id, "send", "привет")).resolves.toBeUndefined();
  });
});

describe("061 T202: beforeTurn — «готовая фраза» ({ reply: { text } })", () => {
  it("send: ответ — готовый текст без модели, итог хода приходит в afterTurn", async () => {
    const { decision, model, service, afterTurn } = setup();
    const chat = await service.createChat("anna");
    decision.next = { reply: { text: "Сейчас вечер, отвечу утром." } };
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    expect(model.doStreamCalls).toHaveLength(0);
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(textOf(messages[1]!)).toBe("Сейчас вечер, отвечу утром.");
    expect(messages[1]!.metadata?.status).toBe("complete");
    expect(afterTurn).toHaveBeenCalledWith(expect.objectContaining({ text: "Сейчас вечер, отвечу утром.", trigger: "send", status: "complete" }));
  });

  it("regenerate: новый ответ — готовый текст", async () => {
    const { decision, model, service } = setup();
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    decision.next = { reply: { text: "Готово." } };
    const first = (await service.getHistory("anna", chat.id)).messages[1]!;
    await readAll(await service.regenerate("anna", chat.id, first.id));
    expect(model.doStreamCalls).toHaveLength(1);
    const { messages } = await service.getHistory("anna", chat.id);
    expect(textOf(messages.at(-1)!)).toBe("Готово.");
  });

  it("служебное сообщение: ход с готовым текстом приложения, он главнее reply из запроса", async () => {
    const { decision, model, service } = setup();
    const chat = await service.createChat("anna");
    decision.next = { reply: { text: "Из beforeTurn." } };
    const result = await service.deliverNotices({
      ownerId: "anna",
      chatId: chat.id,
      notices: [doneNotice("Отчёт", "готово")],
      wakeAgent: true,
      deliveryKey: "k1",
      reply: { text: "Из запроса." },
    });
    expect(result).toMatchObject({ status: "delivered", turnStarted: true });
    await waitTurn(service, chat.id);
    expect(model.doStreamCalls).toHaveLength(0);
    const { messages } = await service.getHistory("anna", chat.id);
    expect(textOf(messages.at(-1)!)).toBe("Из beforeTurn.");
  });
});
