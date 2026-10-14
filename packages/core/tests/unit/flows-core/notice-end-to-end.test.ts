import { describe, expect, it, vi } from "vitest";
import type { AfterTurnHandler, BeforeTurnDecision, BeforeTurnHandler, ReplyCheck, UsageRecord } from "../../../src/index";
import type { SpendingLimits } from "../../../src/spending/spending-limits";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { doneNotice, noticeService, saying, scriptedModel } from "../support/notice-chat";

/** Служба со всеми точками хода: ворота, лимит, проверка ответа, итог хода. */
function setup() {
  const storage = createInMemoryChatStorage();
  const written: UsageRecord[] = [];
  const insert = storage.insertUsageRecord.bind(storage);
  storage.insertUsageRecord = async (record) => {
    written.push(record);
    return insert(record);
  };
  const decision: { next?: BeforeTurnDecision } = {};
  const beforeTurn = vi.fn<BeforeTurnHandler>(() => decision.next);
  const afterTurn = vi.fn<AfterTurnHandler>();
  const limits: SpendingLimits = {
    assertWithinLimit: vi.fn(async () => {}),
    status: vi.fn(async () => ({ state: "ok" as const })) as unknown as SpendingLimits["status"],
  };
  const fixLink: ReplyCheck = async ({ text }) => (text.includes("https://fake.example") ? { text: text.replace(" https://fake.example", ""), note: "ссылка вырезана" } : undefined);
  const model = scriptedModel([saying("Доброе утро! Задание дня: https://fake.example")]);
  const { service } = noticeService(model, { storage, beforeTurn, afterTurn, limits, replyChecks: [fixLink] });
  return { service, model, written, decision, beforeTurn, afterTurn, limits };
}

const morning = (chatId: string) => ({
  ownerId: "anna",
  chatId,
  notices: [doneNotice("Утро", "день 2")],
  wakeAgent: true,
  deliveryKey: "morning-2",
  awaitAnswer: true,
  usageSource: "first_message" as const,
});

describe("061 T206: ход по служебному сообщению проходит все точки ядра", () => {
  it("beforeTurn → лимит → модель → проверка ответа → запись; ответ в результате уже проверен", async () => {
    const { service, model, written, beforeTurn, afterTurn, limits } = setup();
    const chat = await service.createChat("anna");
    const result = await service.deliverNotices(morning(chat.id));

    expect(beforeTurn).toHaveBeenCalledWith(expect.objectContaining({ action: "notice", userId: "anna", chat: expect.objectContaining({ id: chat.id }) }));
    expect(limits.assertWithinLimit).toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(1);
    expect(result).toMatchObject({ status: "delivered", turnStarted: true, answer: { text: "Доброе утро! Задание дня:", status: "complete" } });
    expect(afterTurn).toHaveBeenCalledWith(expect.objectContaining({ trigger: "notice", text: "Доброе утро! Задание дня:" }));
    expect(written.map((record) => record.source)).toEqual(["first_message"]);
    const { messages, running } = await service.getHistory("anna", chat.id);
    expect(running).toBe(false);
    expect(JSON.stringify(messages.at(-1)!.parts)).not.toContain("fake.example");
  });

  it("beforeTurn «записать и промолчать» — сообщение записано, ни лимита, ни модели, ни ответа", async () => {
    const { service, model, decision, limits } = setup();
    const chat = await service.createChat("anna");
    decision.next = { hold: true };
    const result = await service.deliverNotices(morning(chat.id));
    expect(result).toEqual({ status: "delivered", messageId: expect.any(String), turnStarted: false });
    expect(limits.assertWithinLimit).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(0);
  });
});
