import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentToolsModel } from "../../../src/agent-run/run-agent-turn";
import { finishPart, reasoningAndTextParts, streamOf, streamStart } from "../support/mock-model";
import { runTurn, startTurn, storageWithQuestion } from "../support/turn-fixtures";

const callTool = (name: string): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: "c1", toolName: name, input: "{}" },
  finishPart("tool-calls"),
];

function steppedModel(steps: LanguageModelV4StreamPart[][]): MockLanguageModelV4 {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const next = steps[step++];
      if (!next) throw new Error(`шаг ${step} не заготовлен`);
      return { stream: streamOf(next) };
    },
  });
}

const writing = (notify: (model: AgentToolsModel) => void, after?: Promise<void>) => (model: AgentToolsModel): ToolSet => ({
  write: tool({
    description: "Запись",
    inputSchema: z.object({}),
    execute: async () => {
      notify(model);
      if (after) await after;
      return "записано";
    },
  }),
});

describe("runAgentTurn: notifyDataChanged", () => {
  it("инструмент сообщил об изменении: в потоке временный кусок, в хранилище его нет", async () => {
    const model = steppedModel([callTool("write"), reasoningAndTextParts(["готово"])]);
    const { chunks, answer, storage } = await runTurn(model, {
      ownerId: "anna",
      tools: writing((m) => m.notifyDataChanged({ tag: "tasks", details: { taskId: 7 } })),
    });
    const changes = chunks.filter((chunk) => chunk.type === "data-app-change");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ transient: true, data: { tag: "tasks", details: { taskId: 7 } } });
    expect(JSON.stringify(answer.parts)).not.toContain("data-app-change");
    expect(JSON.stringify(await storage.listMessages("chat-1"))).not.toContain("data-app-change");
  });

  it("сообщение уходит сразу при вызове, не дожидаясь конца инструмента", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const model = steppedModel([callTool("write"), reasoningAndTextParts(["готово"])]);
    const storage = await storageWithQuestion();
    const reader = startTurn(storage, model, {
      ownerId: "anna",
      tools: writing((m) => m.notifyDataChanged({ tag: "tasks" }), gate),
    }).getReader();
    const seen: string[] = [];
    for (;;) {
      const read = await reader.read();
      if (read.done) throw new Error("поток кончился раньше сообщения");
      seen.push(read.value.type);
      if (read.value.type === "data-app-change") break;
    }
    // Инструмент всё ещё ждёт: результата вызова в потоке нет.
    expect(seen).not.toContain("tool-output-available");
    release();
    for (let read = await reader.read(); !read.done; read = await reader.read()) seen.push(read.value.type);
    expect(seen).toContain("tool-output-available");
  });

  it("неверная форма — TypeError внутри инструмента: вызов закрыт ошибкой, ход идёт дальше", async () => {
    const thrown: unknown[] = [];
    const model = steppedModel([callTool("write"), reasoningAndTextParts(["готово"])]);
    const { chunks } = await runTurn(model, {
      ownerId: "anna",
      tools: writing((m) => {
        try {
          m.notifyDataChanged({ tag: "" });
        } catch (error) {
          thrown.push(error);
          throw error;
        }
      }),
    });
    expect(thrown[0]).toBeInstanceOf(TypeError);
    expect(chunks.some((chunk) => chunk.type === "data-app-change")).toBe(false);
    expect(chunks.some((chunk) => chunk.type === "tool-output-error")).toBe(true);
  });

  it("после конца хода вызов ничего не шлёт и не бросает, в журнале запись", async () => {
    const logError = vi.fn();
    let kept!: AgentToolsModel;
    const model = steppedModel([callTool("write"), reasoningAndTextParts(["готово"])]);
    const { chunks } = await runTurn(model, {
      ownerId: "anna",
      logError,
      tools: writing((m) => (kept = m)),
    });
    const before = chunks.length;
    expect(() => kept.notifyDataChanged({ tag: "tasks" })).not.toThrow();
    expect(chunks).toHaveLength(before);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("одна и та же функция на всех шагах хода; два вызова — два разных id", async () => {
    const seen = new Set<unknown>();
    const model = steppedModel([callTool("write"), callTool("write"), reasoningAndTextParts(["итог"])]);
    const tools = vi.fn(writing((m) => {
      seen.add(m.notifyDataChanged);
      m.notifyDataChanged({ tag: "tasks" });
    }));
    const { chunks } = await runTurn(model, { ownerId: "anna", tools });
    expect(tools).toHaveBeenCalledTimes(1);
    expect(seen.size).toBe(1);
    const ids = chunks.filter((chunk) => chunk.type === "data-app-change").map((chunk) => (chunk as { id: string }).id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
