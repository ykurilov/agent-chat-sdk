import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { catalogWithModel, createGate } from "./support/mock-catalog";
import { parseSse } from "./support/sse";
import { createTestChat, message } from "./support/test-chat";

type Chat = ReturnType<typeof createTestChat>;

/** Три адреса, которые отдают поток ответа: каждый открывается так, чтобы ответ ещё шёл. */
const streamAddresses: Array<[string, (chat: Chat, chatId: string) => Promise<Response>]> = [
  ["POST …/messages", (chat, id) => chat.call("POST", `/${id}/messages`, { body: message("m1", "Привет") })],
  [
    "GET …/stream",
    async (chat, id) => {
      await chat.call("POST", `/${id}/messages`, { body: message("m1", "Привет") });
      return chat.call("GET", `/${id}/stream`);
    },
  ],
  [
    "POST …/retry",
    async (chat, id) => {
      const sent = await chat.call("POST", `/${id}/messages`, { body: message("m1", "Привет") });
      expect((await chat.call("POST", `/${id}/stop`)).status).toBe(202);
      await sent.text();
      return chat.call("POST", `/${id}/retry`);
    },
  ],
];

describe("признаки жизни в ответах-потоках", () => {
  it.each(streamAddresses)("%s несёт заголовки и пинги", async (_, open) => {
    const gate = createGate();
    const chat = createTestChat({ gate: gate.wait });
    const response = await open(chat, await chat.createChat());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-agent-chat-heartbeat-ms")).toBe("10000");
    for (const [name, value] of Object.entries(UI_MESSAGE_STREAM_HEADERS)) expect(response.headers.get(name)).toBe(value);
    gate.open();
    expect((await response.text()).startsWith(": ping\n\n")).toBe(true);
  });

  it("срок из настройки попадает в заголовок", async () => {
    const { call, createChat } = createTestChat({ heartbeatIntervalMs: 2500 });
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("m1", "Привет") });
    expect(response.headers.get("x-agent-chat-heartbeat-ms")).toBe("2500");
    await response.text();
  });

  it("история и стоп пингов не несут", async () => {
    const { call, createChat } = createTestChat();
    const chatId = await createChat();
    const history = await call("GET", `/${chatId}`);
    expect(history.headers.get("x-agent-chat-heartbeat-ms")).toBeNull();
    expect(await history.text()).not.toContain(": ping");
    const stop = await call("POST", `/${chatId}/stop`);
    expect(stop.headers.get("x-agent-chat-heartbeat-ms")).toBeNull();
  });

  it("части ответа с пингами те же, что без них, а в хранилище следов пингов нет", async () => {
    const { call, createChat, storage } = createTestChat();
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("m1", "Привет") });
    const text = await response.text();
    const withPings = parseSse(text);
    const withoutPings = parseSse(
      text
        .split("\n\n")
        .filter((block) => block !== ": ping")
        .join("\n\n"),
    );
    expect(withPings).toEqual(withoutPings);
    expect(withPings.length).toBeGreaterThan(2);
    const saved = JSON.stringify(await storage.listMessages(chatId));
    expect(saved).not.toContain("ping");
  });

  it("подключение к ходу не перезапускает его", async () => {
    const gate = createGate();
    let calls = 0;
    const { call, createChat } = createTestChat({
      gate: async () => {
        calls += 1;
        await gate.wait();
      },
    });
    const chatId = await createChat();
    const sent = await call("POST", `/${chatId}/messages`, { body: message("m1", "Привет") });
    await call("GET", `/${chatId}/stream`).then((r) => r.body?.cancel());
    await call("GET", `/${chatId}/stream`).then((r) => r.body?.cancel());
    gate.open();
    await sent.text();
    expect(calls).toBe(1);
  });

  it("серверный срок первого куска работает как в 001 при идущих пингах", async () => {
    vi.useFakeTimers();
    try {
      // Модель молчит: поток не даёт ни одного куска. Пинги идут, но срок первого куска их не видит.
      const silent = new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          const stream = new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
            },
          });
          return { stream };
        },
      });
      const { call, createChat, storage } = createTestChat({ catalog: catalogWithModel(silent) });
      const chatId = await createChat();
      const response = await call("POST", `/${chatId}/messages`, { body: message("m1", "Привет") });
      const textPromise = response.text();
      await vi.advanceTimersByTimeAsync(600_000);
      const text = await textPromise;
      const pings = text.split("\n\n").filter((block) => block === ": ping").length;
      expect(pings).toBeGreaterThan(10);
      const [, answer] = await storage.listMessages(chatId);
      expect(answer?.status).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });
});
