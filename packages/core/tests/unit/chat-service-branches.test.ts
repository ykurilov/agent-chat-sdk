import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ChatNotFoundError, InvalidMessageError, createChatService } from "../../src/chat-service";
import type { ChatServiceOptions } from "../../src/chat-service";
import { ChatBusyError } from "../../src/running-answers/running-answer-registry";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import {
  controlledModel,
  generateResult,
  mockCatalog,
  mockEnv,
  mockModelId,
  readAll,
  streamOf,
  streamStart,
  textParts,
} from "./support/mock-model";

/** Модель отвечает «ответ N» по порядку вызовов; `contexts` — размер контекста после каждого ответа (для сжатия). */
function numberedModel(contexts: number[] = [100]) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const context = contexts[call] ?? contexts.at(-1)!;
      call += 1;
      return {
        stream: streamOf([
          streamStart,
          ...textParts([`ответ ${call}`]),
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: context - 10, noCache: context - 10, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 10, text: 10, reasoning: 0 },
            },
          },
        ]),
      };
    },
    doGenerate: async () => generateResult("## Цель\nсводка", { output: 20 }),
  });
}

const user = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

function setup(model: MockLanguageModelV4, extra: Partial<ChatServiceOptions> = {}) {
  const storage = createInMemoryChatStorage();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    compaction: false,
    env: mockEnv,
    logError: vi.fn(),
    ...extra,
  });
  return { service, storage };
}

type Service = ReturnType<typeof setup>["service"];

async function ask(service: Service, chatId: string, id: string, text: string) {
  await readAll(await service.sendMessage("anna", chatId, user(id, text)));
}

/** Тексты текущей ветки: вопросы как есть, ответы — их первый текст. */
async function branchTexts(service: Service, chatId: string): Promise<string[]> {
  const { messages } = await service.getHistory("anna", chatId);
  return messages.map((message) => message.parts.map((part) => (part.type === "text" ? part.text : "")).join(""));
}

async function chatWithTwoTurns() {
  const model = numberedModel();
  const context = setup(model);
  const chat = await context.service.createChat("anna");
  await ask(context.service, chat.id, "u1", "привет");
  await ask(context.service, chat.id, "u2", "как дела");
  const { messages } = await context.service.getHistory("anna", chat.id);
  return { ...context, model, chat, answerIds: messages.filter((m) => m.role === "assistant").map((m) => m.id) };
}

describe("служба чата: переделка ответа", () => {
  it("новый ответ — сосед прежнего под тем же вопросом, прежний цел; развилка на ленте", async () => {
    const { service, storage, chat, answerIds } = await chatWithTwoTurns();
    await readAll(await service.regenerate("anna", chat.id, answerIds[1]!));

    const all = await storage.listMessages(chat.id);
    expect(all).toHaveLength(5);
    const old = all.find((message) => message.id === answerIds[1])!;
    expect(old.status).toBe("complete");
    const fresh = all.find((message) => message.parentId === "u2" && message.id !== answerIds[1])!;
    expect(fresh.role).toBe("assistant");

    expect(await branchTexts(service, chat.id)).toEqual(["привет", "ответ 1", "как дела", "ответ 3"]);
    const { forks } = await service.getHistory("anna", chat.id);
    expect(forks).toEqual([{ messageId: fresh.id, siblingIds: [answerIds[1], fresh.id] }]);
  });

  it("можно переделать и не последний ответ: под ним новая ветка, хвост прежней остаётся в хранилище", async () => {
    const { service, storage, chat, answerIds, model } = await chatWithTwoTurns();
    await readAll(await service.regenerate("anna", chat.id, answerIds[0]!));
    expect(await branchTexts(service, chat.id)).toEqual(["привет", "ответ 3"]);
    expect(await storage.listMessages(chat.id)).toHaveLength(5);
    // модель получила только «привет»
    expect(JSON.stringify(model.doStreamCalls[2]!.prompt)).not.toContain("как дела");
  });

  it("запрос к модели на переделку такой же, как на первый ответ: префикс не меняется (кэш)", async () => {
    const lookup = tool({ description: "Поиск.", inputSchema: z.object({ query: z.string() }), execute: async () => "x" });
    const model = numberedModel();
    const { service } = setup(model, { agent: { instructions: "Ты помощник.", tools: { lookup } } });
    const chat = await service.createChat("anna");
    await ask(service, chat.id, "u1", "привет");
    const { messages } = await service.getHistory("anna", chat.id);
    await readAll(await service.regenerate("anna", chat.id, messages[1]!.id));
    expect(model.doStreamCalls[1]!.prompt).toEqual(model.doStreamCalls[0]!.prompt);
    expect(model.doStreamCalls[1]!.tools).toEqual(model.doStreamCalls[0]!.tools);
  });

  it("не ответ агента, не на ветке или чужой чат — отказ, ничего не записано", async () => {
    const { service, storage, chat, answerIds } = await chatWithTwoTurns();
    await expect(service.regenerate("anna", chat.id, "u1")).rejects.toBeInstanceOf(InvalidMessageError);
    await expect(service.regenerate("anna", chat.id, "нет-такого")).rejects.toBeInstanceOf(InvalidMessageError);
    await expect(service.regenerate("boris", chat.id, answerIds[1]!)).rejects.toBeInstanceOf(ChatNotFoundError);
    await readAll(await service.regenerate("anna", chat.id, answerIds[0]!)); // ветка теперь «привет → ответ 3»
    await expect(service.regenerate("anna", chat.id, answerIds[1]!)).rejects.toBeInstanceOf(InvalidMessageError);
    expect(await storage.listMessages(chat.id)).toHaveLength(5);
  });

  it("пока идёт ответ — занят", async () => {
    const controlled = controlledModel();
    const { service } = setup(controlled.model);
    const chat = await service.createChat("anna");
    const stream = await service.sendMessage("anna", chat.id, user("u1", "привет"));
    await controlled.opened;
    await expect(service.regenerate("anna", chat.id, "любой")).rejects.toBeInstanceOf(ChatBusyError);
    controlled.push(streamStart, ...textParts(["ок"]));
    controlled.end();
    await readAll(stream);
  });
});

describe("служба чата: правка отправленного", () => {
  it("правка — новый вопрос рядом с прежним и новый ответ; модель не видит прежнего хвоста", async () => {
    const { service, storage, chat, answerIds, model } = await chatWithTwoTurns();
    await readAll(await service.editMessage("anna", chat.id, "u1", user("u1-v2", "здравствуй")));

    const all = await storage.listMessages(chat.id);
    expect(all).toHaveLength(6);
    expect(all.find((message) => message.id === "u1")!.parts).toEqual([{ type: "text", text: "привет" }]);
    expect(all.find((message) => message.id === "u1-v2")).toMatchObject({ parentId: null, role: "user" });

    expect(await branchTexts(service, chat.id)).toEqual(["здравствуй", "ответ 3"]);
    const prompt = JSON.stringify(model.doStreamCalls[2]!.prompt);
    expect(prompt).toContain("здравствуй");
    expect(prompt).not.toContain("привет");
    expect(prompt).not.toContain("как дела");

    const { forks } = await service.getHistory("anna", chat.id);
    expect(forks).toEqual([{ messageId: "u1-v2", siblingIds: ["u1", "u1-v2"] }]);
    expect(answerIds).toHaveLength(2);
  });

  it("правка внутри ветки: история до неё сохраняется", async () => {
    const { service, chat, model } = await chatWithTwoTurns();
    await readAll(await service.editMessage("anna", chat.id, "u2", user("u2-v2", "как жизнь")));
    expect(await branchTexts(service, chat.id)).toEqual(["привет", "ответ 1", "как жизнь", "ответ 3"]);
    const prompt = JSON.stringify(model.doStreamCalls[2]!.prompt);
    expect(prompt).toContain("привет");
    expect(prompt).toContain("ответ 1");
    expect(prompt).not.toContain("как дела");
  });

  it("правка после того, как человек листал ветки, всё равно становится текущей", async () => {
    const { service, chat } = await chatWithTwoTurns();
    await readAll(await service.editMessage("anna", chat.id, "u1", user("u1-v2", "здравствуй")));
    await service.selectBranch("anna", chat.id, "u1"); // вернулся к первой
    await readAll(await service.editMessage("anna", chat.id, "u1", user("u1-v3", "добрый день")));
    expect(await branchTexts(service, chat.id)).toEqual(["добрый день", "ответ 4"]);
    const { forks } = await service.getHistory("anna", chat.id);
    expect(forks[0]!.siblingIds).toEqual(["u1", "u1-v2", "u1-v3"]);
  });

  it("правится только вопрос собеседника на текущей ветке; пустой текст, чужой чат, повтор id — отказ без записи", async () => {
    const { service, storage, chat, answerIds } = await chatWithTwoTurns();
    await expect(service.editMessage("anna", chat.id, answerIds[0]!, user("x", "текст"))).rejects.toBeInstanceOf(InvalidMessageError);
    await expect(service.editMessage("anna", chat.id, "нет-такого", user("x", "текст"))).rejects.toBeInstanceOf(InvalidMessageError);
    await expect(service.editMessage("anna", chat.id, "u1", user("x", "   "))).rejects.toBeInstanceOf(InvalidMessageError);
    await expect(service.editMessage("boris", chat.id, "u1", user("x", "текст"))).rejects.toBeInstanceOf(ChatNotFoundError);
    await expect(service.editMessage("anna", chat.id, "u1", user("u2", "текст"))).rejects.toThrow();
    expect(await storage.listMessages(chat.id)).toHaveLength(4);
  });

  it("пока идёт ответ — занят", async () => {
    const controlled = controlledModel();
    const { service } = setup(controlled.model);
    const chat = await service.createChat("anna");
    const stream = await service.sendMessage("anna", chat.id, user("u1", "привет"));
    await controlled.opened;
    await expect(service.editMessage("anna", chat.id, "u1", user("u1-v2", "иначе"))).rejects.toBeInstanceOf(ChatBusyError);
    controlled.push(streamStart, ...textParts(["ок"]));
    controlled.end();
    await readAll(stream);
  });
});

describe("служба чата: переключение веток", () => {
  it("выбор записывается, текущей веткой становится выбранная вместе с её продолжением; сообщения не меняются", async () => {
    const { service, storage, chat } = await chatWithTwoTurns();
    await readAll(await service.editMessage("anna", chat.id, "u1", user("u1-v2", "здравствуй")));
    const before = await storage.listMessages(chat.id);

    const history = await service.selectBranch("anna", chat.id, "u1");
    expect(history.messages.map((message) => message.id)).toContain("u2");
    expect(await branchTexts(service, chat.id)).toEqual(["привет", "ответ 1", "как дела", "ответ 2"]);
    expect(history.forks).toEqual([{ messageId: "u1", siblingIds: ["u1", "u1-v2"] }]);
    expect(await storage.listMessages(chat.id)).toEqual(before);
    expect(await storage.listBranchSelections(chat.id)).toHaveLength(1);

    await service.selectBranch("anna", chat.id, "u1-v2");
    expect(await branchTexts(service, chat.id)).toEqual(["здравствуй", "ответ 3"]);
  });

  it("выбор запоминается: после него новое сообщение продолжает выбранную ветку", async () => {
    const { service, chat } = await chatWithTwoTurns();
    await readAll(await service.editMessage("anna", chat.id, "u1", user("u1-v2", "здравствуй")));
    await service.selectBranch("anna", chat.id, "u1");
    await ask(service, chat.id, "u3", "и ещё");
    expect(await branchTexts(service, chat.id)).toEqual(["привет", "ответ 1", "как дела", "ответ 2", "и ещё", "ответ 4"]);
  });

  it("выбор уже текущего сообщения ничего не пишет", async () => {
    const { service, storage, chat } = await chatWithTwoTurns();
    await service.selectBranch("anna", chat.id, "u1");
    expect(await storage.listBranchSelections(chat.id)).toEqual([]);
  });

  it("нет такого сообщения, чужой чат, идущий ответ — отказ", async () => {
    const { service, chat } = await chatWithTwoTurns();
    await expect(service.selectBranch("anna", chat.id, "нет-такого")).rejects.toBeInstanceOf(InvalidMessageError);
    await expect(service.selectBranch("boris", chat.id, "u1")).rejects.toBeInstanceOf(ChatNotFoundError);

    const controlled = controlledModel();
    const other = setup(controlled.model);
    const busyChat = await other.service.createChat("anna");
    const stream = await other.service.sendMessage("anna", busyChat.id, user("u1", "привет"));
    await controlled.opened;
    await expect(other.service.selectBranch("anna", busyChat.id, "u1")).rejects.toBeInstanceOf(ChatBusyError);
    controlled.push(streamStart, ...textParts(["ок"]));
    controlled.end();
    await readAll(stream);
  });

  it("getBranchForks отдаёт те же развилки, что и история, без сообщений", async () => {
    const { service, chat } = await chatWithTwoTurns();
    await readAll(await service.editMessage("anna", chat.id, "u1", user("u1-v2", "здравствуй")));
    const light = await service.getBranchForks("anna", chat.id);
    const full = await service.getHistory("anna", chat.id);
    expect(light).toEqual({ forks: full.forks });
    await expect(service.getBranchForks("boris", chat.id)).rejects.toBeInstanceOf(ChatNotFoundError);
  });

  it("повтор после ошибки возвращает ответ-соседа и тоже становится текущим после переключений", async () => {
    const { service, chat } = await chatWithTwoTurns();
    await readAll(await service.editMessage("anna", chat.id, "u1", user("u1-v2", "здравствуй")));
    await service.selectBranch("anna", chat.id, "u1");
    await service.selectBranch("anna", chat.id, "u1-v2");
    const { messages } = await service.getHistory("anna", chat.id);
    await readAll(await service.regenerate("anna", chat.id, messages[1]!.id));
    expect(await branchTexts(service, chat.id)).toEqual(["здравствуй", "ответ 4"]);
  });
});

describe("служба чата: сжатие следует за веткой", () => {
  const compaction = { thresholdTokens: 500, tailTokens: 100, summaryCeilingTokens: 100 };

  /** Ветка А: u1 a1 u2 a2 u3 a3 u4 a4; запись сжатия покрывает всё до a2 включительно. */
  async function compactedChat() {
    const model = numberedModel([100, 300, 600, 300]);
    const { service, storage } = setup(model, { compaction });
    const chat = await service.createChat("anna");
    for (const [index, text] of ["раз", "два", "три"].entries()) await ask(service, chat.id, `u${index + 1}`, text);
    await vi.waitFor(async () => expect(await storage.listCompactions(chat.id)).toHaveLength(1));
    await vi.waitFor(async () => expect((await service.getCompactions("anna", chat.id)).compacting).toBe(false));
    await ask(service, chat.id, "u4", "четыре");
    return { model, service, storage, chat };
  }

  const lastPrompt = (model: MockLanguageModelV4) => JSON.stringify(model.doStreamCalls.at(-1)!.prompt);

  it("запись на общей части действует на обеих ветках: правка после неё идёт со сводкой", async () => {
    const { model, service, chat } = await compactedChat();
    await readAll(await service.editMessage("anna", chat.id, "u3", user("u3-v2", "три иначе")));
    expect(lastPrompt(model)).toContain("<conversation_summary>");
    expect(lastPrompt(model)).toContain("три иначе");
    expect(lastPrompt(model)).not.toContain("раз");
    expect(lastPrompt(model)).not.toContain("четыре");
    expect((await service.getHistory("anna", chat.id)).compactions).toHaveLength(1);
  });

  it("запись, чей диапазон кончается на другой ветке, молчит: правка внутри диапазона идёт с полной историей", async () => {
    const { model, service, chat } = await compactedChat();
    await readAll(await service.editMessage("anna", chat.id, "u2", user("u2-v2", "два иначе")));
    expect(lastPrompt(model)).not.toContain("<conversation_summary>");
    expect(lastPrompt(model)).toContain("раз");
    expect(lastPrompt(model)).toContain("два иначе");
    expect((await service.getHistory("anna", chat.id)).compactions).toEqual([]);

    // вернулись на прежнюю ветку — сводка снова работает
    await service.selectBranch("anna", chat.id, "u2");
    expect((await service.getHistory("anna", chat.id)).compactions).toHaveLength(1);
    await ask(service, chat.id, "u5", "пять");
    expect(lastPrompt(model)).toContain("<conversation_summary>");
    expect(lastPrompt(model)).toContain("четыре");
    expect(lastPrompt(model)).not.toContain("два иначе");
  });

  it("переключение туда и обратно даёт тот же запрос, а инструкция и инструменты в нём неизменны", async () => {
    const { model, service, chat } = await compactedChat();
    const { messages } = await service.getHistory("anna", chat.id);
    const lastAnswer = messages.at(-1)!;
    await readAll(await service.regenerate("anna", chat.id, lastAnswer.id));
    const first = model.doStreamCalls.at(-1)!;

    await readAll(await service.editMessage("anna", chat.id, "u2", user("u2-v2", "два иначе")));
    await service.selectBranch("anna", chat.id, "u2");
    await service.selectBranch("anna", chat.id, lastAnswer.id);
    await readAll(await service.regenerate("anna", chat.id, lastAnswer.id));
    const second = model.doStreamCalls.at(-1)!;

    expect(second.prompt).toEqual(first.prompt);
    expect(second.tools).toEqual(first.tools);
    const otherBranch = model.doStreamCalls.at(-2)!;
    expect(otherBranch.prompt[0]).toEqual(first.prompt[0]);
  });

  it("лёгкий getCompactions следует за веткой так же, как история", async () => {
    const { service, chat } = await compactedChat();
    expect((await service.getCompactions("anna", chat.id)).compactions).toHaveLength(1);
    await readAll(await service.editMessage("anna", chat.id, "u2", user("u2-v2", "два иначе")));
    expect((await service.getCompactions("anna", chat.id)).compactions).toEqual([]);
    await service.selectBranch("anna", chat.id, "u2");
    expect((await service.getCompactions("anna", chat.id)).compactions).toHaveLength(1);
  });
});
