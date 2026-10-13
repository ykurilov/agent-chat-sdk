import { readUIMessageStream } from "ai";
import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { chunksForParts } from "../../../src/agent-run/parts-to-chunks";
import type { AgentChatMessage } from "../../../src/conversation/types";

type Part = AgentChatMessage["parts"][number];
const part = (value: Record<string, unknown>): Part => value as never;

/** Сообщение, которое клиент соберёт из кусков: `start`, затем куски частей. */
async function assembled(parts: Part[]): Promise<Part[]> {
  const chunks: UIMessageChunk[] = [{ type: "start", messageId: "a2" }, ...chunksForParts(parts)];
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  let last: AgentChatMessage | undefined;
  for await (const message of readUIMessageStream<AgentChatMessage>({ stream, onError: (error) => { throw error; } })) last = message;
  return last?.parts ?? [];
}

describe("chunksForParts: куски, воспроизводящие скопированные части (FR-025)", () => {
  it("шаги, текст, рассуждения, вызовы с результатом и с ошибкой собираются в те же части", async () => {
    const parts = [
      part({ type: "step-start" }),
      part({ type: "reasoning", id: "reasoning-0", text: "думаю", state: "done", providerMetadata: { mock: { signature: "s" } } }),
      part({ type: "text", text: "Создаю задачи", state: "done", providerMetadata: { mock: { id: "t" } } }),
      part({
        type: "tool-create_task",
        toolCallId: "c1",
        state: "output-available",
        input: { title: "Первая" },
        output: { id: 1 },
        callProviderMetadata: { mock: { call: 1 } },
        resultProviderMetadata: { mock: { result: 1 } },
      }),
      part({ type: "step-start" }),
      part({ type: "tool-create_task", toolCallId: "c2", state: "output-error", input: { title: "Вторая" }, errorText: "не вышло" }),
      part({ type: "dynamic-tool", toolName: "mcp_find", toolCallId: "c3", state: "output-available", input: { q: "x" }, output: "найдено" }),
    ];
    expect(await assembled(parts)).toEqual(parts);
  });

  it("отказ и одобренный вызов с подтверждением собираются с тем же решением", async () => {
    const parts = [
      part({ type: "step-start" }),
      part({
        type: "tool-delete_task",
        toolCallId: "c1",
        state: "output-denied",
        input: { id: 1 },
        approval: { id: "ap-1", approved: false, reason: "Пользователь отклонил" },
      }),
      part({
        type: "tool-delete_task",
        toolCallId: "c2",
        state: "output-available",
        input: { id: 2 },
        output: "удалена",
        approval: { id: "ap-2", approved: true, reason: "always-in-chat" },
      }),
    ];
    expect(await assembled(parts)).toEqual(parts);
  });

  it("data-*, источники и файлы собираются в те же части", async () => {
    const parts = [
      part({ type: "step-start" }),
      part({ type: "data-voice-mode", id: "v1", data: true }),
      part({ type: "source-url", sourceId: "s1", url: "https://example.test", title: "Пример" }),
      part({ type: "file", mediaType: "image/png", url: "https://example.test/a.png" }),
    ];
    expect(await assembled(parts)).toEqual(parts);
  });

  it("каждый начатый шаг закрыт finish-step; пустой список — без кусков", () => {
    const chunks = chunksForParts([part({ type: "step-start" }), part({ type: "text", text: "т", state: "done" }), part({ type: "step-start" })]);
    expect(chunks.filter((chunk) => chunk.type === "start-step")).toHaveLength(2);
    expect(chunks.filter((chunk) => chunk.type === "finish-step")).toHaveLength(2);
    expect(chunks.at(-1)).toEqual({ type: "finish-step" });
    expect(chunksForParts([])).toEqual([]);
  });

  it("id текстов и рассуждений не повторяются: части не склеиваются", async () => {
    const parts = [
      part({ type: "step-start" }),
      part({ type: "text", text: "раз", state: "done" }),
      part({ type: "text", text: "два", state: "done" }),
    ];
    expect(await assembled(parts)).toEqual(parts);
  });
});
