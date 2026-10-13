import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { AgentChatMessage } from "@ykurilov/agent-chat-core";
import { jsonSchema, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import type { ChatHandlerOptions } from "../src/chat-handler";
import { catalogWithModel, usage } from "./support/mock-catalog";
import { parseSse } from "./support/sse";
import { createTestChat, message } from "./support/test-chat";

const finish = (reason: "stop" | "tool-calls"): LanguageModelV4StreamPart => ({
  type: "finish",
  finishReason: { unified: reason, raw: reason },
  usage,
});

/** Первый ход просит вызвать инструмент `remove`, следующие отвечают текстом. */
function setup(options: Partial<ChatHandlerOptions> = {}) {
  let call = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const parts: LanguageModelV4StreamPart[] =
        call++ === 0
          ? [
              { type: "stream-start", warnings: [] },
              { type: "tool-call", toolCallId: "c1", toolName: "remove", input: JSON.stringify({ path: "a" }) },
              finish("tool-calls"),
            ]
          : [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t" },
              { type: "text-delta", id: "t", delta: "Готово" },
              { type: "text-end", id: "t" },
              finish("stop"),
            ];
      return { stream: new ReadableStream({ start: (controller) => (parts.forEach((part) => controller.enqueue(part)), controller.close()) }) };
    },
  });
  const execute = vi.fn(async () => "удалено");
  const chat = createTestChat({
    catalog: catalogWithModel(model),
    ...options,
    agent: {
      instructions: "x",
      tools: { remove: tool({ description: "d", inputSchema: jsonSchema<{ path: string }>({ type: "object", properties: { path: { type: "string" } }, required: ["path"] }), needsApproval: true, execute }) },
    },
  });
  return { ...chat, execute };
}

async function waitingApprovalId(chat: ReturnType<typeof setup>) {
  const chatId = await chat.createChat();
  await (await chat.call("POST", `/${chatId}/messages`, { body: message("u1", "удали") })).text();
  const answer = (await chat.history(chatId)).messages.at(-1) as AgentChatMessage;
  const part = answer.parts.find((p) => p.type === "tool-remove") as { approval: { id: string } };
  return { chatId, approvalId: part.approval.id };
}

describe("обработчик чата: подтверждение действий", () => {
  it("разрешение продолжает ответ, поток читается обычным GET /stream", async () => {
    const chat = setup();
    const { chatId, approvalId } = await waitingApprovalId(chat);
    const response = await chat.call("POST", `/${chatId}/approvals/${approvalId}`, { body: { decision: "allow" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ resumed: true });
    const stream = await chat.call("GET", `/${chatId}/stream`);
    expect(stream.status).toBe(200);
    const chunks = parseSse(await stream.text());
    expect(chunks.some((chunk) => chunk.type === "tool-output-available")).toBe(true);
    expect(chat.execute).toHaveBeenCalledTimes(1);
    expect((await chat.history(chatId)).messages.at(-1)?.metadata?.status).toBe("complete");
  });

  it("приложение отказало ходу (beforeTurn): 403 turn_refused, карточка ждёт, инструмент не выполнен", async () => {
    const state = { closed: false };
    const chat = setup({ beforeTurn: () => (state.closed ? { code: "lesson_closed", message: "Урок закрыт" } : undefined) });
    const { chatId, approvalId } = await waitingApprovalId(chat);
    state.closed = true;
    const response = await chat.call("POST", `/${chatId}/approvals/${approvalId}`, { body: { decision: "allow" } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { kind: "turn_refused", code: "lesson_closed", message: "Урок закрыт" } });
    expect(chat.execute).not.toHaveBeenCalled();
    expect((await chat.history(chatId)).messages.at(-1)?.metadata?.status).toBe("awaiting_approval");
    // Урок открыли — тот же запрос проходит.
    state.closed = false;
    expect((await chat.call("POST", `/${chatId}/approvals/${approvalId}`, { body: { decision: "allow" } })).status).toBe(200);
  });

  it("отказ не выполняет инструмент", async () => {
    const chat = setup();
    const { chatId, approvalId } = await waitingApprovalId(chat);
    const response = await chat.call("POST", `/${chatId}/approvals/${approvalId}`, { body: { decision: "deny" } });
    expect(await response.json()).toEqual({ resumed: true });
    await (await chat.call("GET", `/${chatId}/stream`)).text();
    expect(chat.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["нет решения", {}],
    ["чужое слово", { decision: "maybe" }],
    ["нет тела", undefined],
  ])("%s — 400", async (_, body) => {
    const chat = setup();
    const { chatId, approvalId } = await waitingApprovalId(chat);
    const response = await chat.call("POST", `/${chatId}/approvals/${approvalId}`, body === undefined ? {} : { body });
    expect(response.status).toBe(400);
  });

  it("неизвестный запрос и повторный ответ — 409; чужой чат — 404; без входа — 401", async () => {
    const chat = setup();
    const { chatId, approvalId } = await waitingApprovalId(chat);
    const unknown = await chat.call("POST", `/${chatId}/approvals/нет`, { body: { decision: "allow" } });
    expect(unknown.status).toBe(409);
    expect(await unknown.json()).toEqual({ error: { kind: "approval_not_pending" } });
    expect((await chat.call("POST", `/${chatId}/approvals/${approvalId}`, { body: { decision: "allow" }, user: "boris" })).status).toBe(404);
    expect((await chat.call("POST", `/${chatId}/approvals/${approvalId}`, { body: { decision: "allow" }, user: null })).status).toBe(401);
    await (await chat.call("POST", `/${chatId}/approvals/${approvalId}`, { body: { decision: "allow" } })).text();
    await (await chat.call("GET", `/${chatId}/stream`)).text();
    const again = await chat.call("POST", `/${chatId}/approvals/${approvalId}`, { body: { decision: "allow" } });
    expect(again.status).toBe(409);
    // Не «busy»: чат свободен, просто на этот запрос отвечать уже нечем.
    expect(await again.json()).toEqual({ error: { kind: "approval_not_pending" } });
  });

  it("GET и лишние сегменты пути — 404", async () => {
    const chat = setup();
    const { chatId, approvalId } = await waitingApprovalId(chat);
    expect((await chat.call("GET", `/${chatId}/approvals/${approvalId}`)).status).toBe(404);
    expect((await chat.call("POST", `/${chatId}/approvals/${approvalId}/x`, { body: { decision: "allow" } })).status).toBe(404);
  });
});
