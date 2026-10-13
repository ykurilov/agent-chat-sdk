import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { jsonSchema, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { catalogWithModel, usage } from "./support/mock-catalog";
import { createTestChat, message } from "./support/test-chat";

const finish = (reason: "stop" | "tool-calls"): LanguageModelV4StreamPart => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage });
const saying = (text: string): LanguageModelV4StreamPart[] => [
  { type: "stream-start", warnings: [] },
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: text },
  { type: "text-end", id: "t" },
  finish("stop"),
];
const callingOpenTask: LanguageModelV4StreamPart[] = [
  { type: "stream-start", warnings: [] },
  { type: "tool-call", toolCallId: "c1", toolName: "open_task", input: JSON.stringify({ taskId: 2 }) },
  finish("tool-calls"),
];

const tab = "tab-7";

/** Модель зовёт браузерный `open_task`, потом говорит «Открыл». */
function setup() {
  let call = 0;
  const steps = [callingOpenTask, saying("Открыл")];
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const step = steps[call++] ?? saying("ещё");
      return { stream: new ReadableStream({ start: (controller) => (step.forEach((part) => controller.enqueue(part)), controller.close()) }) };
    },
  });
  const openTask = tool({
    description: "Открыть задачу",
    inputSchema: jsonSchema<{ taskId: number }>({ type: "object", properties: { taskId: { type: "number" } }, required: ["taskId"] }),
  });
  return createTestChat({ catalog: catalogWithModel(model), agent: { instructions: "x", browserTools: { open_task: openTask } } });
}

/** Читает поток ответа, пока в нём не появится `marker`; возвращает функцию «дочитать до конца». */
async function readUntil(response: Response, marker: string): Promise<{ text: string; rest: () => Promise<string> }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(marker)) {
    const read = await reader.read();
    if (read.done) throw new Error(`поток кончился без ${marker}: ${text}`);
    text += decoder.decode(read.value, { stream: true });
  }
  return {
    text,
    rest: async () => {
      for (let read = await reader.read(); !read.done; read = await reader.read()) text += decoder.decode(read.value, { stream: true });
      return text;
    },
  };
}

async function waitingCall() {
  const chat = setup();
  const chatId = await chat.createChat();
  const response = await chat.call("POST", `/${chatId}/messages`, { body: { ...message("u1", "открой задачу 2"), tabId: tab } });
  expect(response.status).toBe(200);
  const stream = await readUntil(response, "data-browser-call");
  return { ...chat, chatId, stream };
}

const answer = (chat: Awaited<ReturnType<typeof waitingCall>>, body: unknown, init: { user?: string | null; toolCallId?: string } = {}) =>
  chat.call("POST", `/${chat.chatId}/browser-tools/${init.toolCallId ?? "c1"}`, { body, ...(init.user !== undefined && { user: init.user }) });

describe("обработчик чата: ответ вкладки на браузерный инструмент", () => {
  it("кусок вызова уходит в поток своей вкладке; ответ — 204, ход продолжается с результатом", async () => {
    const chat = await waitingCall();
    expect(chat.stream.text).toContain(`"tabId":"${tab}"`);
    const response = await answer(chat, { tabId: tab, output: { opened: 2 } });
    expect(response.status).toBe(204);
    const text = await chat.stream.rest();
    expect(text).toContain("tool-output-available");
    expect(text).toContain("Открыл");
  });

  it("ответ с ошибкой — 204, вызов закрыт ошибкой с её текстом", async () => {
    const chat = await waitingCall();
    expect((await answer(chat, { tabId: tab, error: "Задачи нет" })).status).toBe(204);
    const text = await chat.stream.rest();
    expect(text).toContain("tool-output-error");
    expect(text).toContain("Задачи нет");
  });

  it.each<[string, unknown]>([
    ["нет tabId", { output: 1 }],
    ["tabId не строка", { tabId: 5, output: 1 }],
    ["tabId пустой", { tabId: "", output: 1 }],
    ["нет ни output, ни error", { tabId: tab }],
    ["и output, и error", { tabId: tab, output: 1, error: "x" }],
    ["error не строка", { tabId: tab, error: 5 }],
    ["тело не объект", "строка"],
  ])("400 invalid: %s — вызов ждёт дальше", async (_name, body) => {
    const chat = await waitingCall();
    const response = await answer(chat, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { kind: "invalid" } });
    expect((await answer(chat, { tabId: tab, output: "ок" })).status).toBe(204);
    await chat.stream.rest();
  });

  it("тело больше 64 КБ — 413 too_large, как у других адресов; вызов ждёт дальше", async () => {
    const chat = await waitingCall();
    const response = await answer(chat, { tabId: tab, output: "я".repeat(40_000) });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: { kind: "too_large" } });
    expect((await answer(chat, { tabId: tab, output: "ок" })).status).toBe(204);
    await chat.stream.rest();
  });

  it("заявленная длина тела больше 64 КБ — 413 без чтения тела", async () => {
    const chat = await waitingCall();
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ tabId: tab, output: "ок" })));
        controller.close();
      },
    }, { highWaterMark: 0 });
    const response = await chat.handler.fetch(
      new Request(`http://test.local/api/chat/${chat.chatId}/browser-tools/c1`, {
        method: "POST",
        headers: { "x-user": "anna", "content-type": "application/json", "content-length": String(65 * 1024) },
        body,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(pulled).toBe(0);
    expect((await answer(chat, { tabId: tab, output: "ок" })).status).toBe(204);
    await chat.stream.rest();
  });

  it("тело без длины читается не дальше 64 КБ: огромный поток не дочитывается", async () => {
    const chat = await waitingCall();
    const piece = new Uint8Array(16 * 1024).fill(0x20);
    let pulledBytes = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Без конца: обработчик, читающий всё тело, тут бы завис.
        pulledBytes += piece.byteLength;
        controller.enqueue(piece);
        if (pulledBytes >= 4 * 1024 * 1024) controller.close();
      },
    });
    const response = await chat.handler.fetch(
      new Request(`http://test.local/api/chat/${chat.chatId}/browser-tools/c1`, {
        method: "POST",
        headers: { "x-user": "anna", "content-type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(pulledBytes).toBeLessThan(256 * 1024);
    expect((await answer(chat, { tabId: tab, output: "ок" })).status).toBe(204);
    await chat.stream.rest();
  });

  it("401 без человека, 404 чужой чат", async () => {
    const chat = await waitingCall();
    expect((await answer(chat, { tabId: tab, output: 1 }, { user: null })).status).toBe(401);
    const foreign = await answer(chat, { tabId: tab, output: 1 }, { user: "boris" });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: { kind: "not_found" } });
    expect((await answer(chat, { tabId: tab, output: "ок" })).status).toBe(204);
    await chat.stream.rest();
  });

  it("409 not_pending: чужая вкладка, неизвестный вызов, повторный ответ", async () => {
    const chat = await waitingCall();
    const foreignTab = await answer(chat, { tabId: "tab-other", output: 1 });
    expect(foreignTab.status).toBe(409);
    expect(await foreignTab.json()).toEqual({ error: { kind: "not_pending" } });
    expect((await answer(chat, { tabId: tab, output: 1 }, { toolCallId: "c-unknown" })).status).toBe(409);
    expect((await answer(chat, { tabId: tab, output: "ок" })).status).toBe(204);
    expect((await answer(chat, { tabId: tab, output: "повтор" })).status).toBe(409);
    await chat.stream.rest();
  });

  it("другие методы на адресе — 404", async () => {
    const chat = await waitingCall();
    expect((await chat.call("GET", `/${chat.chatId}/browser-tools/c1`)).status).toBe(404);
    expect((await answer(chat, { tabId: tab, output: "ок" })).status).toBe(204);
    await chat.stream.rest();
  });
});
