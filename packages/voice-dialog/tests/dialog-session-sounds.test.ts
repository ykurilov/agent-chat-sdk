import { SpendingLimitReachedError } from "@ykurilov/agent-chat-core";
import type { SpendingLimits } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ELEVEN_KEY, listenFor, scribeFake, scribeSounds, sessionWith, sonioxWords } from "./support/session-harness";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const flush = () => vi.advanceTimersByTimeAsync(0);

/** Сессия со звуками: Scribe подменён, окно ожидания — 400 мс. */
function withSounds(options: Partial<NonNullable<Parameters<typeof sessionWith>[0]>["sounds"]> = {}) {
  const scribe = scribeFake();
  const setup = sessionWith({ sounds: { fetch: scribe.fetch, ...options } });
  setup.begin();
  return { ...setup, scribe };
}
type Setup = ReturnType<typeof withSounds>;

/** Soniox закрепил слова и поставил конец фразы. */
const phrase = (setup: Setup, ...words: string[]) => setup.soniox().receive(sonioxWords(words, { final: true, end: true }));

describe("звуки человека: ожидание Scribe на конце фразы (FR-027)", () => {
  it("Scribe ответил до порога: phrase_end уходит сразу после ответа и несёт звуки; agoMs — от начала звука до отправки", async () => {
    vi.setSystemTime(1_700_000_000_000);
    const setup = withSounds();
    await listenFor(setup, 2);
    vi.setSystemTime(1_700_000_002_000);

    phrase(setup, "Ха", "смешно");
    await flush();
    expect(setup.of("phrase_end")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(150);
    setup.scribe.calls[0]!.reply(scribeSounds(["(laughter)", 1.0, 1.5]));
    await flush();

    expect(setup.of("phrase_end")).toEqual([
      { type: "phrase_end", text: "Ха смешно", serverTimeMs: 1_700_000_002_000, sounds: [{ kind: "laughter", agoMs: 1150 }] },
    ]);
  });

  it("Scribe ответил без звуков: phrase_end без поля sounds, сразу после ответа", async () => {
    const setup = withSounds();
    await listenFor(setup, 1);
    phrase(setup, "Привет");
    await flush();

    setup.scribe.calls[0]!.reply(scribeSounds());
    await flush();

    expect(setup.of("phrase_end")).toHaveLength(1);
    expect(setup.of("phrase_end")[0]).not.toHaveProperty("sounds");
  });

  it("запрос к Scribe: ключ, модель, язык; звука ровно столько, сколько пришло с микрофона", async () => {
    const setup = withSounds();
    await listenFor(setup, 3);
    phrase(setup, "Привет");
    await flush();

    const form = setup.scribe.calls[0]!.form;
    expect(setup.scribe.fetch).toHaveBeenCalledWith("https://scribe.test/v1/speech-to-text", expect.objectContaining({ method: "POST" }));
    expect((setup.scribe.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]![1].headers).toMatchObject({ "xi-api-key": ELEVEN_KEY });
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("tag_audio_events")).toBe("true");
    expect(form.get("language_code")).toBe("ru");
    expect(setup.scribe.calls[0]!.bytes).toBe(96_000);
  });

  it("Scribe не успел за waitMs: phrase_end уходит без звуков, а запоздавший ответ — отдельным сообщением sounds с поправкой на опоздание", async () => {
    const setup = withSounds({ waitMs: 400 });
    await listenFor(setup, 2);
    phrase(setup, "Привет");
    await flush();

    await vi.advanceTimersByTimeAsync(399);
    expect(setup.of("phrase_end")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(setup.of("phrase_end")).toHaveLength(1);
    expect(setup.of("phrase_end")[0]).not.toHaveProperty("sounds");

    await vi.advanceTimersByTimeAsync(300);
    setup.scribe.calls[0]!.reply(scribeSounds(["(sigh)", 0.5, 1.0]));
    await flush();

    expect(setup.of("sounds")).toEqual([{ type: "sounds", sounds: [{ kind: "sigh", agoMs: 1500 + 700 }] }]);
    expect(setup.of("phrase_end")).toHaveLength(1);
  });

  it("запоздавший ответ без звуков ничего не шлёт", async () => {
    const setup = withSounds({ waitMs: 400 });
    await listenFor(setup, 1);
    phrase(setup, "Привет");
    await vi.advanceTimersByTimeAsync(500);

    setup.scribe.calls[0]!.reply(scribeSounds(["(footsteps)", 0, 1]));
    await flush();

    expect(setup.of("sounds")).toHaveLength(0);
  });

  it("порог waitMs берётся из настройки", async () => {
    const setup = withSounds({ waitMs: 1000 });
    await listenFor(setup, 1);
    phrase(setup, "Привет");
    await vi.advanceTimersByTimeAsync(999);
    expect(setup.of("phrase_end")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(setup.of("phrase_end")).toHaveLength(1);
  });

  it("звуки выключены (sounds: null): phrase_end сразу, Scribe не зовётся, всё как раньше", async () => {
    const scribe = scribeFake();
    const setup = sessionWith();
    setup.begin();
    await listenFor(setup, 1);

    setup.soniox().receive(sonioxWords(["Привет"], { final: true, end: true }));

    expect(setup.of("phrase_end")).toHaveLength(1);
    expect(setup.of("phrase_end")[0]).not.toHaveProperty("sounds");
    expect(scribe.calls).toHaveLength(0);
  });
});

describe("звуки человека: окно звука", () => {
  it("фраза без слов (один смех) хода не даёт и в Scribe не идёт; звук остаётся в окне и уходит со следующей фразой", async () => {
    const setup = withSounds();
    await listenFor(setup, 3);
    await flush();
    expect(setup.scribe.calls).toHaveLength(0);
    expect(setup.of("phrase_end")).toHaveLength(0);

    await listenFor(setup, 2);
    phrase(setup, "Привет");
    await flush();

    expect(setup.scribe.calls).toHaveLength(1);
    expect(setup.scribe.calls[0]!.bytes).toBe(5 * 32_000);
  });

  it("каждое окно начинается там, где кончилось прежнее: вторая фраза уходит только со своим звуком", async () => {
    const setup = withSounds();
    await listenFor(setup, 2);
    phrase(setup, "Раз");
    await flush();
    setup.scribe.calls[0]!.reply(scribeSounds());
    await listenFor(setup, 3);
    phrase(setup, "Два");
    await flush();

    expect(setup.scribe.calls.map((call) => call.bytes)).toEqual([2 * 32_000, 3 * 32_000]);
  });

  it("окно не длиннее maxWindowSeconds: старый звук отбрасывается, а agoMs считается от конца окна", async () => {
    const setup = withSounds({ maxWindowSeconds: 4 });
    await listenFor(setup, 6);
    phrase(setup, "Привет");
    await flush();

    expect(setup.scribe.calls[0]!.bytes).toBe(4 * 32_000);
    setup.scribe.calls[0]!.reply(scribeSounds(["(laughter)", 3.0, 3.5]));
    await flush();
    expect(setup.of("phrase_end")[0]).toMatchObject({ sounds: [{ kind: "laughter", agoMs: 1000 }] });
  });

  it("обрезка окна всегда по границе отсчёта: куски нечётной длины не сдвигают начало окна на полотсчёта", async () => {
    const setup = withSounds({ maxWindowSeconds: 1 });
    // Поток: чётные байты — 1, нечётные — 2; куски по 20 001 байт, так что границы кусков не совпадают с границами отсчётов.
    let offset = 0;
    for (let index = 0; index < 3; index++) {
      const chunk = new Uint8Array(20_001).map((_, at) => ((offset + at) % 2 === 0 ? 1 : 2));
      offset += chunk.length;
      setup.session.receiveAudio(chunk);
    }
    await vi.advanceTimersByTimeAsync(2000);
    phrase(setup, "Привет");
    await flush();

    const sent = new Uint8Array(await (setup.scribe.calls[0]!.form.get("file") as File).arrayBuffer()).subarray(44);
    expect(sent.length).toBeLessThanOrEqual(32_000);
    expect(sent[0]).toBe(1);
  });

  it("две фразы в одном ответе Soniox: окно у первой, вторая без звука не зовёт Scribe; порядок phrase_end сохраняется", async () => {
    const setup = withSounds();
    await listenFor(setup, 2);

    setup.soniox().receive({
      tokens: [
        { text: "Раз", is_final: true },
        { text: "<end>", is_final: true },
        { text: "Два", is_final: true },
        { text: "<end>", is_final: true },
      ],
    });
    await flush();
    expect(setup.scribe.calls).toHaveLength(1);
    setup.scribe.calls[0]!.reply(scribeSounds(["(laughter)", 1, 1.5]));
    await flush();

    expect(setup.of("phrase_end").map((message) => message.text)).toEqual(["Раз", "Два"]);
    expect(setup.of("phrase_end")[0]).toHaveProperty("sounds");
  });

  it("фразы уходят по порядку, даже если Scribe второй ответил раньше первого", async () => {
    // Порог длиннее, чем идёт звук между фразами: иначе первая уйдёт по порогу, а не по ответу.
    const setup = withSounds({ waitMs: 5000 });
    await listenFor(setup, 2);
    phrase(setup, "Раз");
    await flush();
    await listenFor(setup, 1);
    phrase(setup, "Два");
    await flush();
    expect(setup.scribe.calls).toHaveLength(2);

    setup.scribe.calls[1]!.reply(scribeSounds(["(sigh)", 0.2, 0.6]));
    await flush();
    expect(setup.of("phrase_end")).toHaveLength(0);
    setup.scribe.calls[0]!.reply(scribeSounds());
    await flush();

    expect(setup.of("phrase_end").map((message) => message.text)).toEqual(["Раз", "Два"]);
    expect(setup.of("phrase_end")[1]).toMatchObject({ sounds: [{ kind: "sigh" }] });
  });

  it("не больше двух запросов одновременно: третья фраза идёт без Scribe, её звук остаётся в окне для следующей", async () => {
    const setup = withSounds({ waitMs: 100 });
    for (const word of ["Раз", "Два", "Три"]) {
      await listenFor(setup, 1);
      phrase(setup, word);
      await flush();
    }
    expect(setup.scribe.calls).toHaveLength(2);
    expect(setup.of("phrase_end").map((message) => message.text)).toEqual(["Раз", "Два", "Три"]);

    setup.scribe.calls[0]!.reply(scribeSounds());
    setup.scribe.calls[1]!.reply(scribeSounds());
    await flush();
    await listenFor(setup, 1);
    phrase(setup, "Четыре");
    await flush();

    expect(setup.scribe.calls).toHaveLength(3);
    expect(setup.scribe.calls[2]!.bytes).toBe(2 * 32_000);
  });
});

describe("звуки человека: смех на границе двух окон (FR-027)", () => {
  /** Две фразы по 3 секунды, у обеих запрос к Scribe в полёте. */
  async function twoPhrases(setup: Setup) {
    await listenFor(setup, 3);
    phrase(setup, "Раз");
    await flush();
    await listenFor(setup, 3);
    phrase(setup, "Два");
    await flush();
  }

  it("один смех, разрезанный границей окон, — один: у второй фразы он не повторяется", async () => {
    const setup = withSounds({ waitMs: 4500, timeoutMs: 20_000 });
    await twoPhrases(setup);

    setup.scribe.calls[0]!.reply(scribeSounds(["(laughter)", 2.0, 3.0]));
    setup.scribe.calls[1]!.reply(scribeSounds(["(laughter)", 0.0, 0.8]));
    await flush();

    const ends = setup.of("phrase_end");
    expect(ends).toHaveLength(2);
    expect(ends[0]).toMatchObject({ sounds: [{ kind: "laughter" }] });
    expect(ends[1]).not.toHaveProperty("sounds");
  });

  it("ответ на вторую фразу пришёл раньше первого: смех всё равно один, второе сообщение со звуками не уходит", async () => {
    const setup = withSounds({ waitMs: 4500, timeoutMs: 20_000 });
    await twoPhrases(setup);

    setup.scribe.calls[1]!.reply(scribeSounds(["(laughter)", 0.0, 0.8]));
    await flush();
    setup.scribe.calls[0]!.reply(scribeSounds(["(laughter)", 2.0, 3.0]));
    await flush();
    await vi.advanceTimersByTimeAsync(1000);

    const heard = [...setup.of("phrase_end"), ...setup.of("sounds")].flatMap((message) => (message as { sounds?: unknown[] }).sounds ?? []);
    expect(heard).toHaveLength(1);
  });

  it("смех второй фразы не на границе — отдельный смех, он остаётся", async () => {
    const setup = withSounds({ waitMs: 4500, timeoutMs: 20_000 });
    await twoPhrases(setup);

    setup.scribe.calls[0]!.reply(scribeSounds(["(laughter)", 2.0, 3.0]));
    setup.scribe.calls[1]!.reply(scribeSounds(["(laughter)", 1.5, 2.0]));
    await flush();

    expect(setup.of("phrase_end")[1]).toMatchObject({ sounds: [{ kind: "laughter" }] });
  });

  it("другой вид звука на границе не схлопывается: смех в конце первой, вздох в начале второй — оба остаются", async () => {
    const setup = withSounds({ waitMs: 4500, timeoutMs: 20_000 });
    await twoPhrases(setup);

    setup.scribe.calls[0]!.reply(scribeSounds(["(laughter)", 2.0, 3.0]));
    setup.scribe.calls[1]!.reply(scribeSounds(["(sigh)", 0.0, 0.5]));
    await flush();

    expect(setup.of("phrase_end")[1]).toMatchObject({ sounds: [{ kind: "sigh" }] });
  });
});

describe("звуки человека: сбои Scribe не ломают разговор (FR-027)", () => {
  it.each([
    ["ответ 500", (call: Setup["scribe"]["calls"][number]) => call.fail(500)],
    ["ответ 401", (call: Setup["scribe"]["calls"][number]) => call.fail(401)],
    ["сеть упала", (call: Setup["scribe"]["calls"][number]) => call.crash()],
  ])("%s: phrase_end уходит сразу без звуков, в журнале предупреждение без ключа, соединение живо", async (_name, break_) => {
    const setup = withSounds();
    await listenFor(setup, 1);
    phrase(setup, "Привет");
    await flush();

    break_(setup.scribe.calls[0]!);
    await flush();

    expect(setup.of("phrase_end")).toHaveLength(1);
    expect(setup.of("phrase_end")[0]).not.toHaveProperty("sounds");
    expect(setup.logged.join("\n")).toMatch(/Scribe/);
    expect(setup.logged.join("\n")).not.toContain(ELEVEN_KEY);
    expect(setup.closes).toEqual([]);
    expect(setup.of("error")).toEqual([]);

    await listenFor(setup, 1);
    phrase(setup, "Ещё");
    await flush();
    expect(setup.scribe.calls).toHaveLength(2);
  });

  it("Scribe молчит дольше timeoutMs: phrase_end ушёл по порогу, запрос оборван, предупреждение в журнале; расход записан: звук ушёл, ElevenLabs мог списать", async () => {
    const setup = withSounds({ waitMs: 400, timeoutMs: 3000, pricePerHour: 3.6 });
    await listenFor(setup, 2);
    phrase(setup, "Привет");
    await vi.advanceTimersByTimeAsync(400);
    expect(setup.of("phrase_end")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(3000);

    expect(setup.scribe.calls[0]!.signal?.aborted).toBe(true);
    expect(setup.logged.join("\n")).toMatch(/Scribe/);
    expect(setup.of("sounds")).toHaveLength(0);
    const [sum] = await setup.storage.sumUsage({ ownerId: "anna" });
    expect(sum).toMatchObject({ inputTokens: 2 });
    expect(sum?.costUsd).toBeCloseTo(0.002, 6);
  });

  it("запрос отменён закрытием сессии после отправки: расход записан по отправленным секундам", async () => {
    const setup = withSounds({ pricePerHour: 3.6 });
    await listenFor(setup, 3);
    phrase(setup, "Привет");
    await flush();

    setup.session.close();
    await flush();

    const [sum] = await setup.storage.sumUsage({ ownerId: "anna" });
    expect(sum).toMatchObject({ inputTokens: 3 });
  });

  it("запрос не ушёл (лимит исчерпан): расхода нет, даже если потом всё оборвалось", async () => {
    const exhausted: SpendingLimits = {
      assertWithinLimit: async () => {
        throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
      },
      status: async () => ({ state: "exhausted" }),
    };
    const scribe = scribeFake();
    const setup = sessionWith({ sounds: { fetch: scribe.fetch, spendingLimits: exhausted } });
    setup.begin();
    await listenFor(setup, 2);
    phrase(setup as never, "Привет");
    await flush();
    setup.session.close();
    await flush();

    expect(await setup.storage.sumUsage({ ownerId: "anna" })).toEqual([]);
  });

  it("сбой Scribe пишется в журнал один раз, а не на каждую фразу; после успешного ответа новый сбой снова виден один раз", async () => {
    const setup = withSounds();
    const scribeWarnings = () => setup.logged.filter((line) => /Scribe не ответил/.test(line)).length;
    const failPhrase = async (word: string) => {
      await listenFor(setup, 1);
      phrase(setup, word);
      await flush();
      setup.scribe.calls.at(-1)!.fail(500);
      await flush();
    };

    await failPhrase("Раз");
    await failPhrase("Два");
    await failPhrase("Три");
    expect(scribeWarnings()).toBe(1);

    await listenFor(setup, 1);
    phrase(setup, "Четыре");
    await flush();
    setup.scribe.calls.at(-1)!.reply(scribeSounds());
    await flush();
    expect(scribeWarnings()).toBe(1);

    await failPhrase("Пять");
    await failPhrase("Шесть");
    expect(scribeWarnings()).toBe(2);
  });

  it("предел расходов исчерпан: Scribe не зовётся, фраза идёт без звуков, ошибки нет", async () => {
    const exhausted: SpendingLimits = {
      assertWithinLimit: async () => {
        throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
      },
      status: async () => ({ state: "exhausted" }),
    };
    const scribe = scribeFake();
    const setup = sessionWith({ sounds: { fetch: scribe.fetch, spendingLimits: exhausted } });
    setup.begin();
    await listenFor(setup, 1);

    phrase(setup as never, "Привет");
    await flush();

    expect(scribe.calls).toHaveLength(0);
    expect(setup.of("phrase_end")).toHaveLength(1);
    expect(setup.of("phrase_end")[0]).not.toHaveProperty("sounds");
  });

  it("сбой проверки лимита не оставляет запрос «висеть»: после двух сбоев подряд Scribe всё равно зовётся", async () => {
    let broken = true;
    const flaky: SpendingLimits = {
      assertWithinLimit: async () => {
        if (broken) throw new Error("база недоступна");
      },
      status: async () => ({ state: "ok" }),
    } as unknown as SpendingLimits;
    const scribe = scribeFake();
    const setup = sessionWith({ sounds: { fetch: scribe.fetch, spendingLimits: flaky } });
    setup.begin();
    for (const word of ["Раз", "Два", "Три"]) {
      await listenFor(setup, 1);
      phrase(setup as never, word);
      await flush();
    }
    expect(scribe.calls).toHaveLength(0);
    expect(setup.of("phrase_end")).toHaveLength(3);

    broken = false;
    await listenFor(setup, 1);
    phrase(setup as never, "Четыре");
    await flush();

    expect(scribe.calls).toHaveLength(1);
  });

  it("сессия закрыта: запросы к Scribe отменены, после закрытия ничего не уходит", async () => {
    const setup = withSounds();
    await listenFor(setup, 1);
    phrase(setup, "Привет");
    await flush();

    setup.session.close();
    await flush();
    setup.scribe.calls[0]!.reply(scribeSounds(["(laughter)", 0, 1]));
    await vi.advanceTimersByTimeAsync(1000);

    expect(setup.scribe.calls[0]!.signal?.aborted).toBe(true);
    expect(setup.of("phrase_end")).toHaveLength(0);
    expect(setup.of("sounds")).toHaveLength(0);
  });
});

describe("звуки человека: расход Scribe (FR-027)", () => {
  it("запрос записывается расходом source: sounds на длину окна: секунды × цена за час / 3600", async () => {
    const setup = withSounds({ pricePerHour: 0.36 });
    await listenFor(setup, 10);
    phrase(setup, "Привет");
    await flush();

    setup.scribe.calls[0]!.reply(scribeSounds());
    await flush();

    const [sum] = await setup.storage.sumUsage({ ownerId: "anna" });
    expect(sum).toMatchObject({ modelId: "scribe_v2", providerId: "elevenlabs", inputTokens: 10 });
    expect(sum?.costUsd).toBeCloseTo(0.001, 6);
  });

  it("запоздавший ответ тоже записывается; ошибка запроса — нет", async () => {
    const setup = withSounds({ pricePerHour: 3.6 });
    await listenFor(setup, 5);
    phrase(setup, "Раз");
    await vi.advanceTimersByTimeAsync(500);
    setup.scribe.calls[0]!.reply(scribeSounds());
    await flush();
    await listenFor(setup, 5);
    phrase(setup, "Два");
    await flush();
    setup.scribe.calls[1]!.fail(500);
    await flush();

    const [sum] = await setup.storage.sumUsage({ ownerId: "anna" });
    expect(sum?.costUsd).toBeCloseTo(0.005, 6);
  });

  it("когда Scribe не зовётся (нет слов, выключено), расхода нет", async () => {
    const setup = withSounds();
    await listenFor(setup, 5);
    await flush();
    expect(await setup.storage.sumUsage({ ownerId: "anna" })).toEqual([]);
  });
});
