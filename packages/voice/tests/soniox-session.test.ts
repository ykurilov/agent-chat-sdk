import { afterEach, describe, expect, it, vi } from "vitest";
import { createSonioxSession } from "../src/server";
import type { SonioxCloseReason, SonioxSessionOptions } from "../src/server";
import type { SonioxEvent } from "../src/soniox-messages";
import { FakeUpstream } from "./support/fake-upstream";

afterEach(() => vi.useRealTimers());

const KEY = "main-secret-key-0123456789";

function sessionWith(options: Partial<SonioxSessionOptions> = {}) {
  FakeUpstream.instances = [];
  const log: string[] = [];
  const messages: Array<{ raw: string; event: SonioxEvent }> = [];
  const closed: SonioxCloseReason[] = [];
  const session = createSonioxSession(
    {
      apiKey: KEY,
      model: "stt-rt-v5",
      languageHints: ["ru"],
      websocketUrl: "wss://stt.test/transcribe",
      logError: (message) => log.push(message),
      connectUpstream: (url, headers) => new FakeUpstream(url, headers) as never,
      ...options,
    },
    {
      onReady: () => log.push("ready"),
      onMessage: (raw, event) => messages.push({ raw, event }),
      onClosed: (reason) => closed.push(reason),
    },
  );
  return { session, log, messages, closed, upstream: () => FakeUpstream.instances.at(-1)! };
}

async function opened(options: Partial<SonioxSessionOptions> = {}) {
  const setup = sessionWith(options);
  setup.session.begin({ audio_format: "auto" });
  setup.upstream().open();
  return setup;
}

describe("сессия Soniox на сервере: старт", () => {
  it("соединяется сразу, с заданными адресом и заголовками; пока не начали — ничего не отправляет", () => {
    const { upstream } = sessionWith({ headers: { "X-Proxy-Token": "t" } });
    upstream().open();

    expect(upstream().url).toBe("wss://stt.test/transcribe");
    expect(upstream().headers).toEqual({ "X-Proxy-Token": "t" });
    expect(upstream().sent).toEqual([]);
  });

  it("begin после открытия: первое сообщение с ключом, моделью, подсказками, контекстом и границами фраз; затем «готово»", async () => {
    const { upstream, log } = await opened({ context: { text: "магазин" } });

    expect(upstream().messages).toEqual([
      {
        api_key: KEY,
        model: "stt-rt-v5",
        audio_format: "auto",
        language_hints: ["ru"],
        context: { text: "магазин" },
        enable_endpoint_detection: true,
      },
    ]);
    expect(log).toEqual(["ready"]);
  });

  it("begin раньше, чем открылось соединение: ждёт открытия", () => {
    const { session, upstream, log } = sessionWith();
    session.begin({ audio_format: "auto" });
    expect(upstream().sent).toEqual([]);

    upstream().open();

    expect(upstream().sent).toHaveLength(1);
    expect(log).toEqual(["ready"]);
  });

  it("формат PCM попадает в первое сообщение", async () => {
    const { upstream } = await opened();
    const pcm = sessionWith();
    pcm.session.begin({ audio_format: "pcm_s16le", sample_rate: 16000, num_channels: 1 });
    pcm.upstream().open();

    expect(upstream().messages).toHaveLength(1);
    expect(pcm.upstream().messages[0]).toMatchObject({ audio_format: "pcm_s16le", sample_rate: 16000, num_channels: 1 });
  });
});

describe("сессия Soniox на сервере: звук и команды", () => {
  it("звук, «финализировать» и конец звука уходят в Soniox по порядку", async () => {
    const { session, upstream } = await opened();

    session.sendAudio(new Uint8Array([1, 2]));
    session.finalize();
    session.endAudio();

    expect(upstream().sent.slice(1)).toEqual([new Uint8Array([1, 2]), JSON.stringify({ type: "finalize" }), ""]);
  });

  it("до «готово» и после закрытия ничего не отправляется", async () => {
    const early = sessionWith();
    early.session.sendAudio(new Uint8Array([1]));
    early.session.finalize();
    early.upstream().open();
    expect(early.upstream().sent).toEqual([]);

    const { session, upstream } = await opened();
    session.close();
    session.sendAudio(new Uint8Array([1]));
    session.finalize();
    expect(upstream().sent).toHaveLength(1);
  });
});

describe("сессия Soniox на сервере: ответы", () => {
  it("ответ приходит наружу без ключа и уже разобранным; текст копится", async () => {
    const { upstream, messages, session } = await opened();

    upstream().receive({ tokens: [{ text: "Привет", is_final: true }, { text: " ми", is_final: false }] });
    upstream().receive({ error_code: 401, error_message: `bad key ${KEY}` });

    expect(messages[0]!.event).toEqual({ type: "text", text: { finalText: "Привет", interimText: " ми" } });
    expect(messages[1]!.event).toMatchObject({ type: "error", code: 401 });
    expect(messages.map((item) => item.raw).join("\n")).not.toContain(KEY);
    expect(session.text()).toEqual({ finalText: "Привет", interimText: " ми" });
  });

  it("с пустым ключом ответ Soniox не портится: замена ключа пропускается", async () => {
    const { upstream, messages } = await opened({ apiKey: "" });
    const answer = { tokens: [{ text: "Привет", is_final: true }] };

    upstream().receive(answer);

    expect(messages[0]!.raw).toBe(JSON.stringify(answer));
  });

  it("метка <fin> после «финализировать» отмечена в событии", async () => {
    const { upstream, messages } = await opened();

    upstream().receive({ tokens: [{ text: "Привет", is_final: true }, { text: "<fin>", is_final: true }] });

    expect(messages[0]!.event).toEqual({ type: "text", text: { finalText: "Привет", interimText: "" }, finalized: true });
  });

  it("не текстовые сообщения от Soniox игнорируются", async () => {
    const { upstream, messages } = await opened();

    upstream().receiveRaw(new Uint8Array([1]));

    expect(messages).toEqual([]);
  });
});

describe("сессия Soniox на сервере: сбои и завершение", () => {
  it("не соединились: причина в журнале, сообщаем «не соединились»", () => {
    const { upstream, closed, log } = sessionWith();

    upstream().fail();

    expect(closed).toEqual(["failed"]);
    expect(log.join("\n")).toContain("Soniox");
  });

  it("не ответили за отведённое время: закрыли соединение, сообщили один раз", async () => {
    vi.useFakeTimers();
    const { upstream, closed } = sessionWith({ connectTimeoutMs: 5_000 });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(closed).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);

    expect(closed).toEqual(["failed"]);
    expect(upstream().closed).toBe(true);
  });

  it("таймер соединения снят, когда сессия готова", async () => {
    vi.useFakeTimers();
    const { closed } = await opened({ connectTimeoutMs: 5_000 });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(closed).toEqual([]);
  });

  it("Soniox закончил (finished) и закрыл — нормальное завершение", async () => {
    const { upstream, closed } = await opened();
    upstream().receive({ tokens: [], finished: true });

    upstream().drop(1006);

    expect(closed).toEqual(["finished"]);
  });

  it("Soniox закрыл с кодом 1000 — тоже нормальное завершение", async () => {
    const { upstream, closed } = await opened();

    upstream().drop(1000);

    expect(closed).toEqual(["finished"]);
  });

  it("Soniox оборвал посреди записи: «оборвано», в журнале код", async () => {
    const { upstream, closed, log } = await opened();

    upstream().drop(1006);

    expect(closed).toEqual(["dropped"]);
    expect(log.join("\n")).toContain("1006");
  });

  it("предел длины: по истечении закрываем соединение и сообщаем «время вышло»", async () => {
    vi.useFakeTimers();
    const { closed, upstream } = await opened({ maxSessionSeconds: 10 });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(closed).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);

    expect(closed).toEqual(["time_limit"]);
    expect(upstream().closed).toBe(true);
  });

  it("владелец закрыл сам: соединение закрыто, таймеры сняты, сообщений о закрытии нет", async () => {
    vi.useFakeTimers();
    const { session, closed, upstream } = await opened({ maxSessionSeconds: 10 });

    session.close();
    session.close();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(upstream().closed).toBe(true);
    expect(closed).toEqual([]);
  });
});
