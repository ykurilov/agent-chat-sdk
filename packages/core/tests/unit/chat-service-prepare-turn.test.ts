import { tool } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { APP_STATE_PART_TYPE } from "../../src/app-state/app-state";
import { createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import type { ContextBlocksInput } from "../../src/frozen-context/context-blocks";
import { FROZEN_CONTEXT_PART_TYPE } from "../../src/frozen-context/context-blocks";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { PrepareTurn, PrepareTurnContext } from "../../src/turn-hooks/prepare-turn";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";
import { callTool, doneNotice, lastUserTexts, saying, scriptedModel, userMessage, waitTurn } from "./support/notice-chat";

function build(agent: Partial<ChatServiceOptions["agent"]> = {}) {
  const model = mockModel(() => streamOf([streamStart, ...textParts(["Готово"]), finishPart()]));
  const storage = createInMemoryChatStorage();
  const logged: string[] = [];
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", ...agent },
    env: mockEnv,
    logError: (line) => void logged.push(String(line)),
  });
  return { service, storage, model, logged };
}

const bytes = (prompt: unknown[]) => prompt.map((message) => JSON.stringify(message));
const answerOf = async (service: ReturnType<typeof build>["service"], chatId: string) =>
  (await service.getHistory("anna", chatId))!.messages.findLast((message) => message.role === "assistant")!;

describe("agent.prepareTurn: запись состояния в начале хода", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 1, 12));
  });
  afterEach(() => vi.useRealTimers());

  it("получает чат, ответ, состояние, действие, пояс человека и время", async () => {
    const seen: PrepareTurnContext[] = [];
    const { service } = build({ prepareTurn: (context) => void seen.push(context) });
    const chat = await service.createChat("anna", { data: { formId: "f1" } });
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет"), { page: { timeZone: "Asia/Tokyo" } }));

    expect(seen).toHaveLength(1);
    const answer = await answerOf(service, chat.id);
    expect(seen[0]).toMatchObject({
      ownerId: "anna",
      chatId: chat.id,
      messageId: answer.id,
      chat: { id: chat.id, data: { formId: "f1" } },
      state: {},
      action: "send",
      notices: [],
      timeZone: "Asia/Tokyo",
    });
    expect(seen[0]!.abortSignal).toBeInstanceOf(AbortSignal);
    expect(seen[0]!.now.getTime()).toBe(new Date(2026, 0, 1, 12).getTime());
  });

  it("запись видна блокам контекста этого же хода, лежит в начале ответа за блоками и в состоянии чата", async () => {
    const blocksSaw: ContextBlocksInput[] = [];
    const { service } = build({
      prepareTurn: () => ({ set: { stage: "intro" } }),
      contextBlocks: (input) => {
        blocksSaw.push(input);
        return [{ key: "stage", text: `Этап: ${String(input.state?.["stage"])}` }];
      },
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));

    expect(blocksSaw[0]!.state).toEqual({ stage: "intro" });
    expect((await service.getChatState("anna", chat.id)).values).toEqual({ stage: "intro" });
    const { parts } = (await answerOf(service, chat.id)) as { parts: Array<{ type: string; data?: unknown }> };
    expect(parts.findIndex((part) => part.type === APP_STATE_PART_TYPE)).toBeLessThan(parts.findIndex((part) => part.type === "text"));
    expect(parts.find((part) => part.type === APP_STATE_PART_TYPE)!.data).toEqual({ set: { stage: "intro" } });
  });

  it("часть застывших блоков в записи первая, записи состояния сразу за ней", async () => {
    const { service, storage } = build({ prepareTurn: () => ({ set: { stage: "intro" }, unset: ["old"] }) });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    const answer = (await storage.listMessages(chat.id)).findLast((message) => message.role === "assistant")!;
    const types = answer.parts.map((part) => part.type).filter((type) => type !== "step-start");
    expect(types.slice(0, 2)).toEqual([FROZEN_CONTEXT_PART_TYPE, APP_STATE_PART_TYPE]);
  });

  it("правка вопроса: подготовка видит состояние ветки до правленого хода, запись уходит вместе с веткой", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { service } = build({
      prepareTurn: ({ state }) => {
        seen.push(state);
        return { set: { n: ((state["n"] as number | undefined) ?? 0) + 1 } };
      },
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "раз")));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "два")));
    expect((await service.getChatState("anna", chat.id)).values).toEqual({ n: 2 });

    await readAll(await service.editMessage("anna", chat.id, "u2", userMessage("u2b", "два, но иначе")));
    expect(seen).toEqual([{}, { n: 1 }, { n: 1 }]);
    expect((await service.getChatState("anna", chat.id)).values).toEqual({ n: 2 });
  });

  it("ошибка подготовки: ход идёт без записей, строка в журнале", async () => {
    const { service, storage, model, logged } = build({
      prepareTurn: () => {
        throw new Error("база недоступна");
      },
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    expect(model.doStreamCalls).toHaveLength(1);
    expect((await service.getChatState("anna", chat.id)).values).toEqual({});
    expect(logged.some((line) => line.includes("[prepareTurn]") && line.includes("база недоступна"))).toBe(true);
    expect((await storage.listMessages(chat.id)).at(-1)).toMatchObject({ role: "assistant", status: "complete" });
  });

  it("служебный ключ или не-JSON — отказ всей записи, строка в журнале", async () => {
    const { service, logged } = build({ prepareTurn: () => ({ set: { ok: 1, $closed: true } }) });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    expect((await service.getChatState("anna", chat.id)).values).toEqual({});
    expect(logged.some((line) => line.includes("[prepareTurn]"))).toBe(true);
  });

  it("ход по служебному сообщению: действие notice и сами сообщения", async () => {
    const seen: PrepareTurnContext[] = [];
    const { service } = build({ prepareTurn: (context) => void seen.push(context) });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    await service.deliverNotices({ ownerId: "anna", chatId: chat.id, notices: [doneNotice("Отчёт", "готово")], wakeAgent: true, deliveryKey: "k1" });
    await waitTurn(service, chat.id);
    expect(seen.map((context) => context.action)).toEqual(["send", "notice"]);
    expect(seen[1]!.notices).toEqual([doneNotice("Отчёт", "готово")]);
  });

  it("служебные сообщения подготовки модель видит в вопросе этого хода; следующий ход начинается теми же байтами", async () => {
    let turn = 0;
    const { service, model } = build({
      prepareTurn: () => (++turn === 1 ? { notices: [{ kind: "app", name: "flow_timer", title: "Сработал таймер: напомни про оплату" }] } : undefined),
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё")));

    const first = model.doStreamCalls[0]!.prompt;
    const second = model.doStreamCalls[1]!.prompt;
    expect(lastUserTexts(model.doStreamCalls[0]!)).toContain("Сработал таймер: напомни про оплату");
    expect(lastUserTexts(model.doStreamCalls[1]!)).not.toContain("Сработал таймер: напомни про оплату");
    // Метка кэша стоит на последнем сообщении и сдвигается: сравнение без неё.
    const plain = (prompt: unknown[]) => bytes(prompt).map((text) => text.replace(/,"providerOptions":\{[^}]*\{[^}]*\}\}/g, ""));
    expect(plain(second).slice(0, first.length)).toEqual(plain(first));
  });
});

describe("agent.prepareTurn на продолжении после подтверждения", () => {
  it("действие approval; сообщения подготовки — заметкой сразу за ответом человека, записи — в том же ответе", async () => {
    const model = scriptedModel([callTool("confirm", "c1"), saying("Готово")]);
    const storage = createInMemoryChatStorage();
    const actions: string[] = [];
    const service = createChatService({
      storage,
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: {
        instructions: "Ты помощник.",
        tools: { confirm: tool({ description: "Подтвердить", inputSchema: z.object({}), needsApproval: true, execute: async () => "подтверждено" }) },
        prepareTurn: ({ action }) => {
          actions.push(action);
          return action === "approval" ? { set: { approved: true }, notices: [{ kind: "app", title: "Человек подтвердил" }] } : undefined;
        },
      },
      env: mockEnv,
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "подтверди")));
    const paused = (await storage.listMessages(chat.id)).at(-1)!;
    const approval = (paused.parts.find((part) => part.type === "tool-confirm") as unknown as { approval: { id: string } }).approval.id;
    await service.answerApproval("anna", chat.id, approval, "allow");
    await waitTurn(service, chat.id);

    expect(actions).toEqual(["send", "approval"]);
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain("Человек подтвердил");
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).not.toContain("Человек подтвердил");
    expect((await service.getChatState("anna", chat.id)).values).toEqual({ approved: true });
    const answer = (await storage.listMessages(chat.id)).at(-1)!;
    expect(answer.id).toBe(paused.id);
    expect(answer.parts.filter((part) => part.type === FROZEN_CONTEXT_PART_TYPE)).toHaveLength(2);
  });
});

describe("кэш модели: без prepareTurn запрос побайтно прежний", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 1, 12));
  });
  afterEach(() => vi.useRealTimers());

  async function prompts(agent: Partial<ChatServiceOptions["agent"]>) {
    const { service, model } = build(agent);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё")));
    expect(model.doStreamCalls).toHaveLength(2);
    return JSON.stringify(model.doStreamCalls.map((call) => ({ prompt: call.prompt, tools: call.tools, providerOptions: call.providerOptions })));
  }

  it("подготовка без записей даёт те же запросы, что и служба без неё", async () => {
    const without = await prompts({});
    expect(await prompts({ prepareTurn: () => undefined })).toBe(without);
    expect(await prompts({ prepareTurn: async () => ({}) })).toBe(without);
  });
});
