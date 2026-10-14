import { describe, expect, it } from "vitest";
import type { AgentNotice } from "../../../src/notices/agent-notice";
import { AGENT_NOTICE_PART_TYPE } from "../../../src/notices/agent-notice";
import type { PrepareTurnContext } from "../../../src/turn-hooks/prepare-turn";
import { readAll } from "../support/mock-model";
import { askInNewChat, doneNotice, lastUserTexts, noticeService, scriptedModel, waitTurn } from "../support/notice-chat";

const appNotice: AgentNotice = { kind: "app", name: "flow_timer", title: "Прошло два дня: спроси, получилось ли", data: { node: "n1" } };

describe("служебное сообщение вида app", () => {
  it("модель видит title, человек плашки не видит; повтор с тем же ключом не задваивает", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await askInNewChat(service);
    const delivered = await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [appNotice], wakeAgent: true, deliveryKey: "t1" });
    await waitTurn(service, chat.id);
    expect(lastUserTexts(model.doStreamCalls[1]!)).toContain("Прошло два дня: спроси, получилось ли");

    const { messages } = (await service.getHistory("anna", chat.id))!;
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "assistant"]);
    expect(messages.some((message) => message.id === delivered.messageId)).toBe(false);

    const again = await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [appNotice], wakeAgent: true, deliveryKey: "t1" });
    expect(again).toEqual({ status: "delivered", messageId: delivered.messageId, turnStarted: false });
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("вместе с обычным — человек видит только обычное", async () => {
    const { service } = noticeService(scriptedModel());
    const chat = await askInNewChat(service);
    await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Отчёт", "готово"), appNotice], wakeAgent: false, deliveryKey: "k" });
    const notice = (await service.getHistory("anna", chat.id))!.messages.at(-1)!;
    expect(notice.parts).toEqual([{ type: AGENT_NOTICE_PART_TYPE, data: expect.objectContaining({ notices: [doneNotice("Отчёт", "готово")] }) }]);
  });
});

describe("deliverNotices с готовым ответом", () => {
  it("ответ пишется без модели; prepareTurn зовётся с действием notice; повтор с тем же ключом без дубля", async () => {
    const model = scriptedModel();
    const seen: PrepareTurnContext[] = [];
    const { service, storage } = noticeService(model, { agent: { prepareTurn: (context) => void seen.push(context) } });
    const chat = await askInNewChat(service);
    const input = { ownerId: "anna", chatId: chat.id, notices: [appNotice], wakeAgent: true, deliveryKey: "r1", reply: { text: "Как успехи с привычкой?" } };
    const result = await service.deliverNotices(input);
    expect(result).toMatchObject({ status: "delivered", turnStarted: true });
    await waitTurn(service, chat.id);

    expect(model.doStreamCalls).toHaveLength(1);
    expect(seen.map((context) => context.action)).toEqual(["send", "notice"]);
    expect(seen[1]!.notices).toEqual([appNotice]);
    const answer = (await storage.listMessages(chat.id)).at(-1)!;
    expect(answer).toMatchObject({ role: "assistant", status: "complete", parentId: result.messageId });
    expect(answer.parts.filter((part) => part.type === "text")).toEqual([expect.objectContaining({ text: "Как успехи с привычкой?" })]);
    expect(await storage.sumUsage({ chatId: chat.id, messageId: answer.id })).toEqual([]);

    expect(await service.deliverNotices(input)).toEqual({ status: "delivered", messageId: result.messageId, turnStarted: false });
    expect((await storage.listMessages(chat.id)).length).toBe(4);
  });

  it("поток хода с готовым ответом отдаёт текст", async () => {
    const { service } = noticeService(scriptedModel());
    const chat = await askInNewChat(service);
    await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [appNotice], wakeAgent: true, deliveryKey: "r2", reply: { text: "Привет снова" } });
    const stream = await service.subscribe("anna", chat.id);
    const chunks = stream ? await readAll(stream) : [];
    const text = chunks.flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : [])).join("");
    expect(text).toBe("Привет снова");
  });
});
