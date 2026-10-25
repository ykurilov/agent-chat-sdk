import { tool } from "ai";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { ChatBusyError } from "../../src/running-answers/running-answer-registry";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { readAll, finishPart, streamStart } from "./support/mock-model";
import { noticeService, scriptedModel, saying, userMessage, waitTurn } from "./support/notice-chat";
import { CHOICE_INPUT, widgetCall } from "./support/widget-chat";

afterEach(() => vi.useRealTimers());

it.each(["approval", "widget", "two-approvals"] as const)("%s: продолжение требует своё поколение, пока afterTurn другой копии ещё держит аренду", async (kind) => {
  const memory = createInMemoryChatStorage();
  let open!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  const inHook = new Promise<void>((resolve) => { entered = resolve; });
  const execute = vi.fn(async () => "done");
  const agent = kind === "widget" ? { widgets: { basic: ["ask_choice" as const] } } : {
    tools: { effect: tool({ description: "Effect", inputSchema: z.object({}), needsApproval: true, execute }) },
  };
  const calls = kind === "widget" ? [widgetCall("w1", "ask_choice", CHOICE_INPUT)] :
    [widgetCall("c1", "effect", {}), ...(kind === "two-approvals" ? [widgetCall("c2", "effect", {})] : [])];
  const first = noticeService(scriptedModel([[streamStart, ...calls, finishPart("tool-calls")]]), {
    storage: memory, agent,
    afterTurn: async ({ status }) => { if (status === "awaiting_approval") { entered(); await gate; } },
  });
  const secondModel = scriptedModel([saying("Готово")]);
  const second = noticeService(secondModel, { storage: memory, agent });
  const chat = await first.service.createChat("anna");
  const reading = readAll(await first.service.sendMessage("anna", chat.id, userMessage("resume-human", "Начни")));
  try {
    await inHook;
    const waiting = (await memory.listMessages(chat.id)).find((m) => m.status === "awaiting_approval")!;
    const approvals = waiting.parts.flatMap((p) => "approval" in p ? [(p as { approval: { id: string } }).approval.id] : []);
    if (kind === "two-approvals") {
      expect(await second.service.answerApproval("anna", chat.id, approvals[0]!, "allow")).toEqual({ resumed: false });
    }
    const resume = () => kind === "widget" ?
      second.service.answerWidget({ ownerId: "anna", chatId: chat.id, toolCallId: "w1", answer: { выбрано: "Про" } }) :
      second.service.answerApproval("anna", chat.id, approvals.at(-1)!, "allow");
    await expect(resume()).rejects.toBeInstanceOf(ChatBusyError);
    expect((await memory.getMessage(waiting.id))?.status).toBe("awaiting_approval");
    expect(execute).not.toHaveBeenCalled();
    expect(secondModel.doStreamCalls).toHaveLength(0);
    open();
    await reading;
    expect(await resume()).toEqual({ resumed: true });
    await waitTurn(second.service, chat.id);
    expect((await memory.getMessage(waiting.id))?.status).toBe("complete");
    if (kind !== "widget") expect(execute).toHaveBeenCalledTimes(kind === "two-approvals" ? 2 : 1);
  } finally {
    open();
    await reading;
    await waitTurn(second.service, chat.id);
    await first.service.flush();
    await second.service.flush();
  }
});
