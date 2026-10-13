import { describe, expect, it, vi } from "vitest";
import { ApprovalNotPendingError } from "../../src/chat-service";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { readAll } from "./support/mock-model";
import { CHOICE_INPUT, answerAndFinish, ask, lastAnswer, removeTool, step, toolPart, userMessage, widgetCall, widgetChat } from "./support/widget-chat";

/*
 * Две копии сервера на одной базе: каждая читает ждущий ответ, а пишет позже. Вторая копия здесь — служба на хранилище,
 * которое придерживает её первую запись в ждущий ответ, пока первая копия не ответит.
 */

const removeCall = { type: "tool-call" as const, toolCallId: "r1", toolName: "remove", input: JSON.stringify({ path: "a" }) };

/** Хранилище второй копии: её первый вызов `method` ждёт `release()`; `reached` — она дошла до него. */
function heldStorage(storage: ChatStorage, method: "updateAwaitingMessage" | "insertMessage" = "updateAwaitingMessage") {
  let release!: () => void;
  let reach!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const reached = new Promise<void>((resolve) => (reach = resolve));
  let held = false;
  const original = storage[method].bind(storage) as (...args: unknown[]) => Promise<void>;
  const copy: ChatStorage = {
    ...storage,
    [method]: async (...args: unknown[]) => {
      if (!held) {
        held = true;
        reach();
        await gate;
      }
      return original(...args);
    },
  };
  return { copy, reached, release };
}

function widgetAndApproval() {
  const execute = vi.fn(async ({ path }: { path: string }) => `удалено ${path}`);
  const setup = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT), removeCall)], { agent: { tools: { remove: removeTool(execute) } } });
  return { ...setup, execute };
}

const approvalIdOf = (message: { parts: readonly unknown[] }) => (toolPart(message, "r1") as unknown as { approval: { id: string } }).approval.id;

describe("две копии сервера отвечают на разные ждущие вещи одного ответа", () => {
  it("подтверждение через вторую копию не затирает ответ на виджет из первой: ход продолжается с обоими", async () => {
    const { service, storage, build, execute } = widgetAndApproval();
    const { chat } = await ask(service);
    const approvalId = approvalIdOf(await lastAnswer(service, chat.id));
    const second = heldStorage(storage);
    const answering = build(second.copy).answerApproval("anna", chat.id, approvalId, "allow");
    await second.reached;
    expect(await service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Про" } })).toEqual({ resumed: false });
    second.release();
    expect(await answering).toEqual({ resumed: true });
    await expect.poll(async () => (await lastAnswer(service, chat.id)).metadata?.status).toBe("complete");
    const answer = await lastAnswer(service, chat.id);
    expect(toolPart(answer, "w1")).toMatchObject({ state: "output-available", output: { выбрано: "Про" } });
    expect(toolPart(answer, "r1")).toMatchObject({ state: "output-available" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("на тот же запрос подтверждения уже ответили в другой копии: вторая отказывает, решение первой остаётся", async () => {
    const { service, storage, build } = widgetAndApproval();
    const { chat } = await ask(service);
    const approvalId = approvalIdOf(await lastAnswer(service, chat.id));
    const second = heldStorage(storage);
    const answering = build(second.copy).answerApproval("anna", chat.id, approvalId, "allow");
    await second.reached;
    expect(await service.answerApproval("anna", chat.id, approvalId, "deny")).toEqual({ resumed: false });
    second.release();
    await expect(answering).rejects.toBeInstanceOf(ApprovalNotPendingError);
    const answer = await lastAnswer(service, chat.id);
    expect(answer.metadata?.status).toBe("awaiting_approval");
    expect(toolPart(answer, "r1")).toMatchObject({ state: "approval-responded", approval: { approved: false } });
  });
});

describe("новое сообщение, пока другая копия отвечает на ждущий ответ", () => {
  it("другая вкладка уже ответила на виджет и ход закончился: сообщение принято, ответ на виджет не затёрт", async () => {
    const { service, storage, build } = widgetChat([step(widgetCall("w1", "ask_choice", CHOICE_INPUT))]);
    const { chat } = await ask(service);
    const waitingId = (await lastAnswer(service, chat.id)).id;
    const second = heldStorage(storage, "insertMessage");
    const sending = build(second.copy).sendMessage("anna", chat.id, userMessage("u2", "а ещё вопрос"));
    await second.reached;
    expect(await answerAndFinish(service, chat.id, "w1", { выбрано: "Про" })).toEqual({ resumed: true });
    second.release();
    await readAll(await sending);
    const { messages } = await service.getHistory("anna", chat.id);
    const answered = messages.find((message) => message.id === waitingId)!;
    expect(answered.metadata?.status).toBe("complete");
    expect(toolPart(answered, "w1")).toMatchObject({ state: "output-available", output: { выбрано: "Про" } });
    expect(messages.some((message) => message.id === "u2")).toBe(true);
    expect(messages.at(-1)?.role).toBe("assistant");
  });

  it("другая вкладка ответила на виджет, а подтверждение ещё ждёт: ответ на виджет остаётся, запрос закрыт отказом", async () => {
    const { service, storage, build } = widgetAndApproval();
    const { chat } = await ask(service);
    const waitingId = (await lastAnswer(service, chat.id)).id;
    const second = heldStorage(storage, "insertMessage");
    const sending = build(second.copy).sendMessage("anna", chat.id, userMessage("u2", "передумал"));
    await second.reached;
    expect(await service.answerWidget({ chatId: chat.id, ownerId: "anna", toolCallId: "w1", answer: { выбрано: "Про" } })).toEqual({ resumed: false });
    second.release();
    await readAll(await sending);
    const { messages } = await service.getHistory("anna", chat.id);
    const closed = messages.find((message) => message.id === waitingId)!;
    expect(closed.metadata?.status).toBe("complete");
    expect(toolPart(closed, "w1")).toMatchObject({ state: "output-available", output: { выбрано: "Про" } });
    expect(toolPart(closed, "r1")).toMatchObject({ state: "output-denied" });
  });
});
