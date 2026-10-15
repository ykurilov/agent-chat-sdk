import { APICallError } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resolveViewerOutsideTurn, VIEWER_OUTSIDE_TURN_TIMEOUT_MS } from "../../../src/agent-run/agent-viewer";
import type { AgentViewerInput } from "../../../src/agent-run/agent-viewer";
import type { AgentToolsModel } from "../../../src/agent-run/run-agent-turn";
import type { ContextBlocksInput } from "../../../src/frozen-context/context-blocks";
import { finishPart, mockCatalog, streamOf, streamStart, textParts } from "../support/mock-model";
import { runTurn } from "../support/turn-fixtures";

const failing = () =>
  new MockLanguageModelV4({
    doStream: async () => {
      throw new APICallError({
        message: "ответ 503",
        url: "https://provider.test/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 503,
        responseBody: "busy",
        responseHeaders: { "retry-after-ms": "1" },
      });
    },
  });
const answering = () => new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf([streamStart, ...textParts(["Ответ"]), finishPart()]) }) });
const lookup = tool({ description: "Найти заказ", inputSchema: z.object({ id: z.string() }), execute: async () => "заказ" });

describe("agent.viewer: права человека на ход", () => {
  it("зовётся один раз на ход: запасной провайдер не зовёт снова; инструменты и блоки получают тот же объект", async () => {
    const viewer = vi.fn(async (_input: AgentViewerInput) => ({ isAdmin: true, plan: "pro" }));
    const tools = vi.fn((_model: AgentToolsModel): ToolSet => ({}));
    const blocks: ContextBlocksInput[] = [];
    const primary = failing();
    const { answer } = await runTurn(primary, {
      catalog: mockCatalog({ mock: primary, "mock-backup": answering() }),
      providerFallback: {},
      ownerId: "anna",
      viewer,
      tools,
      contextBlocks: (input) => {
        blocks.push(input);
        return null;
      },
    });
    expect(answer.status).toBe("complete");
    expect(viewer).toHaveBeenCalledTimes(1);
    expect(viewer.mock.calls[0]![0]).toMatchObject({ userId: "anna", ownerId: "anna", chatId: "chat-1", messageId: answer.id, channel: "web", audience: "private" });
    expect(tools.mock.calls.map(([model]) => model.providerId)).toEqual(["mock", "mock-backup"]);
    const [first, second] = tools.mock.calls.map(([model]) => model.viewer);
    expect(first).toEqual({ isAdmin: true, plan: "pro" });
    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.viewer).toBe(first);
  });

  it("сотрудник в копии чата: userId — сотрудник, ownerId — владелец", async () => {
    const viewer = vi.fn(async (_input: AgentViewerInput) => ({}));
    await runTurn(answering(), { ownerId: "anna", staff: { id: "boss" }, viewer });
    expect(viewer.mock.calls[0]![0]).toMatchObject({ userId: "boss", ownerId: "anna", staff: { id: "boss" } });
  });

  it("запрос к модели байт в байт тот же, что без viewer (кэш)", async () => {
    const request = async (withViewer: boolean) => {
      const model = answering();
      await runTurn(model, {
        ownerId: "anna",
        tools: (toolsModel): ToolSet => (toolsModel.viewer?.isAdmin === true || !withViewer ? { lookup } : {}),
        ...(withViewer && { viewer: async () => ({ isAdmin: true, secret: "ЗНАЧЕНИЕ-ПРАВ" }) }),
      });
      return JSON.stringify({ prompt: model.doStreamCalls[0]!.prompt, tools: model.doStreamCalls[0]!.tools });
    };
    const plain = await request(false);
    const viewed = await request(true);
    expect(viewed).toBe(plain);
    expect(viewed).not.toContain("ЗНАЧЕНИЕ-ПРАВ");
  });

  it("viewer бросила — ход кончается ошибкой, модель и инструменты не зовутся, причина в журнале", async () => {
    const model = answering();
    const tools = vi.fn((_model: AgentToolsModel): ToolSet => ({}));
    const logged: string[] = [];
    const { answer, chunks } = await runTurn(model, {
      ownerId: "anna",
      tools,
      viewer: async () => {
        throw new Error("база прав недоступна");
      },
      logError: (line) => logged.push(line),
    });
    expect(answer.status).toBe("error");
    expect(chunks).toContainEqual({ type: "error", errorText: "other" });
    expect(model.doStreamCalls).toHaveLength(0);
    expect(tools).not.toHaveBeenCalled();
    expect(logged.some((line) => line.includes("[agent.viewer]") && line.includes("база прав недоступна"))).toBe(true);
  });

  it("viewer вернула не объект — тоже ошибка хода", async () => {
    const logged: string[] = [];
    const { answer } = await runTurn(answering(), { ownerId: "anna", viewer: async () => true as never, logError: (line) => logged.push(line) });
    expect(answer.status).toBe("error");
    expect(logged.some((line) => line.includes("вернула не объект"))).toBe(true);
  });
});

describe("agent.viewer вне хода (сжатие, фоновый помощник)", () => {
  it("не ответила за 10 с — ошибка с понятной причиной, а не вечное ожидание", async () => {
    vi.useFakeTimers();
    try {
      const pending = resolveViewerOutsideTurn(() => new Promise(() => {}), { chatId: "c1", ownerId: "anna", messageId: "", audience: "private" });
      const outcome = pending.then(
        () => "ответила",
        (error: Error) => error,
      );
      await vi.advanceTimersByTimeAsync(VIEWER_OUTSIDE_TURN_TIMEOUT_MS - 1);
      let settled = false;
      void outcome.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toMatchObject({ name: "AgentViewerError", message: expect.stringMatching(/10 с/) });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ответила вовремя — права замороженным объектом; срок снят", async () => {
    vi.useFakeTimers();
    try {
      const viewer = await resolveViewerOutsideTurn(async (input) => ({ isAdmin: input.audience !== "group" }), { chatId: "c1", ownerId: "anna", messageId: "", audience: "group" });
      expect(viewer).toEqual({ isAdmin: false });
      expect(Object.isFrozen(viewer)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

