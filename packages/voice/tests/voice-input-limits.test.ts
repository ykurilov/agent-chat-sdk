import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceInput } from "../src/index";
import { createHarness, fakeResponse, FakeWebSocket, sessionResponse } from "./support/fakes";
import type { Harness } from "./support/fakes";

afterEach(() => vi.useRealTimers());

async function startListening(harness: Harness) {
  const session = createVoiceInput(harness.options).start(harness.listener);
  // Часы могут быть подменены: время двигаем сами, а не ждём по-настоящему.
  await vi.advanceTimersByTimeAsync(0);
  await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  harness.socket().open();
  await vi.advanceTimersByTimeAsync(0);
  return session;
}

describe("частота диктовок и предел записи", () => {
  it("сервер отказал по частоте (429) — «слишком часто», микрофон свободен", async () => {
    const harness = createHarness({ fetch: async () => fakeResponse({ error: { kind: "rate_limited" } }, 429) });

    createVoiceInput(harness.options).start(harness.listener);
    await vi.waitFor(() => expect(harness.events).toEqual(["error:rate_limited", "end"]));

    expect(harness.stream.released).toBe(true);
  });

  it("предел записи из ответа сервера: за две секунды до него запись останавливается, остаток речи дописывается, человек видит причину", async () => {
    vi.useFakeTimers();
    const harness = createHarness({ fetch: async () => fakeResponse({ ...sessionResponse, maxSessionSeconds: 10 }) });
    await startListening(harness);
    harness.socket().receive({ tokens: [{ text: "Привет", is_final: true }, { text: " ми", is_final: false }] });

    await vi.advanceTimersByTimeAsync(7_900);
    expect(harness.recorder().state).toBe("recording");
    await vi.advanceTimersByTimeAsync(200);
    expect(harness.recorder().state).toBe("inactive");
    harness.socket().receive({ tokens: [{ text: " мир", is_final: true }], finished: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.events.slice(-3)).toEqual(["text:Привет мир|", "error:time_limit", "end"]);
    expect(harness.stream.released).toBe(true);
  });

  it("сервер не назвал предел — считаем пять минут", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    await startListening(harness);

    await vi.advanceTimersByTimeAsync(297_000);
    expect(harness.recorder().state).toBe("recording");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(harness.recorder().state).toBe("inactive");
  });

  it("человек остановил сам раньше — «предел» не сообщается", async () => {
    vi.useFakeTimers();
    const harness = createHarness({ fetch: async () => fakeResponse({ ...sessionResponse, maxSessionSeconds: 10 }) });
    const session = await startListening(harness);

    session.stop();
    harness.socket().receive({ tokens: [], finished: true });
    await vi.advanceTimersByTimeAsync(20_000);

    expect(harness.events).not.toContain("error:time_limit");
    expect(harness.events.at(-1)).toBe("end");
  });
});
