import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { NothingToRetryError, WidgetNotPendingError, createChatService } from "../../src/chat-service";
import { newStoredMessage } from "../../src/conversation/types";
import type { StoredMessage } from "../../src/conversation/types";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { HANGING_TOOL_CALL_REASON, IGNORED_REASON } from "../../src/tool-approval/approval-parts";
import { ANSWERED_BY_MESSAGE } from "../../src/widgets/pending-widgets";
import { controlledModel, finishPart, mockCatalog, mockEnv, mockModelId, readAll, streamStart } from "./support/mock-model";
import { CHOICE_INPUT, answerAndFinish, ask, lastAnswer, promptText, removeTool, step, toolPart, userMessage, widgetCall, widgetChat } from "./support/widget-chat";

type Part = StoredMessage["parts"][number];

const badRequest = () => new APICallError({ message: "400", url: "https://p.test", requestBodyValues: {}, statusCode: 400, responseBody: "плохо" });

describe("сообщение вместо ответа на виджет (FR-006)", () => {
  it("новое сообщение: виджет получает {ответ: сообщением}, ответ законченный, затем обычный ход", async () => {
    const { service, model } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const { chat } = await ask(service);
    const waiting = await lastAnswer(service, chat.id);
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Хочу третий вариант")));
    const { messages } = await service.getHistory("anna", chat.id);
    const closed = messages.find((message) => message.id === waiting.id)!;
    expect(closed.metadata?.status).toBe("complete");
    expect(toolPart(closed, "w1")).toMatchObject({ state: "output-available", output: ANSWERED_BY_MESSAGE });
    expect(messages.at(-1)!.metadata?.status).toBe("complete");
    // Модель видит короткую пометку, а следом — само сообщение.
    const prompt = promptText(model, 1);
    expect(prompt).toContain(JSON.stringify(ANSWERED_BY_MESSAGE));
    expect(prompt.indexOf("сообщением")).toBeLessThan(prompt.indexOf("Хочу третий вариант"));
    await expect(service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Про" } })).rejects.toBeInstanceOf(WidgetNotPendingError);
  });

  it("виджет вместе с запросом подтверждения: сообщение закрывает оба", async () => {
    const { service, storage } = widgetChat(
      [step(widgetCall("w1", "ask_choice", CHOICE_INPUT), { type: "tool-call", toolCallId: "r1", toolName: "remove", input: JSON.stringify({ path: "a" }) })],
      { agent: { tools: { remove: removeTool() } } },
    );
    const { chat } = await ask(service);
    const waiting = await lastAnswer(service, chat.id);
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "не надо")));
    const closed = (await storage.getMessage(waiting.id))!;
    expect(closed.status).toBe("complete");
    expect(toolPart(closed, "w1")).toMatchObject({ state: "output-available", output: ANSWERED_BY_MESSAGE });
    expect(toolPart(closed, "r1")).toMatchObject({ state: "output-denied", approval: { reason: IGNORED_REASON } });
  });
});

describe("правка закрывает ждущий ответ в хранилище", () => {
  it("прежний ответ — законченный, виджет помечен «сообщением», новый ответ — в новой ветке", async () => {
    const { service, storage } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const { chat } = await ask(service);
    const waiting = await lastAnswer(service, chat.id);
    await readAll(await service.editMessage("anna", chat.id, "u1", userMessage("u1b", "помоги по-другому")));
    expect((await service.getHistory("anna", chat.id)).messages.map((message) => message.id)).not.toContain(waiting.id);
    const closed = (await storage.getMessage(waiting.id))!;
    expect(closed.status).toBe("complete");
    expect(toolPart(closed, "w1")).toMatchObject({ state: "output-available", output: ANSWERED_BY_MESSAGE });
  });
});

describe("Стоп, сбой и восстановление закрывают виджет как вызов без результата", () => {
  it("«Стоп» посреди шага с вызовом виджета: ответ остановлен, вызов закрыт ошибкой", async () => {
    const controlled = controlledModel();
    const storage = createInMemoryChatStorage();
    const service = createChatService({
      storage,
      catalog: mockCatalog({ mock: controlled.model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты помощник.", widgets: { basic: true } },
      env: mockEnv,
      logError: () => {},
    });
    const chat = await service.createChat("anna");
    const stream = await service.sendMessage("anna", chat.id, userMessage("u1", "спроси меня"));
    await controlled.opened;
    controlled.push(streamStart, widgetCall("w1", "ask_choice", CHOICE_INPUT));
    const reading = readAll(stream);
    // Вызов дошёл до записи, шаг ещё не кончился.
    for (let attempt = 0; attempt < 50; attempt++) {
      if (toolPart((await service.getHistory("anna", chat.id)).messages.at(-1)!, "w1")) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(await service.stop("anna", chat.id)).toBe(true);
    await reading;
    const answer = await lastAnswer(service, chat.id);
    expect(answer.metadata?.status).toBe("stopped");
    expect(toolPart(answer, "w1")).toMatchObject({ state: "output-error", errorText: HANGING_TOOL_CALL_REASON });
  });

  it("сбой модели после вызова: ответ с ошибкой, вызов закрыт ошибкой", async () => {
    const { service } = widgetChat([[streamStart, widgetCall("w1", "ask_choice", CHOICE_INPUT), { type: "error", error: badRequest() }]]);
    const { chat } = await ask(service);
    const answer = await lastAnswer(service, chat.id);
    expect(answer.metadata?.status).toBe("error");
    expect(toolPart(answer, "w1")).toMatchObject({ state: "output-error" });
  });

  it("восстановление после падения сервера: идущий ответ с вызовом виджета — прерван, вызов закрыт", async () => {
    const { storage, build } = widgetChat([]);
    await storage.createChat({ id: "c1", ownerId: "anna", modelId: mockModelId, providerId: "mock" });
    await storage.insertMessage(newStoredMessage({ id: "u1", chatId: "c1", role: "user", parts: [{ type: "text", text: "спроси" }], createdAt: "2026-01-01T00:00:00.000Z" }));
    await storage.insertMessage(
      newStoredMessage({
        id: "a1",
        chatId: "c1",
        parentId: "u1",
        role: "assistant",
        status: "streaming",
        modelId: mockModelId,
        providerId: "mock",
        parts: [{ type: "step-start" }, { type: "tool-ask_choice", toolCallId: "w1", state: "input-available", input: CHOICE_INPUT } as Part],
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );
    const restarted = build(storage);
    expect(await restarted.recoverInterruptedAnswers()).toBe(1);
    const recovered = (await storage.getMessage("a1"))!;
    expect(recovered.status).toBe("interrupted");
    expect(toolPart(recovered, "w1")).toMatchObject({ state: "output-error" });
    await expect(restarted.answerWidget({ chatId: "c1", ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Про" } })).rejects.toBeInstanceOf(WidgetNotPendingError);
  });
});

describe("ветки и повтор при ожидании", () => {
  it("«Повторить» при ожидании — нечего повторять, как у подтверждения", async () => {
    const { service } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const { chat } = await ask(service);
    await expect(service.retry("anna", chat.id)).rejects.toBeInstanceOf(NothingToRetryError);
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("awaiting_approval");
  });

  it("«Переделать» уводит ветку: ждущий виджет в другой ветке не принимает ответ", async () => {
    const { service } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const { chat } = await ask(service);
    const waiting = await lastAnswer(service, chat.id);
    await readAll(await service.regenerate("anna", chat.id, waiting.id));
    expect((await lastAnswer(service, chat.id)).id).not.toBe(waiting.id);
    await expect(service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Про" } })).rejects.toBeInstanceOf(WidgetNotPendingError);
  });

  it("«Повторить» прерванного ответа переносит отвеченный виджет с ответом", async () => {
    const { service, model } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT)), badRequest()]);
    const { chat } = await ask(service);
    await answerAndFinish(service, chat.id, "w1", { выбрано: "Про" });
    const failed = await lastAnswer(service, chat.id);
    expect(failed.metadata?.status).toBe("error");
    await readAll(await service.retry("anna", chat.id));
    const continued = await lastAnswer(service, chat.id);
    expect(continued.id).not.toBe(failed.id);
    expect(continued.metadata?.status).toBe("complete");
    expect(toolPart(continued, "w1")).toMatchObject({ state: "output-available", output: { выбрано: "Про" } });
    expect(promptText(model, model.doStreamCalls.length - 1)).toContain(JSON.stringify({ выбрано: "Про" }));
  });
});

describe("журнал отказов (FR-010a)", () => {
  it("каждый отказ — одна строка с видом, чатом и вызовом, без содержимого ответа", async () => {
    const { service, logError } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const { chat } = await ask(service);
    const secret = "секретный-ответ-человека";
    await expect(service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: secret } })).rejects.toThrow();
    await expect(service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w9", answer: { выбрано: secret } })).rejects.toThrow();
    await expect(service.answerWidget({ chatId: chat.id, ownerId: "boris", toolCallId: "w1", answer: { выбрано: secret } })).rejects.toThrow();
    const lines = logError.mock.calls.map(([line]) => line).filter((line) => line.startsWith("[виджет]"));
    expect(lines).toEqual([
      `[виджет] отказ invalid_answer чат=${chat.id} вызов=w1`,
      `[виджет] отказ widget_not_pending чат=${chat.id} вызов=w9`,
      `[виджет] отказ not_found чат=${chat.id} вызов=w1`,
    ]);
    expect(JSON.stringify(logError.mock.calls)).not.toContain(secret);
  });

  it("id с переводом строки не подделывает строки журнала: значение экранировано", async () => {
    const { service, logError } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const forged = "c1\n[виджет] отказ поддельный";
    await expect(service.answerWidget({ chatId: forged, ownerId: "anna", toolCallId: "w1\r\nподделка", answer: { выбрано: "Про" } })).rejects.toThrow();
    const lines = logError.mock.calls.map(([line]) => line).filter((line) => line.startsWith("[виджет]"));
    expect(lines).toEqual([`[виджет] отказ not_found чат=${JSON.stringify(forged)} вызов=${JSON.stringify("w1\r\nподделка")}`]);
  });

  it("принятый ответ в журнал не пишется", async () => {
    const { service, logError } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const { chat } = await ask(service);
    await answerAndFinish(service, chat.id, "w1", { выбрано: "Про" });
    expect(logError.mock.calls.filter(([line]) => line.startsWith("[виджет]"))).toEqual([]);
  });
});

it("шаг без вызовов после ответа на виджет кончается законченным ответом", async () => {
  const { service } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT)), [streamStart, finishPart()]]);
  const { chat } = await ask(service);
  await answerAndFinish(service, chat.id, "w1", { выбрано: "Про" });
  expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("complete");
});
