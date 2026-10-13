import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createChatService } from "../../src/chat-service";
import type { AgentSettings } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

const busy = () =>
  new APICallError({
    message: "ответ 503",
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 503,
    responseBody: "занято",
    responseHeaders: { "retry-after-ms": "1" },
  });

const failing = () =>
  new MockLanguageModelV4({
    doStream: async () => {
      throw busy();
    },
  });

const answering = (text = "Ответ запасного") => mockModel(() => streamOf([streamStart, ...textParts([text]), finishPart()]));

function serviceWith(models: { mock: MockLanguageModelV4; backup: MockLanguageModelV4 }, agent: Partial<AgentSettings> = {}) {
  const storage = createInMemoryChatStorage();
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: models.mock, "mock-backup": models.backup }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", ...agent },
    env: mockEnv,
    logError: () => {},
  });
  return { storage, service };
}

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

async function ask(service: ReturnType<typeof serviceWith>["service"], text = "Привет") {
  const chat = await service.createChat("anna");
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", text)));
  return chat;
}

describe("createChatService: настройки надёжности", () => {
  it.each([999, 1500.5, { default: 10 }, { byTool: { list: 0 } }])("toolResultMaxLength %j — TypeError при создании (FR-016)", (setting) => {
    expect(() => serviceWith({ mock: answering(), backup: answering() }, { toolResultMaxLength: setting as never })).toThrow(TypeError);
  });

  it("providerFallback с провайдером, которого нет у модели, — ошибка с именами", () => {
    expect(() => serviceWith({ mock: answering(), backup: answering() }, { providerFallback: { byModel: { [mockModelId]: ["nope"] } } })).toThrow(
      new RegExp(`${mockModelId}.*nope`),
    );
  });

  it("providerFallback передаётся в ход: false — запасной не пробуется", async () => {
    const backup = answering();
    const { storage, service } = serviceWith({ mock: failing(), backup }, { providerFallback: false });
    const chat = await ask(service);
    const answer = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant")!;
    expect(answer.status).toBe("error");
    expect(backup.doStreamCalls).toHaveLength(0);
  });

  it("запасной ответил — ответ в истории с его провайдером, выбор чата не меняется (FR-031)", async () => {
    const { storage, service } = serviceWith({ mock: failing(), backup: answering() }, { providerFallback: {} });
    const chat = await ask(service);
    const answer = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant")!;
    expect(answer).toMatchObject({ status: "complete", providerId: "mock-backup" });
    expect((await service.getHistory("anna", chat.id)).chat.providerId).toBe("mock");
  });

  it("toolResultMaxLength передаётся в ход: поднятый предел своего инструмента не режет результат (US4 сц. 2)", async () => {
    const big = "ж".repeat(80_000);
    let step = 0;
    const model = mockModel(() => {
      step++;
      return streamOf(
        step === 1
          ? [streamStart, { type: "tool-call", toolCallId: "c1", toolName: "export_all", input: "{}" }, finishPart("tool-calls")]
          : [streamStart, ...textParts(["Готово"]), finishPart()],
      );
    });
    const { storage, service } = serviceWith(
      { mock: model, backup: answering() },
      {
        toolResultMaxLength: { byTool: { export_all: 100_000 } },
        tools: { export_all: tool({ description: "Всё", inputSchema: z.object({}), execute: async () => big }) },
      },
    );
    const chat = await ask(service);
    const answer = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant")!;
    const call = answer.parts.find((part) => part.type === "tool-export_all") as { output?: string };
    expect(call.output).toBe(big);
  });

  it("продолжение после подтверждения: выбранный отвечает 503, запасной — нормально; инструмент выполнен один раз, результат в запросе запасного", async () => {
    const execute = vi.fn(async ({ path }: { path: string }) => `удалено ${path}`);
    let primaryCalls = 0;
    const asksThenFails = mockModel(() => {
      primaryCalls++;
      if (primaryCalls === 1) {
        const call: LanguageModelV4StreamPart = { type: "tool-call", toolCallId: "c1", toolName: "remove", input: '{"path":"a"}' };
        return streamOf([streamStart, call, finishPart("tool-calls")]);
      }
      return new ReadableStream({
        start(controller) {
          controller.error(busy());
        },
      });
    });
    const backup = answering("Удалил");
    const { storage, service } = serviceWith(
      { mock: asksThenFails, backup },
      {
        providerFallback: {},
        tools: { remove: tool({ description: "Удалить", inputSchema: z.object({ path: z.string() }), needsApproval: true, execute }) },
      },
    );
    const chat = await ask(service, "удали a");
    const waiting = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant")!;
    const approvalId = (waiting.parts.find((part) => part.type === "tool-remove") as { approval: { id: string } }).approval.id;

    await service.answerApproval("anna", chat.id, approvalId, "allow");
    const chunks = await readAll((await service.subscribe("anna", chat.id))!);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(backup.doStreamCalls).toHaveLength(1);
    // Запасной видит результат одобренного вызова, а не повторный запрос на него.
    const toolResults = backup.doStreamCalls[0]!.prompt.flatMap((message) =>
      message.role === "tool" ? message.content.filter((part) => part.type === "tool-result") : [],
    );
    expect(toolResults).toEqual([expect.objectContaining({ toolCallId: "c1", output: expect.objectContaining({ value: "удалено a" }) })]);
    expect(chunks.filter((chunk) => chunk.type === "start")).toHaveLength(1);
    const answer = (await storage.listMessages(chat.id)).find((message) => message.id === waiting.id)!;
    expect(answer).toMatchObject({ status: "complete", providerId: "mock-backup" });
    expect(answer.parts.find((part) => part.type === "tool-remove")).toMatchObject({ state: "output-available", output: "удалено a" });
    expect(answer.parts.at(-1)).toMatchObject({ type: "text", text: "Удалил" });
    // Шаг упавшей попытки не оставил своего начала: двух step-start подряд нет.
    const types = answer.parts.map((part) => part.type);
    expect(types.some((type, index) => type === "step-start" && types[index + 1] === "step-start")).toBe(false);
  });
});
