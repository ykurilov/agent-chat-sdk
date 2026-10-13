import { describe, expect, it } from "vitest";
import { noticePartForModel, noticeText } from "../../../src/notices/notices-for-model";
import { AGENT_NOTICE_PART_TYPE } from "../../../src/notices/agent-notice";
import { readAll } from "../support/mock-model";
import { doneNotice, lastUserTexts, noticeService, scriptedModel, textsOf, userMessage, waitTurn } from "../support/notice-chat";

describe("T041: служебное сообщение для модели", () => {
  it("тексты по видам", () => {
    expect(noticeText(doneNotice("Отчёт по сделкам", "12 сделок"))).toBe('Фоновая задача "Отчёт по сделкам" закончилась: 12 сделок');
    expect(noticeText({ kind: "conversation_started", title: "Поздоровайся и спроси имя" })).toBe("Начни разговор: Поздоровайся и спроси имя");
    expect(noticeText({ kind: "task_failed", taskId: "t", title: "Отчёт", error: "нет связи" })).toContain("нет связи");
    expect(noticeText({ kind: "task_canceled", taskId: "t", title: "Отчёт" })).toContain('"Отчёт"');
    expect(noticeText({ kind: "task_interrupted", taskId: "t", title: "Отчёт" })).toContain("прервана");
    expect(noticeText({ kind: "task_timed_out", taskId: "t", title: "Отчёт" })).toContain('"Отчёт"');
    expect(
      noticeText({ kind: "task_awaiting_approval", taskId: "t", title: "Отчёт", approval: { approvalId: "a", toolName: "send_mail", input: {} } }),
    ).toContain("send_mail");
  });

  it("часть с несколькими сообщениями — один текст; чужие части — не текст", () => {
    const part = { type: AGENT_NOTICE_PART_TYPE, data: { notices: [doneNotice("А", "1"), doneNotice("Б", "2", "t2")] } };
    expect(noticePartForModel(part)).toEqual({ type: "text", text: 'Фоновая задача "А" закончилась: 1\n\nФоновая задача "Б" закончилась: 2' });
    expect(noticePartForModel({ type: "data-voice-mode", data: true })).toBeUndefined();
  });

  it("в запросе — текстом в последнем сообщении, на следующих ходах — тем же текстом", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "запусти отчёт")));
    await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Отчёт", "12 сделок")], wakeAgent: true, deliveryKey: "task:t1" });
    await waitTurn(service, chat.id);
    expect(lastUserTexts(model.doStreamCalls[1]!)[0]).toBe('Фоновая задача "Отчёт" закончилась: 12 сделок');
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "спасибо")));
    const users = model.doStreamCalls[2]!.prompt.filter((message) => message.role === "user");
    expect(textsOf(users[1])).toEqual(['Фоновая задача "Отчёт" закончилась: 12 сделок']);
  });
});
