import { SpendingLimitReachedError } from "@ykurilov/agent-chat-core";
import type { SpendingLimits } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scribeFake, scribeSounds, sessionWith, sonioxWords } from "./support/session-harness";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const flush = () => vi.advanceTimersByTimeAsync(0);
const BPS = 32_000;
const LOUD = 3000;

/** Сессия с кусками: 1,5 с нового звука, перекрытие 0,5 с, тишина — RMS ниже 0,01; ответ на конце фразы ждём 400 мс. */
function withChunks(options: Partial<NonNullable<Parameters<typeof sessionWith>[0]>["sounds"]> = {}) {
  const scribe = scribeFake();
  const setup = sessionWith({ sounds: { fetch: scribe.fetch, chunkSeconds: 1.5, overlapSeconds: 0.5, silenceRms: 0.01, ...options } });
  setup.begin();
  return { ...setup, scribe };
}
type Setup = ReturnType<typeof withChunks>;

/** Человек говорит `seconds` секунд: кадры по `stepMs`, в кадре все отсчёты равны `value(номер кадра)`. Время идёт как в жизни. */
async function speak(setup: Pick<Setup, "session">, seconds: number, value: number | ((step: number) => number) = LOUD, stepMs = 500) {
  const steps = Math.round((seconds * 1000) / stepMs);
  for (let step = 0; step < steps; step++) {
    const level = typeof value === "number" ? value : value(step);
    setup.session.receiveAudio(new Uint8Array(new Int16Array((stepMs / 1000) * 16_000).fill(level).buffer));
    await vi.advanceTimersByTimeAsync(stepMs);
  }
}

/** Отсчёты звука, ушедшего в запрос. */
async function samplesOf(call: Setup["scribe"]["calls"][number]): Promise<Int16Array> {
  const wav = new Uint8Array(await (call.form.get("file") as File).arrayBuffer()).slice(44);
  return new Int16Array(wav.buffer);
}

const phrase = (setup: Pick<Setup, "soniox">, ...words: string[]) => setup.soniox().receive(sonioxWords(words, { final: true, end: true }));
const heardIn = (message: unknown) => ((message as { sounds?: Array<{ kind: string }> }).sounds ?? []).map((sound) => sound.kind);

describe("звуки человека: куски во время фразы", () => {
  it("пока человек говорит, каждые 1,5 с нового звука уходит кусок: первый — 1,5 с, следующие — 0,5 с перекрытия + 1,5 с нового", async () => {
    const setup = withChunks();
    await speak(setup, 3.5);

    expect(setup.scribe.calls.map((call) => call.bytes)).toEqual([1.5 * BPS, 2 * BPS]);
  });

  it("перекрытие — настоящее: второй кусок начинается с последних 0,5 с первого", async () => {
    const setup = withChunks();
    await speak(setup, 3, (step) => (step + 1) * 1000);

    const first = await samplesOf(setup.scribe.calls[0]!);
    const second = await samplesOf(setup.scribe.calls[1]!);
    expect(first[0]).toBe(1000);
    expect(first.at(-1)).toBe(3000);
    expect(second[0]).toBe(3000);
    expect(second.at(-1)).toBe(6000);
  });

  it("на конце фразы уходит только хвост: новое после последнего куска плюс перекрытие", async () => {
    const setup = withChunks();
    await speak(setup, 4);
    expect(setup.scribe.calls).toHaveLength(2);
    for (const call of setup.scribe.calls) call.reply(scribeSounds());
    await flush();

    phrase(setup, "Привет");
    await flush();

    expect(setup.scribe.calls).toHaveLength(3);
    expect(setup.scribe.calls[2]!.bytes).toBe(1.5 * BPS);
  });

  it("слишком короткий хвост (меньше 0,3 с нового) не отправляется", async () => {
    const setup = withChunks();
    await speak(setup, 3.2, LOUD, 100);
    expect(setup.scribe.calls).toHaveLength(2);

    phrase(setup, "Привет");
    await flush();

    expect(setup.scribe.calls).toHaveLength(2);
  });

  it("звуки фразы — объединение ответов всех её кусков и хвоста", async () => {
    const setup = withChunks({ waitMs: 400 });
    await speak(setup, 4);
    setup.scribe.calls[0]!.reply(scribeSounds(["(laughter)", 0.2, 0.8]));
    setup.scribe.calls[1]!.reply(scribeSounds(["(sigh)", 1.0, 1.4]));
    await flush();

    phrase(setup, "Привет");
    await flush();
    setup.scribe.calls[2]!.reply(scribeSounds(["(cough)", 0.7, 0.9]));
    await flush();

    const ends = setup.of("phrase_end");
    expect(ends).toHaveLength(1);
    expect(heardIn(ends[0]).sort()).toEqual(["cough", "laughter", "sigh"]);
  });

  it("смех на перекрытии, найденный в двух кусках, — один (по виду и времени)", async () => {
    const setup = withChunks();
    await speak(setup, 3);
    // первый кусок: смех 1,1–1,5 с от начала; второй кусок начинается в 1,0 с: тот же смех там — 0,1–0,5 с
    setup.scribe.calls[0]!.reply(scribeSounds(["(laughter)", 1.1, 1.5]));
    setup.scribe.calls[1]!.reply(scribeSounds(["(laughter)", 0.1, 0.5]));
    await flush();

    phrase(setup, "Ха");
    await flush();

    expect(heardIn(setup.of("phrase_end")[0])).toEqual(["laughter"]);
  });

  it("два разных смеха (между ними больше полусекунды) остаются двумя", async () => {
    const setup = withChunks();
    await speak(setup, 3);
    setup.scribe.calls[0]!.reply(scribeSounds(["(laughter)", 0.1, 0.4]));
    setup.scribe.calls[1]!.reply(scribeSounds(["(laughter)", 1.5, 1.9]));
    await flush();

    phrase(setup, "Ха");
    await flush();

    expect(heardIn(setup.of("phrase_end")[0])).toEqual(["laughter", "laughter"]);
  });

  it("смех без слов: куски ушли и ответили, фразы нет — хода нет; звук уходит со следующей фразой", async () => {
    const setup = withChunks();
    await speak(setup, 3);
    setup.scribe.calls[0]!.reply(scribeSounds(["(laughter)", 0.2, 0.9]));
    setup.scribe.calls[1]!.reply(scribeSounds());
    await flush();
    expect(setup.of("phrase_end")).toHaveLength(0);
    expect(setup.of("sounds")).toHaveLength(0);

    await speak(setup, 2, 0);
    phrase(setup, "Ну");
    await flush();

    expect(setup.of("phrase_end")).toHaveLength(1);
    expect(heardIn(setup.of("phrase_end")[0])).toEqual(["laughter"]);
  });
});

describe("звуки человека: тишина не отправляется", () => {
  it("тишина не уходит в Scribe: ни кусков, ни хвоста; фраза уходит сразу, без ожидания", async () => {
    const setup = withChunks();
    await speak(setup, 5, 0);
    phrase(setup, "Привет");
    await flush();

    expect(setup.scribe.calls).toHaveLength(0);
    expect(setup.of("phrase_end")).toHaveLength(1);
  });

  it("уходят только громкие куски: говорил 1,5 с, потом 3 с тишины — один запрос", async () => {
    const setup = withChunks();
    await speak(setup, 1.5);
    await speak(setup, 3, 0);

    expect(setup.scribe.calls).toHaveLength(1);
  });

  it("порог тишины — настройка", async () => {
    const quiet = 500;
    const strict = withChunks({ silenceRms: 0.02 });
    await speak(strict, 1.5, quiet);
    expect(strict.scribe.calls).toHaveLength(0);

    const lenient = withChunks({ silenceRms: 0.001 });
    await speak(lenient, 1.5, quiet);
    expect(lenient.scribe.calls).toHaveLength(1);
  });
});

describe("звуки человека: ожидание на конце фразы — только хвоста и ещё не вернувшихся кусков", () => {
  it("все куски вернулись, хвоста нет — фраза уходит сразу со звуками кусков", async () => {
    const setup = withChunks();
    await speak(setup, 3);
    setup.scribe.calls[0]!.reply(scribeSounds(["(laughter)", 0.2, 0.8]));
    setup.scribe.calls[1]!.reply(scribeSounds());
    await flush();

    phrase(setup, "Ха");
    await flush();

    expect(setup.of("phrase_end")).toHaveLength(1);
    expect(heardIn(setup.of("phrase_end")[0])).toEqual(["laughter"]);
  });

  it("хвост не вернулся за waitMs: фраза уходит со звуками кусков, хвост догоняет сообщением sounds", async () => {
    const setup = withChunks({ waitMs: 400 });
    await speak(setup, 4);
    setup.scribe.calls[0]!.reply(scribeSounds(["(laughter)", 0.2, 0.8]));
    setup.scribe.calls[1]!.reply(scribeSounds());
    await flush();

    phrase(setup, "Привет");
    await vi.advanceTimersByTimeAsync(399);
    expect(setup.of("phrase_end")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(heardIn(setup.of("phrase_end")[0])).toEqual(["laughter"]);

    setup.scribe.calls[2]!.reply(scribeSounds(["(sigh)", 1.0, 1.3]));
    await flush();
    expect(heardIn(setup.of("sounds")[0])).toEqual(["sigh"]);
  });

  it("хвост вернулся в пределах waitMs: звуки в самой фразе, лишних сообщений нет", async () => {
    const setup = withChunks({ waitMs: 400 });
    await speak(setup, 4);
    setup.scribe.calls[0]!.reply(scribeSounds());
    setup.scribe.calls[1]!.reply(scribeSounds());
    await flush();

    phrase(setup, "Привет");
    await vi.advanceTimersByTimeAsync(150);
    setup.scribe.calls[2]!.reply(scribeSounds(["(sigh)", 1.0, 1.3]));
    await flush();

    expect(heardIn(setup.of("phrase_end")[0])).toEqual(["sigh"]);
    expect(setup.of("sounds")).toHaveLength(0);
  });

  it("кусок этой фразы ещё не вернулся к концу фразы — его тоже ждём, в пределах того же waitMs", async () => {
    const setup = withChunks({ waitMs: 400 });
    await speak(setup, 3);
    setup.scribe.calls[0]!.reply(scribeSounds());
    await flush();

    phrase(setup, "Привет");
    await vi.advanceTimersByTimeAsync(100);
    expect(setup.of("phrase_end")).toHaveLength(0);
    setup.scribe.calls[1]!.reply(scribeSounds(["(laughter)", 0.6, 1.0]));
    await flush();

    expect(heardIn(setup.of("phrase_end")[0])).toEqual(["laughter"]);
  });

  it("порядок фраз сохраняется: вторая не обгоняет первую, ждущую свои куски", async () => {
    const setup = withChunks({ waitMs: 400 });
    await speak(setup, 2);
    phrase(setup, "Раз");
    await flush();
    await speak(setup, 0.2, 0, 100);
    phrase(setup, "Два");
    await flush();
    expect(setup.of("phrase_end")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(400);
    expect(setup.of("phrase_end").map((message) => (message as { text: string }).text)).toEqual(["Раз", "Два"]);
  });
});

describe("звуки человека: куски не копятся в очередь при медленном Scribe", () => {
  it("два запроса в полёте — третий кусок пропускается; запросов не больше двух", async () => {
    const setup = withChunks({ timeoutMs: 60_000 });
    await speak(setup, 6);

    expect(setup.scribe.calls).toHaveLength(2);
  });

  it("пропущенный кусок не теряется: когда Scribe освободился, следующий покрывает непройденное плюс перекрытие", async () => {
    const setup = withChunks({ timeoutMs: 60_000 });
    await speak(setup, 4.5, (step) => (step + 1) * 1000);
    expect(setup.scribe.calls).toHaveLength(2);

    setup.scribe.calls[0]!.reply(scribeSounds());
    await flush();
    await speak(setup, 0.5, 10_000);

    expect(setup.scribe.calls).toHaveLength(3);
    const third = await samplesOf(setup.scribe.calls[2]!);
    // второй кусок кончился на 3,0 с: третий — с 2,5 с (отсчёт номер 6) до 5,0 с
    expect(third[0]).toBe(6000);
    expect(third.at(-1)).toBe(10_000);
    expect(third.length).toBe(2.5 * 16_000);
  });

  it("хвост не взят из-за лимита запросов: ждём не вернувшиеся куски в пределах waitMs, новых запросов нет", async () => {
    const setup = withChunks({ timeoutMs: 60_000 });
    await speak(setup, 4.2, LOUD, 100);
    expect(setup.scribe.calls).toHaveLength(2);

    phrase(setup, "Привет");
    await flush();
    expect(setup.of("phrase_end")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(setup.of("phrase_end")).toHaveLength(1);
    expect(setup.scribe.calls).toHaveLength(2);
  });
});

describe("звуки человека: расход по отправленным секундам, включая перекрытия", () => {
  it("каждый кусок записывается расходом на свою длину: 1,5 + 2 + 2 с; секунды в токенах — вверх, цена — по точной длине", async () => {
    const setup = withChunks({ pricePerHour: 3.6 });
    await speak(setup, 4);
    setup.scribe.calls[0]!.reply(scribeSounds());
    setup.scribe.calls[1]!.reply(scribeSounds());
    await flush();
    phrase(setup, "Привет");
    await flush();
    setup.scribe.calls[2]!.reply(scribeSounds());
    await flush();

    // 1,5 + 2,0 + 1,5 = 5 с = 0,005 доллара при $3,6 в час
    const [sum] = await setup.storage.sumUsage({ ownerId: "anna" });
    expect(sum?.costUsd).toBeCloseTo(0.005, 6);
    expect(sum?.inputTokens).toBe(2 + 2 + 2);
  });

  it("тишина денег не стоит: ни запросов, ни расхода", async () => {
    const setup = withChunks();
    await speak(setup, 5, 0);
    phrase(setup, "Привет");
    await flush();
    expect(await setup.storage.sumUsage({ ownerId: "anna" })).toEqual([]);
  });

  it("запрос без ответа, оборванный по таймауту, записан по своим секундам", async () => {
    const setup = withChunks({ pricePerHour: 3.6, timeoutMs: 3000 });
    await speak(setup, 1.5);
    await vi.advanceTimersByTimeAsync(3000);

    const [sum] = await setup.storage.sumUsage({ ownerId: "anna" });
    expect(sum?.costUsd).toBeCloseTo(0.0015, 6);
  });
});

describe("звуки человека: прежнее поведение при кусках", () => {
  it("предел расходов исчерпан: ни кусков, ни хвоста, фраза идёт без звуков", async () => {
    const exhausted: SpendingLimits = {
      assertWithinLimit: async () => {
        throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
      },
      status: async () => ({ state: "exhausted" }),
    };
    const scribe = scribeFake();
    const setup = sessionWith({ sounds: { fetch: scribe.fetch, spendingLimits: exhausted, chunkSeconds: 1.5, silenceRms: 0.01 } });
    setup.begin();
    await speak(setup, 3);
    phrase(setup, "Привет");
    await flush();

    expect(scribe.calls).toHaveLength(0);
    expect(setup.of("phrase_end")).toHaveLength(1);
    expect(setup.of("phrase_end")[0]).not.toHaveProperty("sounds");
  });

  it("сбой куска: фраза и разговор живы, в журнале одно предупреждение, ключа нет", async () => {
    const setup = withChunks();
    await speak(setup, 4.5);
    setup.scribe.calls[0]!.fail(500);
    setup.scribe.calls[1]!.crash();
    await flush();

    phrase(setup, "Привет");
    await flush();
    setup.scribe.calls.at(-1)!.fail(500);
    await flush();

    expect(setup.of("phrase_end")).toHaveLength(1);
    expect(setup.logged.filter((line) => /Scribe не ответил/.test(line))).toHaveLength(1);
    expect(setup.closes).toEqual([]);
  });

  it("сессия закрыта: запросы кусков отменены, после закрытия ничего не уходит", async () => {
    const setup = withChunks();
    await speak(setup, 3);
    setup.session.close();
    await flush();

    expect(setup.scribe.calls.every((call) => call.signal?.aborted)).toBe(true);
    setup.scribe.calls[0]!.reply(scribeSounds(["(laughter)", 0.2, 0.8]));
    await vi.advanceTimersByTimeAsync(1000);
    expect(setup.of("sounds")).toHaveLength(0);
    expect(setup.of("phrase_end")).toHaveLength(0);
  });

  it("chunkSeconds: 0 — кусков нет, на конце фразы уходит всё окно, как раньше", async () => {
    const setup = withChunks({ chunkSeconds: 0 });
    await speak(setup, 4);
    expect(setup.scribe.calls).toHaveLength(0);

    phrase(setup, "Привет");
    await flush();

    expect(setup.scribe.calls).toHaveLength(1);
    expect(setup.scribe.calls[0]!.bytes).toBe(4 * BPS);
  });
});
