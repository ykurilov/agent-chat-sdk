import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrepareTurn } from "../../../src/turn-hooks/prepare-turn";
import { PREPARE_TURN_TIMEOUT_MS, prepareTurnSafely } from "../../../src/turn-hooks/turn-preparation";

const context = {
  ownerId: "anna",
  chatId: "c1",
  messageId: "a1",
  chat: { id: "c1", userId: "anna", title: null, createdAt: "", updatedAt: "" },
  action: "send" as const,
  notices: [],
  timeZone: "Europe/Moscow",
  now: new Date(2026, 0, 1),
} as unknown as Parameters<typeof prepareTurnSafely>[0]["context"];

function run(prepareTurn: PrepareTurn, options: { state?: Record<string, unknown>; signal?: AbortSignal } = {}) {
  const logged: string[] = [];
  const result = prepareTurnSafely({
    prepareTurn,
    context,
    state: options.state ?? {},
    abortSignal: options.signal ?? new AbortController().signal,
    logError: (line) => void logged.push(line),
  });
  return { result, logged };
}

describe("prepareTurnSafely", () => {
  afterEach(() => vi.useRealTimers());

  it("записи: unset, затем set; состояние для хода со служебными ключами, подготовке — без них", async () => {
    let saw: Record<string, unknown> | undefined;
    const { result } = run(
      ({ state }) => {
        saw = state;
        return { unset: ["a"], set: { b: 2 } };
      },
      { state: { a: 1, $closed: { at: "x" } } },
    );
    expect(await result).toEqual({ records: [{ unset: ["a"] }, { set: { b: 2 } }], state: { b: 2, $closed: { at: "x" } }, notices: [] });
    expect(saw).toEqual({ a: 1 });
  });

  it("пустой ответ — ход без записей", async () => {
    expect(await run(() => undefined).result).toEqual({ records: [], state: {}, notices: [] });
  });

  it("срок 3 секунды: сигнал подготовки отменён, ход без записей, строка в журнале", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { result, logged } = run(({ abortSignal }) => {
      signal = abortSignal;
      return new Promise(() => {});
    });
    await vi.advanceTimersByTimeAsync(PREPARE_TURN_TIMEOUT_MS - 1);
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBeUndefined();
    expect(signal!.aborted).toBe(true);
    expect(logged).toEqual([expect.stringContaining("[prepareTurn]")]);
    expect(PREPARE_TURN_TIMEOUT_MS).toBe(3000);
  });

  it("«Стоп» обрывает подготовку без строки в журнале", async () => {
    const stop = new AbortController();
    const { result, logged } = run(() => new Promise(() => {}), { signal: stop.signal });
    stop.abort();
    expect(await result).toBeUndefined();
    expect(logged).toEqual([]);
  });

  it("служебные сообщения без названия отбрасываются целиком", async () => {
    const { result, logged } = run(() => ({ notices: [{ kind: "app", title: 5 } as never] }));
    expect(await result).toBeUndefined();
    expect(logged).toEqual([expect.stringContaining("[prepareTurn]")]);
  });
});
