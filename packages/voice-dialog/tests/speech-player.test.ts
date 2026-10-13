import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpeechPlayer } from "../src/browser/speech-player";
import { FakeAudioContext, pcm16, speechPcm } from "./support/fake-web-audio";
import type { FakeSource } from "./support/fake-web-audio";

beforeEach(() => {
  FakeAudioContext.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
});

const make = () => {
  const player = createSpeechPlayer({ AudioContext: FakeAudioContext as unknown as typeof AudioContext });
  const context = () => FakeAudioContext.instances[0] as FakeAudioContext;
  return { player, context };
};

/** Плеер, уже разблокированный нажатием. */
function unlocked() {
  const made = make();
  made.player.unlock();
  return made;
}

describe("разблокировка звука (iPhone Safari)", () => {
  it("unlock внутри нажатия: создаёт контекст, просит resume и сразу проигрывает тихий буфер", () => {
    const { player, context } = make();
    expect(context()).toBeUndefined();
    expect(player.unlock()).toBe(true);
    const ctx = context();
    expect(ctx.resumeCalls).toBe(1);
    // тихий буфер запущен синхронно, до возврата из unlock — Safari засчитывает это нажатием
    expect(ctx.sources).toHaveLength(1);
    const silent = ctx.sources[0] as FakeSource;
    expect(silent.startedAt).not.toBeNull();
    expect(silent.buffer?.getChannelData(0).every((v) => v === 0)).toBe(true);
    expect(silent.connectedTo).toBe(ctx.destination);
  });

  it("повторное нажатие использует тот же контекст и снова просит resume", () => {
    const { player, context } = make();
    player.unlock();
    player.unlock();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(context().resumeCalls).toBe(2);
  });

  it("нет AudioContext (старый браузер) — unlock честно отвечает false и ничего не падает", () => {
    const player = createSpeechPlayer({ AudioContext: undefined });
    expect(player.unlock()).toBe(false);
    expect(() => player.enqueue(speechPcm(100))).not.toThrow();
    expect(player.playedMs()).toBe(0);
  });

  it("если контекст уснул (или iOS его прервала) до постановки звука — enqueue снова просит resume", () => {
    const { player, context } = unlocked();
    context().state = "suspended";
    const before = context().resumeCalls;
    player.enqueue(speechPcm(100));
    expect(context().resumeCalls).toBe(before + 1);
  });

  it("контекст отдаётся наружу (для слежения за «interrupted»)", () => {
    const { player, context } = make();
    expect(player.audioContext).toBeNull();
    player.unlock();
    expect(player.audioContext).toBe(context());
  });
});

describe("очередь кусков", () => {
  it("PCM 16 бит переводится в числа −1…1 с частотой 24 кГц", () => {
    const { player, context } = unlocked();
    player.enqueue(pcm16([0, 16384, -32768, 32767]));
    const source = context().sources[1] as FakeSource; // [0] — тихий буфер разблокировки
    const buffer = source.buffer!;
    expect(buffer.sampleRate).toBe(24_000);
    expect(buffer.numberOfChannels).toBe(1);
    expect(Array.from(buffer.getChannelData(0)).map((v) => Number(v.toFixed(4)))).toEqual([0, 0.5, -1, 1]);
  });

  it("куски встают встык по времени, без пауз и без наложения", () => {
    const { player, context } = unlocked();
    player.enqueue(speechPcm(500));
    player.enqueue(speechPcm(250));
    player.enqueue(speechPcm(100));
    const [, a, b, c] = context().sources as FakeSource[];
    expect(b!.startedAt).toBeCloseTo(a!.startedAt! + 0.5, 6);
    expect(c!.startedAt).toBeCloseTo(a!.startedAt! + 0.75, 6);
  });

  it("первый кусок стартует сразу, не дожидаясь следующих (без накопления)", () => {
    const { player, context } = unlocked();
    context().currentTime = 10;
    player.enqueue(speechPcm(100));
    const source = context().sources[1] as FakeSource;
    expect(source.startedAt).toBeGreaterThanOrEqual(10);
    expect(source.startedAt! - 10).toBeLessThanOrEqual(0.1);
  });

  it("если следующий кусок опоздал (очередь опустела), он стартует «сейчас», а не в прошлом", () => {
    const { player, context } = unlocked();
    player.enqueue(speechPcm(100));
    context().currentTime = 5;
    player.enqueue(speechPcm(100));
    const late = context().sources[2] as FakeSource;
    expect(late.startedAt).toBeGreaterThanOrEqual(5);
    expect(late.startedAt! - 5).toBeLessThanOrEqual(0.1);
  });

  it("нечётный байт в конце куска дожидается следующего куска", () => {
    const { player, context } = unlocked();
    const whole = pcm16([1000, 2000, 3000]);
    player.enqueue(whole.subarray(0, 3));
    player.enqueue(whole.subarray(3));
    const samples = (context().sources as FakeSource[])
      .slice(1)
      .flatMap((s) => Array.from(s.buffer!.getChannelData(0)))
      .map((v) => Math.round(v * 32768));
    expect(samples).toEqual([1000, 2000, 3000]);
  });

  it("пустой кусок ничего не ставит", () => {
    const { player, context } = unlocked();
    player.enqueue(new Uint8Array(0));
    expect(context().sources).toHaveLength(1);
  });

  it("сколько стоит в очереди, в мс", () => {
    const { player, context } = unlocked();
    player.enqueue(speechPcm(500));
    player.enqueue(speechPcm(500));
    expect(player.queuedMs()).toBeCloseTo(1000, 3);
    context().currentTime = 0.4;
    expect(player.queuedMs()).toBeLessThan(1000);
  });

  it("закончившиеся источники убираются, память не растёт", () => {
    const { player, context } = unlocked();
    for (let i = 0; i < 20; i++) player.enqueue(speechPcm(50));
    for (const source of (context().sources as FakeSource[]).slice(1)) source.finish();
    expect(player.queuedMs()).toBe(0);
    expect(player.isPlaying()).toBe(false);
  });
});

describe("flush: мгновенная тишина", () => {
  it("останавливает все источники сразу, до любых таймеров (≤ 150 мс по подменённым часам)", () => {
    vi.useFakeTimers();
    const { player, context } = unlocked();
    for (let i = 0; i < 6; i++) player.enqueue(speechPcm(300));
    const started = Date.now();
    player.flush();
    expect(Date.now() - started).toBeLessThanOrEqual(150);
    for (const source of (context().sources as FakeSource[]).slice(1)) {
      expect(source.stopCalls).toBe(1);
      expect(source.disconnected).toBe(true);
    }
    expect(player.isPlaying()).toBe(false);
    expect(player.queuedMs()).toBe(0);
  });

  it("упавший stop() у одного источника не мешает остановить остальные", () => {
    const { player, context } = unlocked();
    player.enqueue(speechPcm(300));
    player.enqueue(speechPcm(300));
    const [, first, second] = context().sources as FakeSource[];
    first!.stop = () => {
      throw new Error("уже остановлен");
    };
    expect(() => player.flush()).not.toThrow();
    expect(second!.stopCalls).toBe(1);
  });

  it("после flush запоздавший кусок старой реплики не играет: новая очередь начинается с нового enqueue", () => {
    const { player, context } = unlocked();
    player.enqueue(speechPcm(300));
    player.flush();
    context().currentTime = 1;
    player.enqueue(speechPcm(100));
    const fresh = context().sources[2] as FakeSource;
    expect(fresh.startedAt! - 1).toBeLessThanOrEqual(0.1);
  });

  it("flush не зовёт onDrained: перебивание — не «доиграли»", () => {
    const { player } = unlocked();
    const drained = vi.fn();
    player.onDrained(drained);
    player.enqueue(speechPcm(300));
    player.flush();
    expect(drained).not.toHaveBeenCalled();
  });
});

describe("playedMs: сколько реально проиграно", () => {
  it("считается по времени AudioContext от начала звука", () => {
    const { player, context } = unlocked();
    player.enqueue(speechPcm(1000));
    const start = (context().sources[1] as FakeSource).startedAt!;
    expect(player.playedMs()).toBe(0);
    context().currentTime = start + 0.4;
    expect(player.playedMs()).toBeCloseTo(400, 3);
    context().currentTime = start + 5;
    expect(player.playedMs()).toBeCloseTo(1000, 3); // не больше, чем поставлено
  });

  it("между кусками пауза (агент ещё не досказал) в проигранное не входит", () => {
    const { player, context } = unlocked();
    player.enqueue(speechPcm(500));
    const start = (context().sources[1] as FakeSource).startedAt!;
    context().currentTime = start + 2; // первый доигран, ждём следующий
    player.enqueue(speechPcm(500));
    const second = (context().sources[2] as FakeSource).startedAt!;
    context().currentTime = second + 0.25;
    expect(player.playedMs()).toBeCloseTo(750, 3);
  });

  it("flush возвращает проигранное на момент остановки и обнуляет счёт", () => {
    const { player, context } = unlocked();
    player.enqueue(speechPcm(1000));
    const start = (context().sources[1] as FakeSource).startedAt!;
    context().currentTime = start + 0.3;
    expect(player.flush()).toEqual({ playedMs: expect.closeTo(300, 3) });
    expect(player.playedMs()).toBe(0);
  });

  it("beginReply начинает счёт заново (новая реплика)", () => {
    const { player, context } = unlocked();
    player.enqueue(speechPcm(500));
    context().currentTime = 3;
    expect(player.playedMs()).toBeCloseTo(500, 3);
    player.beginReply();
    expect(player.playedMs()).toBe(0);
    player.enqueue(speechPcm(500));
    const start = (context().sources[2] as FakeSource).startedAt!;
    context().currentTime = start + 0.2;
    expect(player.playedMs()).toBeCloseTo(200, 3);
  });
});

describe("onDrained: всё поставленное доиграно", () => {
  it("зовётся, когда закончился последний источник", () => {
    const { player, context } = unlocked();
    const drained = vi.fn();
    player.onDrained(drained);
    player.enqueue(speechPcm(100));
    player.enqueue(speechPcm(100));
    const [, a, b] = context().sources as FakeSource[];
    a!.finish();
    expect(drained).not.toHaveBeenCalled();
    b!.finish();
    expect(drained).toHaveBeenCalledTimes(1);
  });

  it("отписка работает", () => {
    const { player, context } = unlocked();
    const drained = vi.fn();
    const off = player.onDrained(drained);
    off();
    player.enqueue(speechPcm(100));
    (context().sources[1] as FakeSource).finish();
    expect(drained).not.toHaveBeenCalled();
  });
});

describe("close", () => {
  it("закрывает контекст и глушит звук; после close unlock создаёт новый контекст", async () => {
    const { player, context } = unlocked();
    player.enqueue(speechPcm(300));
    const first = context();
    await player.close();
    expect((first.sources[1] as FakeSource).stopCalls).toBe(1);
    expect(first.closeCalls).toBe(1);
    expect(player.audioContext).toBeNull();
    player.unlock();
    expect(FakeAudioContext.instances).toHaveLength(2);
  });
});

describe("заполнитель: отдельный источник звука", () => {
  it("playFiller играет звук сразу и сообщает, сколько он длится", () => {
    const { player, context } = unlocked();
    context().currentTime = 4;

    const result = player.playFiller(speechPcm(800));

    expect(result?.durationMs).toBeCloseTo(800, 3);
    const source = context().sources[1] as FakeSource;
    expect(source.startedAt! - 4).toBeLessThanOrEqual(0.1);
    expect(player.isPlaying()).toBe(true);
  });

  it("без звука в браузере или с пустым звуком — null, ничего не ставится", () => {
    const silent = createSpeechPlayer({ AudioContext: undefined });
    expect(silent.playFiller(speechPcm(800))).toBeNull();
    const { player, context } = unlocked();
    expect(player.playFiller(new Uint8Array(0))).toBeNull();
    expect(context().sources).toHaveLength(1);
  });

  it("в счёт проигранного реплики не входит: playedMs и flush считают только ответ", () => {
    const { player, context } = unlocked();
    player.playFiller(speechPcm(800));
    context().currentTime = 0.5;
    expect(player.playedMs()).toBe(0);

    context().currentTime = 1;
    player.enqueue(speechPcm(400));
    const answerStart = (context().sources[2] as FakeSource).startedAt!;
    context().currentTime = answerStart + 0.25;

    expect(player.flush().playedMs).toBeCloseTo(250, 3);
  });

  it("настоящий ответ встаёт сразу после заполнителя: ни наложения, ни лишней паузы", () => {
    const { player, context } = unlocked();
    player.playFiller(speechPcm(800));
    const filler = context().sources[1] as FakeSource;
    context().currentTime = filler.startedAt! + 0.3;

    player.enqueue(speechPcm(500));

    const answer = context().sources[2] as FakeSource;
    expect(answer.startedAt).toBeCloseTo(filler.startedAt! + 0.8, 6);
  });

  it("заполнитель доиграл, ответ пришёл позже — стартует «сейчас», без ожидания прошлого", () => {
    const { player, context } = unlocked();
    player.playFiller(speechPcm(800));
    context().currentTime = 10;

    player.enqueue(speechPcm(100));

    expect((context().sources[2] as FakeSource).startedAt! - 10).toBeLessThanOrEqual(0.1);
  });

  it("flush глушит и заполнитель, без onDrained", () => {
    const { player, context } = unlocked();
    const drained = vi.fn();
    player.onDrained(drained);
    player.playFiller(speechPcm(800));
    const filler = context().sources[1] as FakeSource;

    player.flush();

    expect(filler.stopCalls).toBe(1);
    expect(filler.disconnected).toBe(true);
    expect(player.isPlaying()).toBe(false);
    expect(drained).not.toHaveBeenCalled();
  });

  it("после flush заполнитель не держит следующий ответ: тот стартует сразу", () => {
    const { player, context } = unlocked();
    player.playFiller(speechPcm(800));
    player.flush();
    context().currentTime = 1;

    player.enqueue(speechPcm(100));

    expect((context().sources[2] as FakeSource).startedAt! - 1).toBeLessThanOrEqual(0.1);
  });

  it("новая реплика (beginReply) заполнитель не трогает", () => {
    const { player, context } = unlocked();
    player.playFiller(speechPcm(800));
    const filler = context().sources[1] as FakeSource;

    player.beginReply();

    expect(filler.stopCalls).toBe(0);
    expect(player.isPlaying()).toBe(true);
  });

  it("isAnswerPlaying: только настоящий ответ, а isPlaying — любой звук", () => {
    const { player, context } = unlocked();
    player.playFiller(speechPcm(800));
    expect(player.isAnswerPlaying()).toBe(false);
    expect(player.isPlaying()).toBe(true);

    player.enqueue(speechPcm(100));
    expect(player.isAnswerPlaying()).toBe(true);

    (context().sources[2] as FakeSource).finish();
    expect(player.isAnswerPlaying()).toBe(false);
    expect(player.isPlaying()).toBe(true);
  });

  it("onDrained зовётся, когда доиграло всё: и заполнитель, и ответ", () => {
    const { player, context } = unlocked();
    const drained = vi.fn();
    player.onDrained(drained);
    player.playFiller(speechPcm(800));
    player.enqueue(speechPcm(100));
    const [, filler, answer] = context().sources as FakeSource[];

    filler!.finish();
    expect(drained).not.toHaveBeenCalled();
    answer!.finish();

    expect(drained).toHaveBeenCalledTimes(1);
  });

  it("onAnswerDrained: ответ доиграл, пока заполнитель ещё звучит или нет — отдельное событие", () => {
    const { player, context } = unlocked();
    const answerDrained = vi.fn();
    player.onAnswerDrained(answerDrained);
    player.playFiller(speechPcm(800));
    player.enqueue(speechPcm(100));
    const [, filler, answer] = context().sources as FakeSource[];

    filler!.finish();
    expect(answerDrained).not.toHaveBeenCalled();
    answer!.finish();

    expect(answerDrained).toHaveBeenCalledTimes(1);
  });

  it("close глушит заполнитель", async () => {
    const { player, context } = unlocked();
    player.playFiller(speechPcm(800));
    const filler = context().sources[1] as FakeSource;

    await player.close();

    expect(filler.stopCalls).toBe(1);
  });
});
