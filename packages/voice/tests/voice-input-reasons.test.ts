import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceInput } from "../src/index";
import { createHarness, fakeResponse, FakeWebSocket, sessionResponse, settle } from "./support/fakes";
import type { Harness } from "./support/fakes";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const relayOptions = (harness: Harness) => ({ ...harness.options, mode: "relay" as const, relayUrl: "wss://app.test/api/voice/stream" });

async function refusedWith(code: number) {
  const harness = createHarness();
  createVoiceInput(relayOptions(harness)).start(harness.listener);
  await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  harness.socket().open();
  await settle();
  harness.socket().closeFromServer(code);
  await settle();
  return harness.events;
}

describe("причина отказа сервера доходит до человека", () => {
  it.each([
    [4402, "limit"],
    [4401, "forbidden"],
    [4403, "forbidden"],
    [4413, "too_long"],
    [1009, "too_long"],
    [4429, "rate_limited"],
    [4502, "service_unavailable"],
  ])("код закрытия %s → ошибка %s", async (code, kind) => {
    expect(await refusedWith(code)).toEqual([`error:${kind}`, "end"]);
  });
});

describe("предел записи в ошибке time_limit", () => {
  it("сервер назвал предел — он приходит вместе с ошибкой", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const details: unknown[] = [];
    const listener = { ...harness.listener, onError: (kind: string, detail?: unknown) => details.push([kind, detail]) };
    createVoiceInput(relayOptions(harness)).start(listener as never);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    harness.socket().open();
    await vi.advanceTimersByTimeAsync(0);
    harness.socket().receive({ ready: true, max_session_seconds: 180 });
    await vi.advanceTimersByTimeAsync(0);

    harness.socket().closeFromServer(4408);
    await vi.advanceTimersByTimeAsync(0);

    expect(details).toEqual([["time_limit", { maxSessionSeconds: 180 }]]);
  });
});

describe("чат и язык каждой записи", () => {
  it("relay: чат — в адресе соединения, язык — в приветствии", async () => {
    const harness = createHarness();
    createVoiceInput(relayOptions(harness)).start(harness.listener, { chatId: "chat 42", language: "en-US" });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    harness.socket().open();
    await settle();

    expect(harness.socket().url).toBe("wss://app.test/api/voice/stream?chat=chat+42");
    expect(JSON.parse(harness.socket().sent[0] as string)).toEqual({ audio_format: "auto", language_hints: ["en-US"] });
  });

  it("свои языки приложения важнее языка экрана", async () => {
    const harness = createHarness();
    createVoiceInput({ ...relayOptions(harness), relayUrl: "wss://app.test/stream?x=1", languageHints: () => ["ru", "en"] }).start(harness.listener, {
      chatId: "c1",
      language: "de",
    });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    harness.socket().open();
    await settle();

    expect(harness.socket().url).toBe("wss://app.test/stream?x=1&chat=c1");
    expect(JSON.parse(harness.socket().sent[0] as string)).toEqual({ audio_format: "auto", language_hints: ["ru", "en"] });
  });

  it("без чата и языка — адрес и приветствие как раньше", async () => {
    const harness = createHarness();
    createVoiceInput(relayOptions(harness)).start(harness.listener);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    harness.socket().open();
    await settle();
    expect(harness.socket().url).toBe("wss://app.test/api/voice/stream");
    expect(JSON.parse(harness.socket().sent[0] as string)).toEqual({ audio_format: "auto" });
  });

  it("direct: язык уходит в теле запроса ключа", async () => {
    const harness = createHarness({ fetch: async () => fakeResponse(sessionResponse) });
    createVoiceInput(harness.options).start(harness.listener, { language: "en" });
    await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalled());

    const [, init] = harness.fetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ languageHints: ["en"] });
  });
});
