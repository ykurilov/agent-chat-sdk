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

/** Первый шаг зовёт `send_form` (пишет поле и закрывает чат), второй отвечает текстом. */
function setup(options: Partial<ChatHandlerOptions> = {}) {
  let call = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const parts: LanguageModelV4StreamPart[] =
        call++ === 0
          ? [{ type: "stream-start", warnings: [] }, { type: "tool-call", toolCallId: "c1", toolName: "send_form", input: "{}" }, finish("tool-calls")]
          : [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t" },
              { type: "text-delta", id: "t", delta: "Отправил" },
              { type: "text-end", id: "t" },
              finish("stop"),
            ];
      return { stream: new ReadableStream({ start: (controller) => (parts.forEach((part) => controller.enqueue(part)), controller.close()) }) };
    },
  });
  const tools = (toolsModel: AgentToolsModel) => ({
    send_form: tool({
      description: "Отправить заявку",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
      execute: async () => {
        toolsModel.state!.set("form.sent", true);
        toolsModel.closeChat!({ code: "form_sent", message: "Заявка отправлена" });
        return "отправлено";
      },
    }),
  });
  return createTestChat({ catalog: catalogWithModel(model), ...options, agent: { instructions: "x", tools } });
}

describe("обработчик чата: состояние чата", () => {
  it("onStateChanged доходит до службы: хук получает состояние без служебных ключей", async () => {
    const calls: StateChangedInput[] = [];
    const chat = setup({ onStateChanged: (input) => void calls.push(input), onStateChangedAttempts: 1 });
    const chatId = await chat.createChat();
    await (await chat.call("POST", `/${chatId}/messages`, { body: message("u1", "Отправь") })).text();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ ownerId: "anna", chatId, reason: "turn", state: { form: { sent: true } }, previousState: {} });
  });

  it("служебные ключи не уходят в браузер: ни в потоке хода, ни в истории; закрытие видно полем chat.closed", async () => {
    const chat = setup();
    const chatId = await chat.createChat();
    const streamed = await (await chat.call("POST", `/${chatId}/messages`, { body: message("u1", "Отправь") })).text();
    expect(streamed).not.toContain("$closed");
    expect(parseSse(streamed).filter((chunk) => chunk.type === "data-app-state")).toEqual([{ type: "data-app-state", data: { set: { "form.sent": true } } }]);
    const history = await (await chat.call("GET", `/${chatId}`)).text();
    expect(history).not.toContain("$closed");
    expect(JSON.parse(history).chat.closed).toEqual({ code: "form_sent", message: "Заявка отправлена" });
    expect(JSON.stringify(await chat.storage.listMessages(chatId))).toContain("$closed");
  });

  it("watch пересылает вкладке state-changed", async () => {
    const chat = setup();
    const chatId = await chat.createChat();
    const reader = (await chat.call("GET", `/${chatId}/watch`)).body!.getReader();
    await readUntil(reader, ": ping");
    await (await chat.call("POST", `/${chatId}/messages`, { body: message("u1", "Отправь") })).text();
    const seen = await readUntil(reader, '"state-changed"');
    await reader.cancel();
    expect(parseSse(seen).find((event) => event.type === "state-changed")).toMatchObject({ chatId, reason: "turn", state: { form: { sent: true } } });
  });
});
