import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DENIED_BY_USER_REASON, IGNORED_REASON, pendingApprovals, pendingHumanInput } from "../../../src/tool-approval/approval-parts";
import { readAll } from "../support/mock-model";
import {
  askInNewChat,
  callsHelper,
  helperCalls,
  helperChatModel,
  helperPart,
  helperService,
  helperText,
  lastAnswer,
  researchHelper,
  userMessage,
} from "../support/helper-fixtures";
import type { ChatService } from "../../../src/chat-service";

/** Помощник с опасным инструментом `remove`: каждый вызов ждёт «Разрешить». */
function setup(needsApproval: boolean | ((input: { path: string }) => boolean) = true) {
  const execute = vi.fn(async ({ path }: { path: string }) => `удалено ${path}`);
  const remove = tool({ description: "Удалить", title: "Удалить файл", inputSchema: z.object({ path: z.string() }), needsApproval, execute });
  const model = helperChatModel({
    stream: [callsHelper("h1", "cleaner", "убери a")],
    generate: [helperCalls({ id: "r1", toolName: "remove", input: { path: "a" } }), helperText("Убрал a")],
  });
  const { service, storage, build } = helperService({ model, helpers: { cleaner: researchHelper({ tools: { remove } }) } });
  return { execute, model, service, storage, build };
}

async function pendingApprovalId(service: ChatService, chatId: string) {
  return helperPart((await lastAnswer(service, chatId)).parts, "cleaner")!.output!.pendingApproval.approvalId as string;
}

async function answerAndWait(service: ChatService, chatId: string, approvalId: string, answer: "allow" | "deny" | "always") {
  expect(await service.answerApproval("anna", chatId, approvalId, answer)).toEqual({ resumed: true });
  await readAll((await service.subscribe("anna", chatId))!);
}

describe("пауза хода ради подтверждения внутри помощника", () => {
  it("помощник дошёл до инструмента с needsApproval — его шаги и pendingApproval в части, ход ждёт человека", async () => {
    const { execute, model, service } = setup();
    const { chat } = await askInNewChat(service);
    const answer = await lastAnswer(service, chat.id);
    expect(answer.metadata?.status).toBe("awaiting_approval");
    expect(helperPart(answer.parts, "cleaner")!.output).toMatchObject({
      status: "awaiting_approval",
      pendingApproval: { approvalId: expect.any(String), toolName: "remove", title: "Удалить файл", input: { path: "a" } },
      steps: [{ type: "tool", toolName: "remove", input: { path: "a" } }],
    });
    expect(execute).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(1);
    // Основной цикл встал: модель основного агента не видит незаконченного помощника.
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("у инструмента без title в pendingApproval нет названия — экран покажет имя инструмента", async () => {
    const remove = tool({ description: "Удалить", inputSchema: z.object({ path: z.string() }), needsApproval: true, execute: async () => "ок" });
    const model = helperChatModel({ stream: [callsHelper("h1", "cleaner", "убери a")], generate: [helperCalls({ id: "r1", toolName: "remove", input: { path: "a" } })] });
    const { service } = helperService({ model, helpers: { cleaner: researchHelper({ tools: { remove } }) } });
    const { chat } = await askInNewChat(service);
    const pending = helperPart((await lastAnswer(service, chat.id)).parts, "cleaner")!.output!.pendingApproval;
    expect(pending).toMatchObject({ toolName: "remove" });
    expect(pending).not.toHaveProperty("title");
  });

  it("pendingHumanInput и pendingApprovals видят подтверждение помощника", async () => {
    const { service } = setup();
    const { chat } = await askInNewChat(service);
    const { parts } = await lastAnswer(service, chat.id);
    expect(pendingHumanInput(parts)).toHaveLength(1);
    expect(pendingApprovals(parts)).toEqual([{ approvalId: await pendingApprovalId(service, chat.id), toolName: "remove" }]);
  });

  it("«Разрешить» — сначала досчитывается помощник с сохранёнными шагами, потом основной цикл", async () => {
    const { execute, model, service } = setup();
    const { chat } = await askInNewChat(service);
    await answerAndWait(service, chat.id, await pendingApprovalId(service, chat.id), "allow");
    expect(execute).toHaveBeenCalledOnce();
    expect(model.doGenerateCalls).toHaveLength(2);
    const helperPrompt = JSON.stringify(model.doGenerateCalls[1]!.prompt);
    expect(helperPrompt).toContain("убери a");
    expect(helperPrompt).toContain("удалено a");
    const answer = await lastAnswer(service, chat.id);
    expect(answer.metadata?.status).toBe("complete");
    const output = helperPart(answer.parts, "cleaner")!.output!;
    expect(output).toMatchObject({ status: "done", text: "Убрал a" });
    expect(output.pendingApproval).toBeUndefined();
    expect(output).not.toHaveProperty("resume");
    expect(model.doStreamCalls).toHaveLength(2);
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain("Убрал a");
  });

  it("«Всегда» для помощника — обычное «Разрешить»", async () => {
    const { execute, service } = setup();
    const { chat } = await askInNewChat(service);
    await answerAndWait(service, chat.id, await pendingApprovalId(service, chat.id), "always");
    expect(execute).toHaveBeenCalledOnce();
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("complete");
  });

  it("«Отклонить» — помощник получает отказ и заканчивает работу, инструмент не выполнен", async () => {
    const { execute, model, service } = setup();
    const { chat } = await askInNewChat(service);
    await answerAndWait(service, chat.id, await pendingApprovalId(service, chat.id), "deny");
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain(DENIED_BY_USER_REASON);
    const answer = await lastAnswer(service, chat.id);
    expect(answer.metadata?.status).toBe("complete");
    expect(helperPart(answer.parts, "cleaner")!.output).toMatchObject({
      status: "done",
      steps: [{ type: "tool", toolName: "remove", error: DENIED_BY_USER_REASON }, { type: "text", text: "Убрал a" }],
    });
  });

  it("продолжение работает в новом экземпляре службы на той же базе", async () => {
    const { execute, service, storage, build } = setup();
    const { chat } = await askInNewChat(service);
    const approvalId = await pendingApprovalId(service, chat.id);
    const restarted = build(storage);
    await answerAndWait(restarted, chat.id, approvalId, "allow");
    expect(execute).toHaveBeenCalledOnce();
    expect(helperPart((await lastAnswer(restarted, chat.id)).parts, "cleaner")!.output).toMatchObject({ status: "done", text: "Убрал a" });
  });

  it("новое сообщение человека закрывает подтверждение помощника как обычное", async () => {
    const { execute, model, service } = setup();
    const { chat } = await askInNewChat(service);
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "не надо")));
    expect(execute).not.toHaveBeenCalled();
    const { messages } = await service.getHistory("anna", chat.id);
    const closed = messages.find((message) => message.role === "assistant")!;
    expect(helperPart(closed.parts, "cleaner")!.output).toMatchObject({ status: "failed", error: IGNORED_REASON });
    expect(pendingHumanInput(closed.parts)).toEqual([]);
    expect(JSON.stringify(model.doStreamCalls.at(-1)!.prompt)).toContain(IGNORED_REASON);
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("complete");
  });

  it("помощник без инструментов, требующих подтверждения, не останавливается", async () => {
    const { execute, service } = setup(() => false);
    const { chat } = await askInNewChat(service);
    expect(execute).toHaveBeenCalledOnce();
    const answer = await lastAnswer(service, chat.id);
    expect(answer.metadata?.status).toBe("complete");
    expect(helperPart(answer.parts, "cleaner")!.output).toMatchObject({ status: "done", text: "Убрал a" });
  });
});
