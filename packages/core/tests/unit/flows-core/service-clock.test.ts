import { describe, expect, it, vi } from "vitest";
import type { PrepareTurn } from "../../../src/index";
import { readAll } from "../support/mock-model";
import { doneNotice, noticeService, scriptedModel, textsOf, userMessage, waitTurn } from "../support/notice-chat";

// 5 января 2031, 10:00 UTC — воскресенье; в Новосибирске (UTC+7) тоже 5-е.
const FIXED = new Date(Date.UTC(2031, 0, 5, 10, 0));

describe("061 T201: createChatService({ now }) — один источник часов", () => {
  it("подменённые часы видны в дате запроса, в prepareTurn.now и в ходе по служебному сообщению", async () => {
    const prepareTurn = vi.fn<PrepareTurn>(() => undefined);
    const model = scriptedModel();
    const { service } = noticeService(model, { now: () => FIXED, agent: { timeZone: "Asia/Novosibirsk", prepareTurn } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Отчёт", "готово")], wakeAgent: true, deliveryKey: "k1" });
    await waitTurn(service, chat.id);

    expect(model.doStreamCalls).toHaveLength(2);
    for (const call of model.doStreamCalls) {
      const today = call.prompt.flatMap(textsOf).filter((text) => text.startsWith("Сегодня:"));
      expect(today).toContain("Сегодня: воскресенье, 5 января 2031 г.");
    }
    expect(prepareTurn).toHaveBeenCalledTimes(2);
    for (const [context] of prepareTurn.mock.calls) expect(context.now.toISOString()).toBe(FIXED.toISOString());
  });
});
