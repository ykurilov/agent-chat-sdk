import { tool } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { latestFrozenContextOf } from "../../src/frozen-context/context-blocks";
import { APP_STATE_PART_TYPE } from "../../src/app-state/app-state";
import { readAll, streamStart, summarizingModel } from "./support/mock-model";
import { callTool, lastUserTexts, noticeService, saying, scriptedModel, userMessage, waitTurn } from "./support/notice-chat";

const blocks = (text: string) => [{ key: "profile", text }];
const ask = async (service: ReturnType<typeof noticeService>["service"], chatId: string, id: string) => readAll(await service.sendMessage("anna", chatId, userMessage(id, id)));
type Model = ReturnType<typeof scriptedModel>;
const plain = (model: Model, index: number) => model.doStreamCalls[index]!.prompt.map(message => JSON.stringify(message).replace(/,"providerOptions":\{[^}]*\{[^}]*\}\}/g, ""));

describe("agent.contextBlocksRefresh", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-01-01T12:00:00Z")); });
  afterEach(() => vi.useRealTimers());

  it("неверная политика отклоняется при создании службы", () => {
    expect(() => noticeService(scriptedModel(), { agent: { contextBlocksRefresh: "never" as never } })).toThrow(/contextBlocksRefresh/);
  });

  it("default и явный turn дают прежние байты и перечитывают каждый ход", async () => {
    const prompts = [];
    for (const mode of [undefined, "turn"] as const) {
      const model = scriptedModel([saying("A"), saying("B")]);
      const source = vi.fn().mockReturnValueOnce(blocks("APP_A")).mockReturnValueOnce(blocks("APP_B"));
      const { service } = noticeService(model, { agent: { contextBlocks: source, ...(mode && { contextBlocksRefresh: mode }) } });
      const chat = await service.createChat("anna");
      await ask(service, chat.id, "u1"); await ask(service, chat.id, "u2");
      expect(source).toHaveBeenCalledTimes(2);
      prompts.push(plain(model, 1));
      expect(lastUserTexts(model.doStreamCalls[1]!)).toContain("APP_B");
    }
    expect(prompts[1]).toEqual(prompts[0]);
  });

  it("перезапуск службы, regenerate, поздняя правка и возврат на ветку используют её снимок; правка корня читает заново", async () => {
    const model = scriptedModel();
    const source = vi.fn(() => blocks("APP_A"));
    const agent = { contextBlocks: source, contextBlocksRefresh: "history-start" as const };
    const first = noticeService(model, { agent });
    const chat = await first.service.createChat("anna");
    await ask(first.service, chat.id, "u1"); await ask(first.service, chat.id, "u2");
    const original = (await first.storage.listMessages(chat.id)).at(-1)!.id;
    await first.service.flush();
    source.mockImplementation(() => blocks("APP_B"));
    const { service } = noticeService(model, { storage: first.storage, agent });
    await readAll(await service.regenerate("anna", chat.id, original));
    await readAll(await service.editMessage("anna", chat.id, "u2", userMessage("u2-edit", "edited")));
    expect(source).toHaveBeenCalledTimes(1);
    await readAll(await service.editMessage("anna", chat.id, "u1", userMessage("new-root", "new root")));
    expect(source).toHaveBeenCalledTimes(2);
    expect(lastUserTexts(model.doStreamCalls.at(-1)!)).toContain("APP_B");
    await service.selectBranch("anna", chat.id, "u1");
    await ask(service, chat.id, "old-branch-next");
    expect(source).toHaveBeenCalledTimes(2);
    const last = JSON.stringify(model.doStreamCalls.at(-1)!.prompt);
    expect(last).toContain("APP_A"); expect(last).not.toContain("APP_B");
  });

  it("снимки разных чатов изолированы; reuse по-прежнему фильтрует private в группе", async () => {
    const model = scriptedModel();
    const source = vi.fn(({ ownerId }: { ownerId: string }) => [{ key: "profile", text: `PRIVATE_${ownerId}`, private: true }, { key: "public", text: "PUBLIC_RULE" }]);
    const { service } = noticeService(model, { agent: { contextBlocks: source, contextBlocksRefresh: "history-start" } });
    const a = await service.createChat("anna"); const b = await service.createChat("boris");
    await ask(service, a.id, "anna-u1");
    await readAll(await service.sendMessage("boris", b.id, userMessage("boris-u1", "привет")));
    expect(source).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain("PRIVATE_boris");
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).not.toContain("PRIVATE_anna");
    await readAll(await service.sendMessage("anna", a.id, userMessage("anna-group", "группа"), { group: { author: "Anna", allowedTools: [] } }));
    expect(source).toHaveBeenCalledTimes(2);
    const group = JSON.stringify(model.doStreamCalls.at(-1)!.prompt);
    expect(group).toContain("PUBLIC_RULE"); expect(group).not.toContain("PRIVATE_anna");
  });

  it.each([false, true])("timeout и retry: completed tool steps = %s; новый ответ перечитывает, настоящее continuation сохраняет frozen", async (withSteps) => {
    const failure = [streamStart, { type: "error" as const, error: new Error("provider error") }];
    const model = scriptedModel(withSteps ? [callTool("read", "c1"), failure] : [failure]);
    const execute = vi.fn(async () => "ok");
    const source = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(blocks("RECOVERED"));
    let preparation = 0;
    const { service, storage } = noticeService(model, { agent: { contextBlocks: source, contextBlocksRefresh: "history-start", contextBlocksTimeoutMs: 1_000,
      prepareTurn: () => ++preparation === 1 ? { set: { failedOnly: "NO_TRANSFER" } } : undefined,
      tools: { read: tool({ description: "read", inputSchema: z.object({}), execute }) },
    } });
    const chat = await service.createChat("anna");
    await ask(service, chat.id, "u1");
    const answer = (await storage.listMessages(chat.id)).at(-1)!;
    expect(latestFrozenContextOf(answer.parts)?.appContextFrom).toBeUndefined();
    await readAll(await service.retry("anna", chat.id));
    expect(source).toHaveBeenCalledTimes(withSteps ? 1 : 2);
    expect(execute).toHaveBeenCalledTimes(withSteps ? 1 : 0);
    if (!withSteps) {
      expect((await storage.listMessages(chat.id)).at(-1)!.parts.some(p => p.type === APP_STATE_PART_TYPE)).toBe(false);
      expect((await service.getChatState("anna", chat.id)).values.failedOnly).toBeUndefined();
    }
    await ask(service, chat.id, "u2"); await ask(service, chat.id, "u3");
    expect(source).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(model.doStreamCalls.at(-1)!.prompt).split("RECOVERED")).toHaveLength(2);
  });

  it("Стоп при чтении не подтверждает снимок и не мешает успешному чтению в новом ходе", async () => {
    let started!: () => void;
    const readingStarted = new Promise<void>(resolve => { started = resolve; });
    const source = vi.fn().mockImplementationOnce(() => { started(); return new Promise(() => {}); }).mockResolvedValue(blocks("AFTER_STOP"));
    const { service, storage } = noticeService(scriptedModel(), { agent: { contextBlocks: source, contextBlocksRefresh: "history-start" } });
    const chat = await service.createChat("anna");
    const reading = ask(service, chat.id, "u1");
    await readingStarted; await service.stop("anna", chat.id); await reading;
    for (const message of await storage.listMessages(chat.id)) expect(latestFrozenContextOf(message.parts)?.appContextFrom).toBeUndefined();
    await ask(service, chat.id, "u2"); await ask(service, chat.id, "u3");
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("compaction меняет начало: один новый опрос и полный snapshot; следующий prefix неизменён", async () => {
    const model = summarizingModel("## Цель\nсводка", [100, 200, 300, 400, 500, 600, 700]);
    const source = vi.fn(() => blocks("APP_A"));
    const { service, storage } = noticeService(model, { agent: { contextBlocks: source, contextBlocksRefresh: "history-start" }, compaction: { thresholdTokens: 1_000_000, tailTokens: 100, summaryCeilingTokens: 100 } });
    const chat = await service.createChat("anna");
    for (let n = 1; n <= 5; n++) await ask(service, chat.id, `u${n}`);
    expect(source).toHaveBeenCalledTimes(1);
    expect(await service.compactNow("anna", chat.id)).toBe("compacted");
    source.mockImplementation(() => blocks("APP_B"));
    await ask(service, chat.id, "after-compaction");
    expect(source).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(model.doStreamCalls.at(-1)!.prompt).split("APP_B")).toHaveLength(2);
    const before = plain(model, model.doStreamCalls.length - 1);
    await ask(service, chat.id, "after-next");
    expect(source).toHaveBeenCalledTimes(2);
    expect(plain(model, model.doStreamCalls.length - 1).slice(0, before.length)).toEqual(before);
    const root = latestFrozenContextOf((await storage.listMessages(chat.id)).at(-1)!.parts)?.appContextFrom;
    expect(typeof root).toBe("string"); expect(root).not.toBe("u1");
  });

  it("включение на старом paused answer фиксирует metadata-only note; notices на следующих resume не стирают marker", async () => {
    const model = scriptedModel([callTool("gate", "c1"), callTool("gate", "c2"), saying("Done"), saying("Next")]);
    const source = vi.fn(() => blocks("APP_A"));
    const tools = { gate: tool({ description: "gate", inputSchema: z.object({}), needsApproval: true, execute: async () => "ok" }) };
    const original = noticeService(model, { agent: { tools, contextBlocks: source } });
    const chat = await original.service.createChat("anna");
    await ask(original.service, chat.id, "u1");
    await original.service.flush();
    let notices = false;
    const { service, storage } = noticeService(model, { storage: original.storage, agent: { tools, contextBlocks: source, contextBlocksRefresh: "history-start", prepareTurn: () => notices ? { notices: [{ kind: "app", title: "APP_NOTICE" }] } : undefined } });
    const approve = async () => {
      const answer = (await storage.listMessages(chat.id)).at(-1)!;
      const part = answer.parts.find(p => (p as { state?: string }).state === "approval-requested") as unknown as { approval: { id: string } };
      await service.answerApproval("anna", chat.id, part.approval.id, "allow"); await waitTurn(service, chat.id);
    };
    await approve();
    expect(source).toHaveBeenCalledTimes(2);
    expect(latestFrozenContextOf((await storage.listMessages(chat.id)).at(-1)!.parts)?.appContextFrom).toBe("u1");
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt).split("APP_A")).toHaveLength(2);
    expect(plain(model, 1).slice(0, plain(model, 0).length)).toEqual(plain(model, 0));
    notices = true; await approve(); notices = false;
    expect(source).toHaveBeenCalledTimes(2);
    await ask(service, chat.id, "u2");
    const completed = (await storage.listMessages(chat.id)).at(-1)!;
    await readAll(await service.regenerate("anna", chat.id, completed.id));
    expect(source).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(model.doStreamCalls.at(-1)!.prompt).split("APP_NOTICE")).toHaveLength(2);
    expect(lastUserTexts(model.doStreamCalls.at(-1)!)).toEqual(["u2"]);
    expect(JSON.stringify((await service.getHistory("anna", chat.id)).messages)).not.toContain("appContextFrom");
  });
});
