import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { endTurn } from "../../src/index";
import { finishPart, readAll, streamStart } from "./support/mock-model";
import { noticeService, saying, scriptedModel, userMessage } from "./support/notice-chat";

const textOf = (chunks: UIMessageChunk[]) => chunks.flatMap((chunk) => chunk.type === "text-delta" ? [chunk.delta] : []).join("");
const call = { type: "tool-call", toolCallId: "s1", toolName: "save", input: "{}" } as const;
const turn = (text = ""): LanguageModelV4StreamPart[] => [...(text ? saying(text).slice(0, -1) : [streamStart]), call, finishPart("tool-calls")];
const guarded = (needsApproval = false) => tool({ description: "Save section", inputSchema: z.object({}), needsApproval, execute: vi.fn(async () => endTurn({ saved: true }, { requireText: true })) });

function setup(scripts: LanguageModelV4StreamPart[][], needsApproval = false) {
  const model = scriptedModel(scripts);
  const save = guarded(needsApproval);
  return { ...noticeService(model, { agent: { tools: { save } } }), model, save };
}

describe("endTurn requireText", () => {
  it.each(["", " \n\t\u00a0", "\u200b\u200d\u2060\ufeff"])("without visible text %j, keeps output and lets the model continue", async (text) => {
    const { model, service, storage, save } = setup([turn(text), saying("Раздел сохранён.")]);
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сохрани")));
    expect(model.doStreamCalls).toHaveLength(2);
    expect(textOf(chunks)).toContain("Раздел сохранён.");
    expect(save.execute).toHaveBeenCalledOnce();
    const answer = (await storage.listMessages(chat.id)).at(-1)!;
    expect(answer.status).toBe("complete");
    expect(answer.parts.find((part) => part.type === "tool-save")).toMatchObject({ state: "output-available", output: { saved: true } });
  });

  it("text first in the same step ends without another provider call", async () => {
    const { model, service } = setup([turn("Раздел сохранён.")]);
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сохрани")));
    expect(model.doStreamCalls).toHaveLength(1);
    expect(textOf(chunks)).toBe("Раздел сохранён.");
  });

  it("reasoning and previous assistant turns are not visible current text", async () => {
    const reasoning: LanguageModelV4StreamPart[] = [streamStart, { type: "reasoning-start", id: "r" }, { type: "reasoning-delta", id: "r", delta: "План" }, { type: "reasoning-end", id: "r" }, call, finishPart("tool-calls")];
    const { model, service } = setup([saying("Прежний ответ."), reasoning, saying("Новый ответ.")]);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Сохрани")));
    expect(model.doStreamCalls).toHaveLength(3);
    expect(textOf(chunks)).toBe("Новый ответ.");
  });

  it("parallel tool outputs are preserved but do not replace user-facing text", async () => {
    const save = guarded();
    const lookup = vi.fn(async () => "Tool result text");
    const model = scriptedModel([[streamStart, call, { type: "tool-call", toolCallId: "l1", toolName: "lookup", input: "{}" }, finishPart("tool-calls")], saying("Готово.")]);
    const { service } = noticeService(model, { agent: { tools: { save, lookup: tool({ description: "Lookup", inputSchema: z.object({}), execute: lookup }) } } });
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сохрани")));
    expect(model.doStreamCalls).toHaveLength(2);
    expect(save.execute).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledOnce();
    expect(textOf(chunks)).toBe("Готово.");
  });

  it("uses accepted stream text even when intermediate storage writes fail", async () => {
    const { model, service, storage, save } = setup([turn("Сохранено.")]);
    const write = storage.updateStreamingMessage.bind(storage);
    let failedTextWrites = 0;
    let intentSaved = false;
    vi.spyOn(storage, "updateStreamingMessage").mockImplementation(async (id, patch) => {
      if (intentSaved) {
        failedTextWrites += 1;
        throw new Error("temporary intermediate write failure");
      }
      // Сначала сохраняем намерение действия. Сбои последующих снимков не отменяют принятый текст.
      await write(id, patch);
      intentSaved = patch.parts?.some((part) => "toolCallId" in part) ?? false;
    });
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сохрани")));
    expect(model.doStreamCalls).toHaveLength(1);
    expect(textOf(chunks)).toBe("Сохранено.");
    expect(failedTextWrites).toBeGreaterThan(0);
    expect(save.execute).toHaveBeenCalledOnce();
  });

  it("explicit output text remains supported with requireText", async () => {
    const model = scriptedModel([turn()]);
    const { service } = noticeService(model, { agent: { tools: { save: tool({ description: "Save", inputSchema: z.object({}), execute: () => endTurn("ok", { requireText: true, text: "Явный текст." }) }) } } });
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сохрани")));
    expect(model.doStreamCalls).toHaveLength(1);
    expect(textOf(chunks)).toBe("Явный текст.");
  });

  it("does not override the step limit or invent an acknowledgement", async () => {
    const model = scriptedModel([turn()]);
    const afterTurn = vi.fn();
    const { service } = noticeService(model, { afterTurn, agent: { tools: { save: guarded() }, maxSteps: 1 } });
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сохрани")));
    expect(model.doStreamCalls).toHaveLength(1);
    expect(textOf(chunks)).toBe("");
    expect(afterTurn.mock.calls[0]![0]).toMatchObject({ status: "complete", stepLimit: true });
  });

  it("cancellation while a guarded tool finishes cannot trigger another request", async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const model = scriptedModel([turn()]);
    const { service, storage } = noticeService(model, { agent: { tools: { save: tool({ description: "Save", inputSchema: z.object({}), execute: async () => { entered(); await gate; return endTurn("ok", { requireText: true }); } }) } } });
    const chat = await service.createChat("anna");
    const consumed = readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сохрани")));
    await started;
    const stopping = service.stop("anna", chat.id);
    release();
    expect(await stopping).toBe(true);
    const chunks = await consumed;
    expect(textOf(chunks)).toBe("");
    expect(model.doStreamCalls).toHaveLength(1);
    expect((await storage.listMessages(chat.id)).at(-1)!.status).toBe("stopped");
  });

  it.each([false, true])("approval resume uses only its active answer, existing text=%s", async (withText) => {
    const { model, service, storage } = setup([turn(withText ? "Проверено." : ""), saying("Сохранено.")], true);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Сохрани")));
    const waiting = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    const approvalId = (waiting.parts.find((part) => part.type === "tool-save") as { approval: { id: string } }).approval.id;
    await service.answerApproval("anna", chat.id, approvalId, "allow");
    const stream = await service.subscribe("anna", chat.id);
    if (stream) await readAll(stream);
    expect(model.doStreamCalls).toHaveLength(withText ? 1 : 2);
    expect((await storage.listMessages(chat.id)).at(-1)!.status).toBe("complete");
  });
});
