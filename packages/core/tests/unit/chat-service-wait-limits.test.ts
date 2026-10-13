import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { ToolSet, UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { toolTimeoutMessage } from "../../src/agent-run/tool-timeout";
import { createChatService, TooManyTurnsError } from "../../src/chat-service";
import type { AgentSettings, ChatServiceOptions } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { finishPart, mockCatalog, mockEnv, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

const user = (id: string, text = "Привет") => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });
const callTool = (name: string, id: string): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: id, toolName: name, input: "{}" },
  finishPart("tool-calls"),
];
const saying = (text: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts([text]), finishPart()];

type Script = LanguageModelV4StreamPart[] | "silent";
function scriptedModel(scripts: Script[]) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      const script = scripts[call++] ?? saying(`ответ ${call}`);
      if (script !== "silent") return { stream: streamOf(script) };
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue(streamStart);
            abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
          },
        }),
      };
    },
  });
}

const hangingTools: ToolSet = {
  slow_report: tool({ description: "Долгий отчёт", inputSchema: z.object({}), execute: () => new Promise<string>(() => {}) }),
};

function build(model: MockLanguageModelV4, agent: Partial<AgentSettings> = {}, extra: Partial<ChatServiceOptions> = {}) {
  const logged: string[] = [];
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", ...agent },
    compaction: false,
    env: mockEnv,
    logError: (line) => logged.push(line),
    ...extra,
  });
  return { service, logged };
}

const finalStatus = (chunks: UIMessageChunk[]) =>
  chunks.flatMap((chunk) => (chunk.type === "message-metadata" ? [(chunk.messageMetadata as { status?: string }).status] : [])).filter(Boolean).at(-1);

describe("служба чата: пределы ожидания — настройки", () => {
  const create = (agent: Partial<AgentSettings>) => () => build(scriptedModel([]), agent);

  it("agent.toolTimeoutMs: меньше 1 с, больше 2³¹−1 мс, не число — ошибка при создании; 0 и Infinity — можно", () => {
    expect(create({ toolTimeoutMs: 999 })).toThrow(/agent\.toolTimeoutMs/);
    expect(create({ toolTimeoutMs: 2 ** 31 })).toThrow(/agent\.toolTimeoutMs/);
    expect(create({ toolTimeoutMs: Number.NaN })).toThrow(/agent\.toolTimeoutMs/);
    expect(create({ toolTimeoutMs: 0 })).not.toThrow();
    expect(create({ toolTimeoutMs: Number.POSITIVE_INFINITY })).not.toThrow();
    expect(create({ toolTimeoutMs: { default: 30_000, byTool: { ask_user: 0 } } })).not.toThrow();
    expect(create({ toolTimeoutMs: { byTool: { ask_user: 500 } } })).toThrow(/agent\.toolTimeoutMs\.byTool\["ask_user"\]/);
  });

  it("agent.modelSilenceTimeout: неверная форма или срок — ошибка при создании; false и объект — можно", () => {
    expect(create({ modelSilenceTimeout: { firstChunkMs: 500 } })).toThrow(/agent\.modelSilenceTimeout\.firstChunkMs/);
    expect(create({ modelSilenceTimeout: { betweenChunksMs: -1 } })).toThrow(/agent\.modelSilenceTimeout\.betweenChunksMs/);
    expect(create({ modelSilenceTimeout: 60_000 as unknown as false })).toThrow(/agent\.modelSilenceTimeout/);
    expect(create({ modelSilenceTimeout: false })).not.toThrow();
    expect(create({ modelSilenceTimeout: { firstChunkMs: 30_000 } })).not.toThrow();
  });
});

describe("служба чата: пределы ожидания в ходе", () => {
  afterEach(() => vi.useRealTimers());

  it("инструмент не ответил за свой срок — ход дописан, место хода свободно: следующий вопрос при пределе 1 идёт", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const model = scriptedModel([callTool("slow_report", "c1"), saying("Отчёт не успел."), saying("Второй ответ.")]);
    const { service, logged } = build(model, { tools: hangingTools, toolTimeoutMs: 5_000 }, { maxConcurrentTurnsPerUser: 1 });
    const chat = await service.createChat("anna");
    const reading = readAll(await service.sendMessage("anna", chat.id, user("u1", "сделай отчёт")));
    await vi.advanceTimersByTimeAsync(5_000);
    const chunks = await reading;

    expect(chunks.find((chunk) => chunk.type === "tool-output-error")).toMatchObject({ errorText: toolTimeoutMessage(5_000) });
    expect(finalStatus(chunks)).toBe("complete");
    expect(logged).toContain(`[инструмент не ответил] чат=${chat.id} инструмент=slow_report срок=5000мс`);
    const second = await readAll(await service.sendMessage("anna", chat.id, user("u2", "ещё")));
    expect(finalStatus(second)).toBe("complete");
  });

  it("модель молчит дольше предела — ход кончается ошибкой, место хода свободно: следующий вопрос при пределе 1 идёт", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const model = scriptedModel(["silent", "silent", saying("Теперь ответил.")]);
    const { service } = build(
      model,
      { modelSilenceTimeout: { firstChunkMs: 10_000 }, providerFallback: false },
      { maxConcurrentTurnsPerUser: 1 },
    );
    const chat = await service.createChat("anna");
    const other = await service.createChat("anna");
    const reading = readAll(await service.sendMessage("anna", chat.id, user("u1")));
    await expect(service.sendMessage("anna", other.id, user("u-busy"))).rejects.toBeInstanceOf(TooManyTurnsError);
    // Две попытки по 10 с и пауза повтора (1 с, разброс до 25%).
    await vi.advanceTimersByTimeAsync(2 * 10_000 + 1_250);
    const chunks = await reading;
    expect(finalStatus(chunks)).toBe("error");

    const next = service.sendMessage("anna", other.id, user("u2"));
    await expect(next).resolves.toBeInstanceOf(ReadableStream);
    expect(finalStatus(await readAll(await next))).toBe("complete");
  });

  it("место занято, пока ход ждёт инструмент: второй ход получает TooManyTurnsError до срока", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const model = scriptedModel([callTool("slow_report", "c1"), saying("Дальше.")]);
    const { service } = build(model, { tools: hangingTools, toolTimeoutMs: 5_000 }, { maxConcurrentTurnsPerUser: 1 });
    const chat = await service.createChat("anna");
    const other = await service.createChat("anna");
    const reading = readAll(await service.sendMessage("anna", chat.id, user("u1")));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(service.sendMessage("anna", other.id, user("u2"))).rejects.toBeInstanceOf(TooManyTurnsError);
    await vi.advanceTimersByTimeAsync(4_000);
    await reading;
  });

  it("инструмент с подтверждением: человек думает дольше срока — не отмена; срок идёт от «Разрешить»", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const signals: AbortSignal[] = [];
    const remove = tool({
      description: "Удалить",
      inputSchema: z.object({}),
      needsApproval: true,
      execute: (_input, { abortSignal }) => {
        if (abortSignal) signals.push(abortSignal);
        return new Promise<string>(() => {});
      },
    });
    const model = scriptedModel([callTool("remove", "c1"), saying("Удаление не ответило.")]);
    const { service, logged } = build(model, { tools: { remove }, toolTimeoutMs: 5_000 });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, user("u1", "удали")));
    // Человек думает 10 минут: инструмент ещё не вызывался, отменять нечего.
    await vi.advanceTimersByTimeAsync(600_000);
    expect(signals).toHaveLength(0);
    const { messages } = await service.getHistory("anna", chat.id);
    const approvalId = (messages.at(-1)!.parts.find((part) => part.type === "tool-remove") as { approval: { id: string } }).approval.id;

    await service.answerApproval("anna", chat.id, approvalId, "allow");
    const reading = readAll((await service.subscribe("anna", chat.id))!);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const chunks = await reading;

    expect(signals[0]!.aborted).toBe(true);
    expect(chunks.find((chunk) => chunk.type === "tool-output-error")).toMatchObject({ errorText: toolTimeoutMessage(5_000) });
    expect(finalStatus(chunks)).toBe("complete");
    expect(logged).toContain(`[инструмент не ответил] чат=${chat.id} инструмент=remove срок=5000мс`);
  });

  it("свой срок инструмента через службу: byTool без предела — «спроси человека» ждёт ответа дольше общего срока", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let answerHuman!: (text: string) => void;
    const askUser = tool({
      description: "Спросить человека",
      inputSchema: z.object({}),
      execute: () => new Promise<string>((resolve) => (answerHuman = resolve)),
    });
    const model = scriptedModel([callTool("ask_user", "c1"), saying("Понял.")]);
    const { service, logged } = build(model, { tools: { ask_user: askUser }, toolTimeoutMs: { default: 5_000, byTool: { ask_user: 0 } } });
    const chat = await service.createChat("anna");
    const reading = readAll(await service.sendMessage("anna", chat.id, user("u1")));
    await vi.advanceTimersByTimeAsync(300_000);
    answerHuman("Да");
    const chunks = await reading;
    expect(chunks.find((chunk) => chunk.type === "tool-output-available")).toMatchObject({ output: "Да" });
    expect(finalStatus(chunks)).toBe("complete");
    expect(logged.some((line) => line.startsWith("[инструмент не ответил]"))).toBe(false);
  });

  it("браузерные инструменты живут по своему сроку: при toolTimeoutMs 5 с вкладка ждётся 30 с", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const openTask = tool({ description: "Открыть задачу", inputSchema: z.object({}) });
    const model = scriptedModel([callTool("open_task", "c1"), saying("Страница молчит.")]);
    const { service, logged } = build(model, { browserTools: { open_task: openTask }, toolTimeoutMs: 5_000 });
    const chat = await service.createChat("anna");
    const reading = readAll(await service.sendMessage("anna", chat.id, user("u1"), { page: { tabId: "tab-1" } }));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(model.doStreamCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const chunks = await reading;
    expect(chunks.find((chunk) => chunk.type === "tool-output-error")).toMatchObject({ errorText: "Страница не ответила за 30 с" });
    expect(logged.some((line) => line.startsWith("[инструмент не ответил]"))).toBe(false);
  });
});
