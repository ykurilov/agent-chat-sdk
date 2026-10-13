import { describe, expect, it } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { AGENT_NOTICE_PART_TYPE } from "../../../src/notices/agent-notice";
import { SpendingLimitReachedError } from "../../../src/spending/spending-limits";
import { controlledModel, readAll } from "../support/mock-model";
import { askInNewChat, callTool, doneNotice, noticeService, saying, scriptedModel, userMessage, waitTurn } from "../support/notice-chat";

const deliver = (chatId: string, key: string, wakeAgent = true, ownerId = "anna") => ({
  ownerId,
  chatId,
  notices: [doneNotice("Отчёт", "готово", key)],
  wakeAgent,
  deliveryKey: key,
});

describe("T042: deliverNotices", () => {
  it("дописывает в конец текущей ветки и начинает ход", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await askInNewChat(service);
    const result = await service.deliverNotices(deliver(chat.id, "k1"));
    expect(result).toMatchObject({ status: "delivered", turnStarted: true });
    await waitTurn(service, chat.id);
    const { messages } = (await service.getHistory("anna", chat.id))!;
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const notice = messages[2]!;
    expect(notice.id).toBe(result.messageId);
    expect(notice.parts.find((part) => part.type === AGENT_NOTICE_PART_TYPE)).toMatchObject({ data: { notices: [{ kind: "task_done" }] } });
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("повтор с тем же ключом ничего не добавляет", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await askInNewChat(service);
    const first = await service.deliverNotices(deliver(chat.id, "k1"));
    await waitTurn(service, chat.id);
    const again = await service.deliverNotices(deliver(chat.id, "k1"));
    expect(again).toEqual({ status: "delivered", messageId: first.messageId, turnStarted: false });
    expect((await service.getHistory("anna", chat.id))!.messages).toHaveLength(4);
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("занятый чат — busy и ничего не пишет; чужой или удалённый — chat_gone", async () => {
    const { model, opened, push, end } = controlledModel();
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");
    const stream = await service.sendMessage("anna", chat.id, userMessage("u1", "привет"));
    await opened;
    expect(await service.deliverNotices(deliver(chat.id, "k1"))).toEqual({ status: "busy", turnStarted: false });
    push(...saying("ок"));
    end();
    await readAll(stream);
    expect((await service.getHistory("anna", chat.id))!.messages).toHaveLength(2);
    expect(await service.deliverNotices(deliver(chat.id, "k1", true, "boris"))).toEqual({ status: "chat_gone", turnStarted: false });
    expect(await service.deliverNotices(deliver("нет-такого", "k1"))).toEqual({ status: "chat_gone", turnStarted: false });
  });

  it("wakeAgent: false — только отметка, хода нет", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await askInNewChat(service);
    const result = await service.deliverNotices(deliver(chat.id, "k1", false));
    expect(result).toMatchObject({ status: "delivered", turnStarted: false });
    expect((await service.getHistory("anna", chat.id))!.messages).toHaveLength(3);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("закрывает неотвеченное подтверждение", async () => {
    const remove = tool({ description: "Удалить", inputSchema: z.object({}), needsApproval: true, execute: async () => "удалено" });
    const model = scriptedModel([callTool("remove", "c1")]);
    const { service } = noticeService(model, { agent: { tools: { remove } } });
    const chat = await askInNewChat(service);
    await service.deliverNotices(deliver(chat.id, "k1"));
    await waitTurn(service, chat.id);
    const { messages } = (await service.getHistory("anna", chat.id))!;
    const call = messages[1]!.parts.find((part) => part.type === "tool-remove") as { state: string } | undefined;
    expect(call?.state).not.toBe("approval-requested");
  });

  it("больше 5 ходов сервера подряд без человека — сообщение без хода; человек сбрасывает счёт", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await askInNewChat(service);
    for (let index = 1; index <= 5; index++) {
      expect(await service.deliverNotices(deliver(chat.id, `k${index}`))).toMatchObject({ turnStarted: true });
      await waitTurn(service, chat.id);
    }
    expect(await service.deliverNotices(deliver(chat.id, "k6"))).toMatchObject({ status: "delivered", turnStarted: false });
    expect(model.doStreamCalls).toHaveLength(6);
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "дальше")));
    expect(await service.deliverNotices(deliver(chat.id, "k7"))).toMatchObject({ turnStarted: true });
    await waitTurn(service, chat.id);
  });

  it("лимит трат исчерпан — сообщение пишется, хода нет", async () => {
    const model = scriptedModel();
    let reached = false;
    const { service } = noticeService(model, {
      limits: {
        assertWithinLimit: async () => {
          if (reached) throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
        },
        status: async () => ({}) as never,
      },
    });
    const chat = await askInNewChat(service);
    reached = true;
    expect(await service.deliverNotices(deliver(chat.id, "k1"))).toMatchObject({ status: "delivered", turnStarted: false });
    expect((await service.getHistory("anna", chat.id))!.messages).toHaveLength(3);
  });

  it("ход по служебному сообщению идёт тем же путём: ответ сохраняется, название чата не меняется", async () => {
    const model = scriptedModel([saying("первый"), saying("про отчёт")]);
    const { service } = noticeService(model);
    const chat = await askInNewChat(service, "запусти отчёт");
    const titleBefore = (await service.listChats("anna"))[0]!.title;
    await service.deliverNotices(deliver(chat.id, "k1"));
    await waitTurn(service, chat.id);
    const { messages } = (await service.getHistory("anna", chat.id))!;
    expect(messages.at(-1)!.parts.some((part) => part.type === "text" && part.text === "про отчёт")).toBe(true);
    expect((await service.listChats("anna"))[0]!.title).toBe(titleBefore);
  });
  it("сбой запуска хода после записи: повтор доставки будит агента, а не отвечает «уже доставлено»", async () => {
    const model = scriptedModel();
    let failLaunch = false;
    const { service } = noticeService(model, {
      limits: {
        assertWithinLimit: async () => {},
        status: async () => ({}) as never,
        turnRules: async () => {
          if (failLaunch) throw new Error("лимиты недоступны");
          return undefined;
        },
      },
    });
    const chat = await askInNewChat(service);
    failLaunch = true;
    await expect(service.deliverNotices(deliver(chat.id, "k1"))).rejects.toThrow("лимиты недоступны");
    expect((await service.getHistory("anna", chat.id))!.messages).toHaveLength(3);
    failLaunch = false;
    const again = await service.deliverNotices(deliver(chat.id, "k1"));
    expect(again).toMatchObject({ status: "delivered", turnStarted: true });
    await waitTurn(service, chat.id);
    const { messages } = (await service.getHistory("anna", chat.id))!;
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(messages[2]!.id).toBe(again.messageId);
    expect(model.doStreamCalls).toHaveLength(2);
    // Ответ есть — следующий повтор ничего не начинает.
    expect(await service.deliverNotices(deliver(chat.id, "k1"))).toEqual({ status: "delivered", messageId: again.messageId, turnStarted: false });
  });

  it("повтор доставки без wakeAgent после сбоя не будит агента", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await askInNewChat(service);
    const first = await service.deliverNotices(deliver(chat.id, "k1", false));
    expect(await service.deliverNotices(deliver(chat.id, "k1", false))).toEqual({ status: "delivered", messageId: first.messageId, turnStarted: false });
    expect(model.doStreamCalls).toHaveLength(1);
  });
});
