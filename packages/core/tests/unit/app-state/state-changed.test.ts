import { describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "../../../src/index";
import { createChatEvents } from "../../../src/chat-events/chat-events";
import { createStateChanged } from "../../../src/app-state/state-changed";
import type { StateChangedHandler } from "../../../src/app-state/state-changed";

function setup(handler: StateChangedHandler, attempts = 1) {
  const chatEvents = createChatEvents();
  const events: ChatEvent[] = [];
  chatEvents.subscribe((event) => events.push(event));
  const logError = vi.fn();
  const stateChanged = createStateChanged({ handler, attempts, chatEvents, logError });
  const notify = (chatId: string, email: string, before: string | null = null) =>
    stateChanged.notify({
      ownerId: "anna",
      chatId,
      reason: "turn",
      before: before === null ? {} : { email: before },
      after: { email },
      atMessageId: `m-${email}`,
    });
  return { stateChanged, events, logError, notify };
}

describe("хук смены состояния: очередь на чат", () => {
  it("два notify подряд, первый хук медленный — второй начинается после конца первого", async () => {
    const log: string[] = [];
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
    const { notify, stateChanged } = setup(async ({ state }) => {
      log.push(`начало ${state.email}`);
      if (state.email === "a") await firstHeld;
      log.push(`конец ${state.email}`);
    });
    notify("c1", "a");
    notify("c1", "b", "a");
    await vi.waitFor(() => expect(log).toEqual(["начало a"]));
    releaseFirst();
    await stateChanged.drain();
    expect(log).toEqual(["начало a", "конец a", "начало b", "конец b"]);
  });

  it("повтор после сбоя — внутри очереди: следующее состояние ждёт, пока первое не дойдёт", async () => {
    vi.useFakeTimers();
    try {
      const delivered: string[] = [];
      let failFirst = true;
      const { notify, stateChanged } = setup(async ({ state }) => {
        if (state.email === "a" && failFirst) {
          failFirst = false;
          throw new Error("база занята");
        }
        delivered.push(String(state.email));
      }, 2);
      notify("c1", "a");
      notify("c1", "b", "a");
      await vi.advanceTimersByTimeAsync(5000);
      await stateChanged.drain();
      expect(delivered).toEqual(["a", "b"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("разные чаты друг друга не ждут", async () => {
    const log: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { notify, stateChanged } = setup(async ({ chatId }) => {
      if (chatId === "c1") await held;
      log.push(chatId);
    });
    notify("c1", "a");
    notify("c2", "a");
    await vi.waitFor(() => expect(log).toEqual(["c2"]));
    release();
    await stateChanged.drain();
    expect(log).toEqual(["c2", "c1"]);
  });
});

describe("хук смены состояния: остановка", () => {
  it("после drain хуки и события снова идут", async () => {
    const handler = vi.fn();
    const { notify, stateChanged, events } = setup(handler);
    notify("c1", "a");
    await stateChanged.drain();
    notify("c1", "b", "a");
    await stateChanged.drain();
    expect(handler.mock.calls.map(([input]) => input.state)).toEqual([{ email: "a" }, { email: "b" }]);
    expect(events.filter((event) => event.type === "state-changed")).toHaveLength(2);
  });

  it("notify во время drain: событие уходит сразу, хук идёт, drain дожидается и его", async () => {
    const log: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { notify, stateChanged, events } = setup(async ({ state }) => {
      if (state.email === "a") await held;
      log.push(String(state.email));
    });
    notify("c1", "a");
    let drained = false;
    const draining = stateChanged.drain().then(() => (drained = true));
    notify("c2", "b");
    expect(events.filter((event) => event.type === "state-changed")).toHaveLength(2);
    release();
    await draining;
    expect(drained).toBe(true);
    expect(log.sort()).toEqual(["a", "b"]);
  });
});
