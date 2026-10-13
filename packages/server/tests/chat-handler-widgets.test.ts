import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { SpendingLimitReachedError } from "@ykurilov/agent-chat-core";
import type { AgentChatMessage, SpendingLimits } from "@ykurilov/agent-chat-core";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import type { ChatHandlerOptions } from "../src/chat-handler";
import { catalogWithModel, usage } from "./support/mock-catalog";
import { parseSse } from "./support/sse";
import { createTestChat, message } from "./support/test-chat";

const finish = (reason: "stop" | "tool-calls"): LanguageModelV4StreamPart => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage });

/** Первый ход спрашивает ask_choice, следующие отвечают текстом. */
function setup(options: Partial<ChatHandlerOptions> = {}) {
  let call = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const parts: LanguageModelV4StreamPart[] =
        call++ === 0
          ? [
              { type: "stream-start", warnings: [] },
              { type: "tool-call", toolCallId: "w1", toolName: "ask_choice", input: JSON.stringify({ question: "Куда едем?", options: ["Море", "Горы"] }) },
              finish("tool-calls"),
            ]
          : [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t" },
              { type: "text-delta", id: "t", delta: "Отлично" },
              { type: "text-end", id: "t" },
              finish("stop"),
            ];
      return { stream: new ReadableStream({ start: (controller) => (parts.forEach((part) => controller.enqueue(part)), controller.close()) }) };
    },
  });
  const logError = vi.fn<(line: string) => void>();
  const chat = createTestChat({ catalog: catalogWithModel(model), agent: { instructions: "x", widgets: { basic: true } }, logError, ...options });
  return { ...chat, logError };
}

async function waitingWidget(chat: ReturnType<typeof setup>) {
  const chatId = await chat.createChat();
  await (await chat.call("POST", `/${chatId}/messages`, { body: message("u1", "помоги выбрать") })).text();
  return chatId;
}

const errorKind = async (response: Response) => ((await response.json()) as { error: { kind: string } }).error.kind;
const widgetLines = (chat: ReturnType<typeof setup>) => chat.logError.mock.calls.map(([line]) => line).filter((line) => line.startsWith("[виджет]"));

describe("обработчик чата: ответ на виджет", () => {
  it("ответ принят: 200 { resumed: true }, продолжение читается обычным GET /stream", async () => {
    const chat = setup();
    const chatId = await waitingWidget(chat);
    const response = await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Море" } } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ resumed: true });
    const chunks = parseSse(await (await chat.call("GET", `/${chatId}/stream`)).text());
    expect(chunks.some((chunk) => chunk.type === "text-delta")).toBe(true);
    const answer = (await chat.history(chatId)).messages.at(-1) as AgentChatMessage;
    expect(answer.metadata?.status).toBe("complete");
    expect(answer.parts.find((part) => part.type === "tool-ask_choice")).toMatchObject({ state: "output-available", output: { выбрано: "Море" } });
  });

  it("приложение отказало ходу (beforeTurn): 403 turn_refused, виджет ждёт, ответ не записан", async () => {
    const state = { closed: false };
    const chat = setup({ beforeTurn: () => (state.closed ? { code: "lesson_closed", message: "Урок закрыт" } : undefined) });
    const chatId = await waitingWidget(chat);
    state.closed = true;
    const response = await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Море" } } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { kind: "turn_refused", code: "lesson_closed", message: "Урок закрыт" } });
    const answer = (await chat.history(chatId)).messages.at(-1) as AgentChatMessage;
    expect(answer.metadata?.status).toBe("awaiting_approval");
    expect(answer.parts.find((part) => part.type === "tool-ask_choice")).toMatchObject({ state: "input-available" });
    state.closed = false;
    expect((await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Море" } } })).status).toBe(200);
  });

  it("ответ вне схемы — 400 invalid_answer, ничего не записано", async () => {
    const chat = setup();
    const chatId = await waitingWidget(chat);
    const response = await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Луна" } } });
    expect(response.status).toBe(400);
    expect(await errorKind(response)).toBe("invalid_answer");
    expect((await chat.history(chatId)).messages.at(-1)?.metadata?.status).toBe("awaiting_approval");
  });

  it("тело без answer, не JSON или длиннее предела — 400 invalid_answer и строка в журнале без содержимого", async () => {
    const chat = setup();
    const chatId = await waitingWidget(chat);
    const huge = "секрет".repeat(20_000);
    const responses = [
      await chat.call("POST", `/${chatId}/widgets/w1`, { body: { choice: "Море" } }),
      await chat.handler.fetch(
        new Request(`http://test.local/api/chat/${chatId}/widgets/w1`, { method: "POST", headers: { "x-user": "anna", "content-type": "application/json" }, body: "{не json" }),
      ),
      await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: huge } } }),
    ];
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(await errorKind(response)).toBe("invalid_answer");
    }
    expect(widgetLines(chat)).toEqual(Array(3).fill(`[виджет] отказ invalid_answer чат=${chatId} вызов=w1`));
    expect(JSON.stringify(chat.logError.mock.calls)).not.toContain("секрет");
    expect((await chat.history(chatId)).messages.at(-1)?.metadata?.status).toBe("awaiting_approval");
  });

  it("id из адреса с переводом строки не подделывает строки журнала: значение экранировано", async () => {
    const chat = setup();
    const forged = "c1\n[виджет] отказ поддельный";
    const response = await chat.call("POST", `/${encodeURIComponent(forged)}/widgets/${encodeURIComponent("w1\r\n")}`, { body: { choice: "Море" } });
    expect(response.status).toBe(400);
    expect(widgetLines(chat)).toEqual([`[виджет] отказ invalid_answer чат=${JSON.stringify(forged)} вызов=${JSON.stringify("w1\r\n")}`]);
  });

  it("повторный ответ и неизвестный вызов — 409 widget_not_pending; чужой чат — 404; без входа — 401", async () => {
    const chat = setup();
    const chatId = await waitingWidget(chat);
    await (await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Море" } } })).text();
    await (await chat.call("GET", `/${chatId}/stream`)).text();
    const again = await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Горы" } } });
    expect(again.status).toBe(409);
    expect(await errorKind(again)).toBe("widget_not_pending");
    const unknown = await chat.call("POST", `/${chatId}/widgets/w9`, { body: { answer: { выбрано: "Горы" } } });
    expect(await errorKind(unknown)).toBe("widget_not_pending");
    const stranger = await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Горы" } }, user: "boris" });
    expect(stranger.status).toBe(404);
    const anonymous = await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Горы" } }, user: null });
    expect(anonymous.status).toBe(401);
  });

  it("лимит расходов исчерпан — 429 spending_limit_reached, ответ не записан", async () => {
    const control = { exhausted: false };
    const limits: SpendingLimits = {
      assertWithinLimit: vi.fn(async () => {
        if (control.exhausted) throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: "2099-02-01T00:00:00.000Z" });
      }),
      status: vi.fn(async () => ({ state: "ok" as const })),
    };
    const chat = setup({ limits });
    const chatId = await waitingWidget(chat);
    control.exhausted = true;
    const response = await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Море" } } });
    expect(response.status).toBe(429);
    expect(await errorKind(response)).toBe("spending_limit_reached");
    expect((await chat.history(chatId)).messages.at(-1)?.metadata?.status).toBe("awaiting_approval");
  });

  it("форма с чужого сайта — 403 forbidden_origin, ответ не записан", async () => {
    const chat = setup();
    const chatId = await waitingWidget(chat);
    const response = await chat.handler.fetch(
      new Request(`http://test.local/api/chat/${chatId}/widgets/w1`, {
        method: "POST",
        headers: { "x-user": "anna", "content-type": "text/plain", origin: "https://evil.example", "sec-fetch-site": "cross-site" },
        body: JSON.stringify({ answer: { выбрано: "Море" } }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await errorKind(response)).toBe("forbidden_origin");
    expect((await chat.history(chatId)).messages.at(-1)?.metadata?.status).toBe("awaiting_approval");
  });

  it("GET и лишние сегменты пути — 404", async () => {
    const chat = setup();
    const chatId = await waitingWidget(chat);
    expect((await chat.call("GET", `/${chatId}/widgets/w1`)).status).toBe(404);
    expect((await chat.call("POST", `/${chatId}/widgets/w1/x`, { body: { answer: { выбрано: "Море" } } })).status).toBe(404);
    expect((await chat.call("POST", `/${chatId}/widgets`, { body: { answer: { выбрано: "Море" } } })).status).toBe(404);
  });
});

describe("обработчик чата: проверка ответа виджета (checkAnswer)", () => {
  const refusing = (message = "Это время уже заняли. Выберите другое.") =>
    setup({ agent: { instructions: "x", widgets: { basic: true, checkAnswer: async (_call, answer) => ((answer as { выбрано: string }).выбрано === "Море" ? { refuse: message } : undefined) } } });

  it("отказ приложения: 409 widget_answer_refused с кодом и словами, виджет ждёт, ответ не записан, в журнале вид без содержимого", async () => {
    const chat = refusing();
    const chatId = await waitingWidget(chat);
    const response = await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Море" } } });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { kind: "widget_answer_refused", code: "widget_answer_refused", message: "Это время уже заняли. Выберите другое." },
    });
    const answer = (await chat.history(chatId)).messages.at(-1) as AgentChatMessage;
    expect(answer.metadata?.status).toBe("awaiting_approval");
    expect(answer.parts.find((part) => part.type === "tool-ask_choice")).toMatchObject({ state: "input-available" });
    expect(widgetLines(chat)).toEqual([`[виджет] отказ answer_refused чат=${chatId} вызов=w1`]);
    expect(JSON.stringify(chat.logError.mock.calls)).not.toContain("Море");

    const accepted = await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Горы" } } });
    expect(accepted.status).toBe(200);
  });

  it("«Стоп» во время проверки: 409 widget_answer_cancelled, не 500; виджет ждёт, в журнале не ошибка, повтор принимается", async () => {
    let started!: () => void;
    const checkStarted = new Promise<void>((resolve) => (started = resolve));
    let calls = 0;
    const chat = setup({
      agent: {
        instructions: "x",
        widgets: {
          basic: true,
          checkAnswer: async (_call, _answer, ctx) => {
            if (calls++ > 0) return undefined;
            started();
            return new Promise<never>((_, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("прервано")), { once: true }));
          },
        },
      },
    });
    const chatId = await waitingWidget(chat);
    const answering = chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Море" } } });
    await checkStarted;
    expect((await chat.call("POST", `/${chatId}/stop`)).status).toBeLessThan(300);
    const response = await answering;
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { kind: "widget_answer_cancelled", code: "widget_answer_cancelled", message: expect.any(String) },
    });
    expect((await chat.history(chatId)).messages.at(-1)?.metadata?.status).toBe("awaiting_approval");
    expect(widgetLines(chat)).toEqual([`[виджет] отказ answer_cancelled чат=${chatId} вызов=w1`]);
    expect((await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Горы" } } })).status).toBe(200);
  });

  it("проверка не уложилась в срок: 504 widget_check_timeout, виджет ждёт, в журнале отказ, а не ошибка, повтор принимается", async () => {
    let calls = 0;
    const chat = setup({
      agent: {
        instructions: "x",
        widgets: { basic: true, checkAnswerTimeoutMs: 20, checkAnswer: async () => (calls++ > 0 ? undefined : new Promise<never>(() => {})) },
      },
    });
    const chatId = await waitingWidget(chat);
    const response = await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Море" } } });
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: { kind: "widget_check_timeout", code: "widget_check_timeout", message: expect.any(String) },
    });
    expect((await chat.history(chatId)).messages.at(-1)?.metadata?.status).toBe("awaiting_approval");
    expect(widgetLines(chat)).toEqual([`[виджет] отказ answer_check_timeout чат=${chatId} вызов=w1`]);
    expect((await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Горы" } } })).status).toBe(200);
  });

  it("исключение проверки: 500 other, виджет ждёт", async () => {
    const chat = setup({
      agent: {
        instructions: "x",
        widgets: {
          basic: true,
          checkAnswer: async () => {
            throw new Error("база недоступна");
          },
        },
      },
    });
    const chatId = await waitingWidget(chat);
    const response = await chat.call("POST", `/${chatId}/widgets/w1`, { body: { answer: { выбрано: "Море" } } });
    expect(response.status).toBe(500);
    expect(await errorKind(response)).toBe("other");
    expect((await chat.history(chatId)).messages.at(-1)?.metadata?.status).toBe("awaiting_approval");
  });
});
