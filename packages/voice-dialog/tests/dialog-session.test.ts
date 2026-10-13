import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { START, SONIOX_KEY, sessionWith, sonioxWords } from "./support/session-harness";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("сессия диалога: начало", () => {
  it("start открывает Soniox с настройками конца фразы; «готово» уходит, когда Soniox принял первое сообщение", () => {
    const setup = sessionWith();
    setup.session.start({ ...START, language: "ru" });
    expect(setup.of("ready")).toHaveLength(0);
    setup.soniox().open();
    expect(setup.soniox().messages[0]).toMatchObject({
      model: "stt-rt-v5",
      audio_format: "pcm_s16le",
      sample_rate: 16000,
      num_channels: 1,
      language_hints: ["ru"],
      enable_endpoint_detection: true,
      endpoint_latency_adjustment_level: 2,
      max_endpoint_delay_ms: 1500,
    });
    expect(setup.of("ready")).toEqual([{ type: "ready", maxSessionSeconds: 1800, idleSeconds: 180, voiceId: "voice-1", speech: true }]);
  });

  it("озвучка на сервере недоступна (нет настройки) — в «готово» speech: false", () => {
    const setup = sessionWith({ speech: null });
    setup.begin();
    expect(setup.of("ready")[0]?.speech).toBe(false);
  });

  it("куски звука уходят в Soniox как есть; до «готово» — никуда", () => {
    const setup = sessionWith();
    setup.session.start(START);
    setup.session.receiveAudio(new Uint8Array([1, 2]));
    setup.soniox().open();
    setup.session.receiveAudio(new Uint8Array([3, 4, 5]));
    expect(setup.soniox().audio).toEqual([new Uint8Array([3, 4, 5])]);
  });

  it("в тишине Soniox получает keepalive", () => {
    const setup = sessionWith();
    setup.begin();
    vi.advanceTimersByTime(15_000);
    expect(setup.soniox().messages.filter((message) => message.type === "keepalive")).toHaveLength(1);
  });
});

describe("сессия диалога: слова и конец фразы", () => {
  it("закреплённые слова приходят один раз, предварительные — заново целиком, с уверенностью по словам", () => {
    const setup = sessionWith();
    setup.begin();
    setup.soniox().receive({
      tokens: [
        { text: "При", is_final: true, confidence: 0.99 },
        { text: "вет", is_final: true, confidence: 0.8 },
        { text: " как", is_final: false, confidence: 0.7 },
        { text: " дела", is_final: false, confidence: 0.6 },
      ],
    });
    expect(setup.of("heard")).toEqual([
      { type: "heard", settled: [{ text: "Привет", confidence: 0.8 }], interim: [{ text: "как", confidence: 0.7 }, { text: "дела", confidence: 0.6 }] },
    ]);
    setup.soniox().receive(sonioxWords(["как"], { final: true, confidence: 0.9 }));
    expect(setup.of("heard")[1]).toEqual({ type: "heard", settled: [{ text: "как", confidence: 0.9 }], interim: [] });
  });

  it("сообщение Soniox без слов (только служебные метки) не порождает heard", () => {
    const setup = sessionWith();
    setup.begin();
    setup.soniox().receive({ tokens: [] });
    setup.soniox().receive({ tokens: [{ text: "<fin>", is_final: true }] });
    expect(setup.of("heard")).toHaveLength(0);
  });

  it("конец фразы: phrase_end с текстом закреплённых слов и меткой времени сервера", () => {
    vi.setSystemTime(1_700_000_000_000);
    const setup = sessionWith();
    setup.begin();
    setup.soniox().receive(sonioxWords(["привет", "мир"], { final: true, end: true }));
    expect(setup.of("phrase_end")).toEqual([{ type: "phrase_end", text: "привет мир", serverTimeMs: 1_700_000_000_000 }]);
  });

  it("фраза, закреплённая по частям в разных ответах, склеивается; слова идут до phrase_end", () => {
    const setup = sessionWith();
    setup.begin();
    setup.soniox().receive(sonioxWords(["привет"], { final: true }));
    setup.soniox().receive({ tokens: [{ text: " мир", is_final: true }, { text: "<end>", is_final: true }] });
    expect(setup.of("phrase_end").map((message) => message.text)).toEqual(["привет мир"]);
    expect(setup.sent.map((message) => message.type)).toEqual(["ready", "heard", "heard", "phrase_end"]);
  });

  it("пустая фраза не выдаётся", () => {
    const setup = sessionWith();
    setup.begin();
    setup.soniox().receive({ tokens: [{ text: "<end>", is_final: true }] });
    setup.soniox().receive({ tokens: [{ text: "<end>", is_final: true }] });
    expect(setup.of("phrase_end")).toHaveLength(0);
  });

  it("две фразы в одном ответе — два phrase_end по порядку", () => {
    const setup = sessionWith();
    setup.begin();
    setup.soniox().receive({
      tokens: [
        { text: "Раз", is_final: true },
        { text: "<end>", is_final: true },
        { text: "Два", is_final: true },
        { text: "<end>", is_final: true },
      ],
    });
    expect(setup.of("phrase_end").map((message) => message.text)).toEqual(["Раз", "Два"]);
  });
});

describe("сессия диалога: объём звука с микрофона", () => {
  /** 100 мс звука: 16 кГц × 2 байта. */
  const chunk = () => new Uint8Array(3200);

  it("звук в реальном времени идёт сколько угодно долго: окно скользит", () => {
    const setup = sessionWith();
    setup.begin();
    for (let step = 0; step < 1200; step += 1) {
      setup.session.receiveAudio(chunk());
      vi.advanceTimersByTime(100);
    }
    expect(setup.closes).toEqual([]);
    expect(setup.soniox().audio).toHaveLength(1200);
  });

  it("звука больше, чем реальное время с запасом: соединение закрывается кодом 4413, клиент получает error(invalid), Soniox закрыт", () => {
    const setup = sessionWith();
    setup.begin();
    // Минута звука за один момент — в десятки раз быстрее микрофона.
    for (let step = 0; step < 600; step += 1) setup.session.receiveAudio(chunk());
    expect(setup.closes).toEqual([4413]);
    expect(setup.of("error")).toEqual([{ type: "error", kind: "invalid" }]);
    expect(setup.soniox().closed).toBe(true);
    // Лишнее в Soniox не ушло: не больше запаса на окно.
    expect(setup.soniox().audio.length).toBeLessThanOrEqual(150);
    expect(setup.soniox().audio.length).toBeGreaterThanOrEqual(100);
  });

  it("после закрытия звук больше не принимается", () => {
    const setup = sessionWith();
    setup.begin();
    for (let step = 0; step < 600; step += 1) setup.session.receiveAudio(chunk());
    const sent = setup.soniox().audio.length;
    setup.session.receiveAudio(chunk());
    expect(setup.soniox().audio).toHaveLength(sent);
    expect(setup.closes).toEqual([4413]);
  });
});

describe("сессия диалога: простой и предел времени", () => {
  it("нет слов дольше idleSeconds: за 15 секунд — предупреждение, затем закрытие 4408", () => {
    const setup = sessionWith({ idleSeconds: 60 });
    setup.begin();
    vi.advanceTimersByTime(44_999);
    expect(setup.of("idle_warning")).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(setup.of("idle_warning")).toEqual([{ type: "idle_warning", secondsLeft: 15 }]);
    expect(setup.closes).toEqual([]);
    vi.advanceTimersByTime(14_999);
    expect(setup.closes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(setup.closes).toEqual([4408]);
    expect(setup.soniox().closed).toBe(true);
  });

  it("слова сбрасывают простой", () => {
    const setup = sessionWith({ idleSeconds: 60 });
    setup.begin();
    vi.advanceTimersByTime(40_000);
    setup.soniox().receive(sonioxWords(["привет"]));
    vi.advanceTimersByTime(40_000);
    expect(setup.of("idle_warning")).toHaveLength(0);
    vi.advanceTimersByTime(5_000);
    expect(setup.of("idle_warning")).toHaveLength(1);
  });

  it("после предупреждения слова отменяют закрытие; следующее предупреждение придёт снова", () => {
    const setup = sessionWith({ idleSeconds: 60 });
    setup.begin();
    vi.advanceTimersByTime(50_000);
    setup.soniox().receive(sonioxWords(["я", "здесь"]));
    vi.advanceTimersByTime(20_000);
    expect(setup.closes).toEqual([]);
    vi.advanceTimersByTime(30_000);
    expect(setup.of("idle_warning")).toHaveLength(2);
  });

  it("ответ агента (prepare, speak) — не простой: пока агент говорит, сессия не закрывается", async () => {
    const setup = sessionWith({ idleSeconds: 60 });
    setup.begin();
    vi.advanceTimersByTime(40_000);
    await setup.command({ type: "prepare", replyId: 1 });
    vi.advanceTimersByTime(40_000);
    expect(setup.of("idle_warning")).toHaveLength(0);
  });

  it("ping простой не сбрасывает", async () => {
    const setup = sessionWith({ idleSeconds: 60 });
    setup.begin();
    vi.advanceTimersByTime(40_000);
    await setup.command({ type: "ping" });
    vi.advanceTimersByTime(20_000);
    expect(setup.closes).toEqual([4408]);
  });

  it("предел длительности: по истечении maxSessionSeconds — закрытие 4408", () => {
    const setup = sessionWith({ maxSessionSeconds: 600, idleSeconds: 100_000 });
    setup.begin();
    vi.advanceTimersByTime(599_000);
    expect(setup.closes).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(setup.closes).toEqual([4408]);
    expect(setup.soniox().closed).toBe(true);
  });

  it("после закрытия таймеры не остаются: ни предупреждений, ни повторных закрытий", () => {
    const setup = sessionWith({ idleSeconds: 60 });
    setup.begin();
    setup.session.close();
    vi.advanceTimersByTime(600_000);
    expect(setup.of("idle_warning")).toHaveLength(0);
    expect(setup.closes).toEqual([]);
    expect(setup.soniox().closed).toBe(true);
  });
});

describe("сессия диалога: сбои распознавания", () => {
  it("Soniox оборвался — error recognition_lost и закрытие 4502", () => {
    const setup = sessionWith();
    setup.begin();
    setup.soniox().drop(1006);
    expect(setup.of("error")).toEqual([{ type: "error", kind: "recognition_lost" }]);
    expect(setup.closes).toEqual([4502]);
  });

  it("Soniox не открылся — service_unavailable и закрытие 4502", () => {
    const setup = sessionWith();
    setup.session.start(START);
    setup.soniox().fail();
    expect(setup.of("error")).toEqual([{ type: "error", kind: "service_unavailable" }]);
    expect(setup.closes).toEqual([4502]);
  });

  it("Soniox прислал ошибку — recognition_lost; текст ошибки и ключ клиенту не уходят", () => {
    const setup = sessionWith();
    setup.begin();
    setup.soniox().receive({ error_code: 401, error_message: `bad key ${SONIOX_KEY}` });
    expect(setup.of("error")).toEqual([{ type: "error", kind: "recognition_lost" }]);
    expect(setup.closes).toEqual([4502]);
    expect(JSON.stringify(setup.sent)).not.toContain(SONIOX_KEY);
    for (const line of setup.logged) expect(line).not.toContain(SONIOX_KEY);
  });

  it("закрытие клиентом закрывает Soniox и ничего не шлёт обратно", () => {
    const setup = sessionWith();
    setup.begin();
    setup.session.close();
    expect(setup.soniox().closed).toBe(true);
    expect(setup.closes).toEqual([]);
    expect(setup.of("error")).toEqual([]);
  });
});
