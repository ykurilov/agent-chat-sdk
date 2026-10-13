import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentToolsModel } from "../../src/agent-run/run-agent-turn";
import { ChatNotFoundError, createChatService } from "../../src/chat-service";
import type { ChatService } from "../../src/chat-service";
import { newStoredMessage } from "../../src/conversation/types";
import type { AgentChatMessage, AnswerStatus, StoredMessage } from "../../src/conversation/types";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { finishPart, generateResult, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

const call = (toolName: string, input: object, toolCallId = `c-${crypto.randomUUID()}`): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
  finishPart("tool-calls"),
];
const text = (words: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts([words]), finishPart()];

/** Модель: на каждый запрос — следующий сценарий; после списка — короткий текст. */
function scriptedModel(scripts: LanguageModelV4StreamPart[][]) {
  let next = 0;
  return mockModel(() => streamOf(scripts[next++] ?? text("Готово")));
}

/** `write` ставит поле, `read` отдаёт всё состояние, `confirm` ждёт подтверждения. */
const setupTools = () => (model: AgentToolsModel) => ({
    write: tool({
      description: "Записать поле",
      inputSchema: z.object({ field: z.string(), value: z.string() }),
      execute: async ({ field, value }) => {
        model.state!.set(`fields.${field}`, value);
        return "записано";
      },
    }),
    read: tool({ description: "Прочитать состояние", inputSchema: z.object({}), execute: async () => model.state!.get() }),
    confirm: tool({ description: "Подтвердить", inputSchema: z.object({}), needsApproval: true, execute: async () => "подтверждено" }),
  });

function setup(scripts: LanguageModelV4StreamPart[][]) {
  const storage = createInMemoryChatStorage();
  const tools = setupTools();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: scriptedModel(scripts) }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", tools },
    env: mockEnv,
  });
  return { service, storage };
}

const userMessage = (id: string, words: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text: words }] });

async function answers(service: ChatService, chatId: string): Promise<AgentChatMessage[]> {
  return (await service.getHistory("anna", chatId)).messages.filter((message) => message.role === "assistant");
}

const readOutput = (message: AgentChatMessage) =>
  (message.parts.find((part) => part.type === "tool-read") as { output?: unknown } | undefined)?.output;

describe("service.getChatState: состояние текущей ветки", () => {
  it("после хода — записи ответа и id последнего сообщения; следующий ход видит их в model.state", async () => {
    const { service } = setup([call("write", { field: "email", value: "a@x.ru" }), text("Записал"), call("read", {}), text("Вот")]);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "почта a@x.ru")));
    const [first] = await answers(service, chat.id);
    expect(await service.getChatState("anna", chat.id)).toEqual({ values: { fields: { email: "a@x.ru" } }, atMessageId: first!.id });

    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "что записано?")));
    expect(readOutput((await answers(service, chat.id))[1]!)).toEqual({ fields: { email: "a@x.ru" } });
  });

  it("правка первого сообщения — записей старой ветки нет; выбор старой ветки их возвращает", async () => {
    const { service } = setup([call("write", { field: "email", value: "a@x.ru" }), text("Записал"), text("Понял")]);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "почта a@x.ru")));
    await readAll(await service.editMessage("anna", chat.id, "u1", userMessage("u1-edit", "почты нет")));
    expect((await service.getChatState("anna", chat.id)).values).toEqual({});

    await service.selectBranch("anna", chat.id, "u1");
    expect((await service.getChatState("anna", chat.id)).values).toEqual({ fields: { email: "a@x.ru" } });
  });

  it("«Переделать» — новый ответ без записей прежнего", async () => {
    const { service } = setup([call("write", { field: "email", value: "a@x.ru" }), text("Записал"), text("Без записи")]);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "почта a@x.ru")));
    const [first] = await answers(service, chat.id);
    await readAll(await service.regenerate("anna", chat.id, first!.id));
    const state = await service.getChatState("anna", chat.id);
    expect(state.values).toEqual({});
    expect(state.atMessageId).not.toBe(first!.id);
  });

  it("правка ответа (editAnswer) переносит записи в копию как есть", async () => {
    const { service } = setup([call("write", { field: "email", value: "a@x.ru" }), text("Записал")]);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "почта a@x.ru")));
    const [first] = await answers(service, chat.id);
    const edited = await service.editAnswer("anna", chat.id, first!.id, { text: "Записал почту." });
    expect(await service.getChatState("anna", chat.id)).toEqual({ values: { fields: { email: "a@x.ru" } }, atMessageId: edited.id });
  });

  it("продолжение после подтверждения видит записи того же ответа до паузы", async () => {
    const { service } = setup([
      [
        streamStart,
        { type: "tool-call", toolCallId: "w1", toolName: "write", input: JSON.stringify({ field: "email", value: "a@x.ru" }) },
        { type: "tool-call", toolCallId: "k1", toolName: "confirm", input: "{}" },
        finishPart("tool-calls"),
      ],
      call("read", {}),
      text("Готово"),
    ]);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "запиши и подтверди")));
    const [paused] = await answers(service, chat.id);
    expect(paused!.metadata?.status).toBe("awaiting_approval");
    const approval = (paused!.parts.find((part) => part.type === "tool-confirm") as { approval: { id: string } }).approval.id;
    await service.answerApproval("anna", chat.id, approval, "allow");
    await readAll((await service.subscribe("anna", chat.id))!);
    expect(readOutput((await answers(service, chat.id))[0]!)).toEqual({ fields: { email: "a@x.ru" } });
  });

  it("служебные ключи SDK не видны; пустой чат — пустое состояние; чужой чат — ChatNotFoundError", async () => {
    const { service, storage } = setup([]);
    const chat = await service.createChat("anna");
    expect(await service.getChatState("anna", chat.id)).toEqual({ values: {}, atMessageId: null });
    await storage.insertMessage(
      newStoredMessage({
        id: "n1",
        chatId: chat.id,
        role: "user",
        parts: [{ type: "data-app-state", data: { set: { $closed: { code: "done", message: "Закрыт" }, "fields.name": "Анна" } } }] as AgentChatMessage["parts"],
      }),
    );
    expect(await service.getChatState("anna", chat.id)).toEqual({ values: { fields: { name: "Анна" } }, atMessageId: "n1" });
    await expect(service.getChatState("boris", chat.id)).rejects.toBeInstanceOf(ChatNotFoundError);
  });
});

describe("«Повторить» оборванного ответа сохраняет его записи состояния", () => {
  type Part = StoredMessage["parts"][number];
  const step = { type: "step-start" } as Part;
  const written = (id: string, field: string) =>
    ({ type: "tool-write", toolCallId: id, state: "output-available", input: { field, value: field }, output: "записано" }) as Part;
  const state = (field: string) => ({ type: "data-app-state", data: { set: { [`fields.${field}`]: field } } }) as Part;

  async function brokenAnswer(storage: ChatStorage, status: AnswerStatus, parts: Part[]) {
    await storage.createChat({ id: "c1", ownerId: "anna", modelId: "mock-model", providerId: "mock" });
    await storage.insertMessage(
      newStoredMessage({ id: "u1", chatId: "c1", role: "user", parts: [{ type: "text", text: "Запиши" }], createdAt: "2026-01-01T00:00:00.000Z" }),
    );
    await storage.insertMessage(
      newStoredMessage({
        id: "a1",
        chatId: "c1",
        parentId: "u1",
        role: "assistant",
        status,
        parts,
        modelId: "mock-model",
        providerId: "mock",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );
  }

  it.each<AnswerStatus>(["stopped", "error"])("ответ %s: запись после вызова → «Повторить» → состояние на месте", async (status) => {
    const { service, storage } = setup([call("read", {}, "r1"), text("Готово")]);
    await brokenAnswer(storage, status, [step, written("w1", "email"), state("email"), step, { type: "text", text: "Запис", state: "streaming" } as Part]);
    await readAll(await service.retry("anna", "c1"));
    const [answer] = (await answers(service, "c1")).slice(-1);
    expect(answer!.id).not.toBe("a1");
    expect(await service.getChatState("anna", "c1")).toEqual({ values: { fields: { email: "email" } }, atMessageId: answer!.id });
    expect(readOutput(answer!)).toEqual({ fields: { email: "email" } });
  });

  it("параллельные вызовы [A, B, запись A, запись B] → «Повторить» → обе записи на месте", async () => {
    const { service, storage } = setup([text("Готово")]);
    await brokenAnswer(storage, "stopped", [step, written("w1", "email"), written("w2", "phone"), state("email"), state("phone")]);
    await readAll(await service.retry("anna", "c1"));
    expect((await service.getChatState("anna", "c1")).values).toEqual({ fields: { email: "email", phone: "phone" } });
  });
});

describe("состояние и сжатие истории", () => {
  /** Шаг модели с размером контекста `context` в расходе: по нему служба решает, сжимать ли историю. */
  const sized = (parts: LanguageModelV4StreamPart[], context: number): LanguageModelV4StreamPart[] => [
    ...parts.slice(0, -1),
    {
      ...(parts.at(-1) as Extract<LanguageModelV4StreamPart, { type: "finish" }>),
      usage: {
        inputTokens: { total: context - 10, noCache: context - 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
    },
  ];

  it("записи из сжатой части истории остаются в состоянии: их видят getChatState и следующий ход", async () => {
    const scripts = [
      sized(call("write", { field: "email", value: "a@x.ru" }), 50),
      sized(text("первый ответ"), 100),
      sized(text("второй ответ"), 300),
      sized(text("третий ответ"), 600),
      sized(call("read", {}, "r1"), 300),
      sized(text("Вот"), 300),
    ];
    let next = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => ({ stream: streamOf(scripts[next++] ?? text("Готово")) }),
      doGenerate: async () => generateResult("## Цель\nсводка", { output: 20 }),
    });
    const storage = createInMemoryChatStorage();
    const service = createChatService({
      storage,
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты помощник.", tools: setupTools() },
      compaction: { thresholdTokens: 500, tailTokens: 100, summaryCeilingTokens: 100 },
      env: mockEnv,
      logError: () => {},
    });
    const chat = await service.createChat("anna");
    for (const [index, words] of ["почта a@x.ru", "второй вопрос", "третий вопрос"].entries()) {
      await readAll(await service.sendMessage("anna", chat.id, userMessage(`u${index + 1}`, words)));
    }
    await vi.waitFor(async () => expect((await service.getCompactions("anna", chat.id)).compactions).toHaveLength(1));
    await vi.waitFor(async () => expect((await service.getCompactions("anna", chat.id)).compacting).toBe(false));

    expect((await service.getChatState("anna", chat.id)).values).toEqual({ fields: { email: "a@x.ru" } });
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u4", "что записано?")));
    const prompt = JSON.stringify(model.doStreamCalls[4]!.prompt);
    expect(prompt).toContain("<conversation_summary>");
    expect(prompt).not.toContain("почта a@x.ru");
    expect(readOutput((await answers(service, chat.id)).at(-1)!)).toEqual({ fields: { email: "a@x.ru" } });
  });
});
