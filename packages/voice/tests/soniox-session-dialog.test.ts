import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter, createSonioxSession } from "../src/server";
import type { RateLimit, SonioxSessionOptions } from "../src/server";
import type { SonioxEvent } from "../src/soniox-messages";
import { FakeUpstream } from "./support/fake-upstream";

afterEach(() => vi.useRealTimers());

function sessionWith(options: Partial<SonioxSessionOptions> = {}) {
  FakeUpstream.instances = [];
  const messages: SonioxEvent[] = [];
  const session = createSonioxSession(
    {
      apiKey: "main-key",
      model: "stt-rt-v5",
      languageHints: ["ru"],
      websocketUrl: "wss://stt.test/transcribe",
      logError: () => {},
      connectUpstream: (url, headers) => new FakeUpstream(url, headers) as never,
      ...options,
    },
    { onReady: () => {}, onMessage: (_raw, event) => messages.push(event), onClosed: () => {} },
  );
  session.begin({ audio_format: "pcm_s16le", sample_rate: 16000, num_channels: 1 });
  const upstream = FakeUpstream.instances.at(-1)!;
  upstream.open();
  return { session, messages, upstream };
}

describe("сессия Soniox для диалога: параметры конца фразы", () => {
  it("уровень задержки и предел ожидания попадают в первое сообщение", () => {
    const { upstream } = sessionWith({ endpointLatencyLevel: 2, maxEndpointDelayMs: 1500 });
    expect(upstream.messages[0]).toMatchObject({ endpoint_latency_adjustment_level: 2, max_endpoint_delay_ms: 1500 });
  });

  it("без параметров первое сообщение прежнее", () => {
    const { upstream } = sessionWith();
    expect(upstream.messages[0]).not.toHaveProperty("endpoint_latency_adjustment_level");
    expect(upstream.messages[0]).not.toHaveProperty("max_endpoint_delay_ms");
  });

  it("phraseEnds: сессия отдаёт закончившиеся фразы событием; без него поля нет", () => {
    const on = sessionWith({ phraseEnds: true });
    on.upstream.receive({ tokens: [{ text: "Привет", is_final: true }, { text: "<end>", is_final: true }] });
    expect(on.messages[0]).toMatchObject({ type: "text", endedPhrases: ["Привет"] });

    const off = sessionWith();
    off.upstream.receive({ tokens: [{ text: "Привет", is_final: true }, { text: "<end>", is_final: true }] });
    expect(off.messages[0]).not.toHaveProperty("endedPhrases");
  });
});

describe("сессия Soniox для диалога: keepalive", () => {
  const keepalives = (upstream: FakeUpstream) => upstream.messages.filter((message) => message.type === "keepalive");

  it("в тишине раз в 15 секунд уходит {type: keepalive}", () => {
    vi.useFakeTimers();
    const { upstream } = sessionWith({ keepalive: true });
    vi.advanceTimersByTime(14_000);
    expect(keepalives(upstream)).toHaveLength(0);
    vi.advanceTimersByTime(1_000);
    expect(keepalives(upstream)).toHaveLength(1);
    vi.advanceTimersByTime(15_000);
    expect(keepalives(upstream)).toHaveLength(2);
  });

  it("пока идёт звук, keepalive не нужен и не отправляется", () => {
    vi.useFakeTimers();
    const { session, upstream } = sessionWith({ keepalive: true });
    for (let second = 0; second < 40; second += 1) {
      session.sendAudio(new Uint8Array(3200));
      vi.advanceTimersByTime(1_000);
    }
    expect(keepalives(upstream)).toHaveLength(0);
  });

  it("свой интервал; без настройки keepalive нет", () => {
    vi.useFakeTimers();
    const custom = sessionWith({ keepalive: { intervalMs: 5_000 } });
    vi.advanceTimersByTime(10_000);
    expect(keepalives(custom.upstream)).toHaveLength(2);

    const none = sessionWith();
    vi.advanceTimersByTime(60_000);
    expect(keepalives(none.upstream)).toHaveLength(0);
  });

  it("после закрытия сессии таймер снят: тишина", () => {
    vi.useFakeTimers();
    const { session, upstream } = sessionWith({ keepalive: true });
    session.close();
    vi.advanceTimersByTime(60_000);
    expect(keepalives(upstream)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("до «готово» (begin не вызывали) keepalive не идёт", () => {
    vi.useFakeTimers();
    FakeUpstream.instances = [];
    const session = createSonioxSession(
      { apiKey: "k", model: "m", languageHints: ["ru"], websocketUrl: "wss://x", logError: () => {}, keepalive: true, connectUpstream: (u, h) => new FakeUpstream(u, h) as never },
      { onReady: () => {}, onMessage: () => {}, onClosed: () => {} },
    );
    FakeUpstream.instances[0]!.open();
    vi.advanceTimersByTime(60_000);
    expect(FakeUpstream.instances[0]!.messages).toEqual([]);
    session.close();
  });
});

describe("ограничитель частоты доступен из ./server", () => {
  it("createRateLimiter и тип RateLimit экспортируются: окно считается по часам вызывающего", () => {
    let now = 0;
    const limit: RateLimit = { maxSessions: 2, perSeconds: 60 };
    const limiter = createRateLimiter(limit, () => now);
    expect(limiter.take("anna")).toBeNull();
    expect(limiter.take("anna")).toBeNull();
    expect(limiter.take("anna")).toBe(60);
    now = 61_000;
    expect(limiter.take("anna")).toBeNull();
  });
});
