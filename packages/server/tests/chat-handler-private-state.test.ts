import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { AgentToolsModel, StateChangedInput } from "@ykurilov/agent-chat-core";
import { jsonSchema, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import type { ChatHandlerOptions } from "../src/chat-handler";
import { catalogWithModel, usage } from "./support/mock-catalog";
import { parseSse, readUntil } from "./support/sse";
import { createTestChat, message } from "./support/test-chat";

const finish = (reason: "stop" | "tool-calls"): LanguageModelV4StreamPart => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage });

/** Первый шаг зовёт `book` (пишет открытое поле и служебный номер брони), второй отвечает текстом. */
function setup(options: Partial<ChatHandlerOptions> = {}) {
  let call = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const parts: LanguageModelV4StreamPart[] =
        call++ === 0
          ? [{ type: "stream-start", warnings: [] }, { type: "tool-call", toolCallId: "c1", toolName: "book", input: "{}" }, finish("tool-calls")]
          : [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t" },
              { type: "text-delta", id: "t", delta: "Забронировал" },
              { type: "text-end", id: "t" },
              finish("stop"),
            ];
      return { stream: new ReadableStream({ start: (controller) => (parts.forEach((part) => controller.enqueue(part)), controller.close()) }) };
    },
  });
  const tools = (toolsModel: AgentToolsModel) => ({
    book: tool({
      description: "Забронировать",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
      execute: async () => {
        toolsModel.state!.set("form.date", "12 октября");
        toolsModel.state!.set("booking.id", "bk-secret-42");
        return "забронировано";
      },
    }),
  });
  return createTestChat({ catalog: catalogWithModel(model), ...options, agent: { instructions: "x", tools } });
}

describe("обработчик чата: закрытые ключи состояния (privateStateKeys)", () => {
  it("закрытый ключ не уходит в браузер: ни в потоке, ни в истории, ни в watch; хук и хранилище его видят", async () => {
    const calls: StateChangedInput[] = [];
    const chat = setup({ privateStateKeys: ["booking"], onStateChanged: (input) => void calls.push(input), onStateChangedAttempts: 1 });
    const chatId = await chat.createChat();
    const reader = (await chat.call("GET", `/${chatId}/watch`)).body!.getReader();
    await readUntil(reader, ": ping");
    const streamed = await (await chat.call("POST", `/${chatId}/messages`, { body: message("u1", "Забронируй") })).text();
    expect(streamed).not.toContain("bk-secret-42");
    expect(parseSse(streamed).filter((chunk) => chunk.type === "data-app-state")).toEqual([{ type: "data-app-state", data: { set: { "form.date": "12 октября" } } }]);
    const seen = await readUntil(reader, '"state-changed"');
    await reader.cancel();
    expect(seen).not.toContain("bk-secret-42");
    expect(parseSse(seen).find((event) => event.type === "state-changed")).toMatchObject({ state: { form: { date: "12 октября" } } });
    const history = await (await chat.call("GET", `/${chatId}`)).text();
    expect(history).not.toContain("bk-secret-42");
    expect(history).toContain("12 октября");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.state).toEqual({ form: { date: "12 октября" }, booking: { id: "bk-secret-42" } });
    expect(JSON.stringify(await chat.storage.listMessages(chatId))).toContain("bk-secret-42");
  });

  it("без опции — ключ виден, как раньше", async () => {
    const chat = setup();
    const chatId = await chat.createChat();
    const streamed = await (await chat.call("POST", `/${chatId}/messages`, { body: message("u1", "Забронируй") })).text();
    expect(streamed).toContain("bk-secret-42");
  });

  it("неверное имя закрытого ключа — ошибка при создании", () => {
    for (const bad of ["", "$closed", "booking.id"]) expect(() => setup({ privateStateKeys: [bad] })).toThrow(TypeError);
  });
});
