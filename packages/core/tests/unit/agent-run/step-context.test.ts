import type { ModelMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStepSnapshots } from "../../../src/agent-run/step-context";
import type { StepContextInput } from "../../../src/agent-run/step-context";

const context = (stepNumber: number): StepContextInput => ({
  state: {},
  stepNumber,
  chatId: "chat-1",
  ownerId: "anna",
  messageId: "a1",
  chat: {},
  channel: "web",
  audience: "private",
  modelId: "m",
  providerId: "p",
  abortSignal: new AbortController().signal,
});
const user = (text: string): ModelMessage => ({ role: "user", content: text });
const texts = (messages: ModelMessage[]) =>
  messages.map((message) => (typeof message.content === "string" ? message.content : message.content.map((part) => ("text" in part ? part.text : "")).join("")));

describe("createStepSnapshots", () => {
  it("пометка попытки остаётся последней: снимок — перед ней", async () => {
    const snapshots = createStepSnapshots({ stepContext: () => "снимок", logError: vi.fn(), chatId: "chat-1" });
    const { messages } = await snapshots.messagesFor({ messages: [user("вопрос"), user("продолжи")], trailing: 1, context: context(0) });
    expect(texts(messages)).toEqual(["вопрос", "снимок", "продолжи"]);
  });

  it("снимок прошлого шага убирается, даже если новый не нужен", async () => {
    let text: string | null = "первый";
    const snapshots = createStepSnapshots({ stepContext: () => text, logError: vi.fn(), chatId: "chat-1" });
    const first = await snapshots.messagesFor({ messages: [user("вопрос")], trailing: 0, context: context(0) });
    const carried = [...first.messages, { role: "assistant", content: "ответ шага" } as ModelMessage];
    text = null;
    const second = await snapshots.messagesFor({ messages: carried, trailing: 0, context: context(1) });
    expect(texts(second.messages)).toEqual(["вопрос", "ответ шага"]);
    expect(second.tokens).toBe(0);
  });

  it("не строка — шаг без снимка и строка в журнал", async () => {
    const logError = vi.fn();
    const snapshots = createStepSnapshots({ stepContext: () => ({ a: 1 }) as unknown as string, logError, chatId: "chat-1" });
    const input = [user("вопрос")];
    const { messages } = await snapshots.messagesFor({ messages: input, trailing: 0, context: context(2) });
    expect(messages).toBe(input);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("[снимок шага] чат=chat-1 шаг=2"));
  });
});

describe("createStepSnapshots: срок функции и «Стоп»", () => {
  afterEach(() => vi.useRealTimers());
  const hanging = (signals: AbortSignal[]) => ({ abortSignal }: StepContextInput) => {
    signals.push(abortSignal);
    return new Promise<string>(() => {});
  };

  it("не ответила за срок — шаг без снимка, строка «не ответил» в журнал, её сигнал отменён", async () => {
    vi.useFakeTimers();
    const logError = vi.fn();
    const signals: AbortSignal[] = [];
    const snapshots = createStepSnapshots({ stepContext: hanging(signals), logError, chatId: "chat-1", timeoutMs: 2_000 });
    const input = [user("вопрос")];
    const pending = snapshots.messagesFor({ messages: input, trailing: 0, context: context(3) });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const { messages, tokens } = await pending;
    expect(messages).toBe(input);
    expect(tokens).toBe(0);
    expect(signals[0]!.aborted).toBe(true);
    expect(logError).toHaveBeenCalledWith("[снимок шага] чат=chat-1 шаг=3 не ответил за 2000 мс");
  });

  it("срок не задан — 5 секунд", async () => {
    vi.useFakeTimers();
    const logError = vi.fn();
    const snapshots = createStepSnapshots({ stepContext: hanging([]), logError, chatId: "chat-1" });
    const pending = snapshots.messagesFor({ messages: [user("вопрос")], trailing: 0, context: context(0) });
    await vi.advanceTimersByTimeAsync(5_000);
    await pending;
    expect(logError).toHaveBeenCalledWith("[снимок шага] чат=chat-1 шаг=0 не ответил за 5000 мс");
  });

  it("«Стоп» отменяет ожидание сразу: без снимка, без строки в журнал, сигнал функции отменён", async () => {
    const logError = vi.fn();
    const signals: AbortSignal[] = [];
    const stop = new AbortController();
    const snapshots = createStepSnapshots({ stepContext: hanging(signals), logError, chatId: "chat-1", timeoutMs: Number.POSITIVE_INFINITY });
    const input = [user("вопрос")];
    const pending = snapshots.messagesFor({ messages: input, trailing: 0, context: { ...context(0), abortSignal: stop.signal } });
    stop.abort(new Error("стоп"));
    expect((await pending).messages).toBe(input);
    expect(signals[0]!.aborted).toBe(true);
    expect(logError).not.toHaveBeenCalled();
  });

  it("ответила до срока — снимок есть, сигнал не отменён", async () => {
    vi.useFakeTimers();
    const logError = vi.fn();
    const signals: AbortSignal[] = [];
    const snapshots = createStepSnapshots({
      stepContext: async ({ abortSignal }) => {
        signals.push(abortSignal);
        return "снимок";
      },
      logError,
      chatId: "chat-1",
      timeoutMs: 2_000,
    });
    const { messages } = await snapshots.messagesFor({ messages: [user("вопрос")], trailing: 0, context: context(0) });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(texts(messages)).toEqual(["вопрос", "снимок"]);
    expect(signals[0]!.aborted).toBe(false);
    expect(logError).not.toHaveBeenCalled();
  });
});
