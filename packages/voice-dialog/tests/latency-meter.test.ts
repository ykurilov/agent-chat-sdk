import { describe, expect, it } from "vitest";
import { createLatencyMeter } from "../src/browser/latency-meter";
import type { LatencyPoint } from "../src/browser/latency-meter";

function meter() {
  const clock = { now: 0 };
  return { clock, meter: createLatencyMeter({ now: () => clock.now }) };
}

/** Один полный ход: метки на заданных моментах (мс от начала хода). */
function turn(m: ReturnType<typeof meter>, start: number, offsets: Record<LatencyPoint, number>) {
  for (const point of ["phraseEndAt", "firstTextAt", "firstSentenceAt", "speechStartedAt", "firstSampleAt"] as const) {
    m.clock.now = start + offsets[point];
    m.meter.mark(point);
  }
  return m.meter.finishTurn();
}

const offsets = (total: number): Record<LatencyPoint, number> => ({
  phraseEndAt: 0,
  firstTextAt: Math.round(total * 0.4),
  firstSentenceAt: Math.round(total * 0.5),
  speechStartedAt: Math.round(total * 0.8),
  firstSampleAt: total,
});

describe("замер задержки: один ход", () => {
  it("даёт вклад каждого звена и полную задержку", () => {
    const m = meter();
    const report = turn(m, 1000, { phraseEndAt: 0, firstTextAt: 400, firstSentenceAt: 550, speechStartedAt: 900, firstSampleAt: 1000 });
    expect(report).toEqual({
      marks: { phraseEndAt: 1000, firstTextAt: 1400, firstSentenceAt: 1550, speechStartedAt: 1900, firstSampleAt: 2000 },
      legs: { model: 400, sentence: 150, speech: 350, delivery: 100 },
      totalMs: 1000,
    });
  });

  it("метка ставится один раз за ход: повторная не сдвигает первую", () => {
    const m = meter();
    m.meter.mark("phraseEndAt", 100);
    m.meter.mark("firstTextAt", 200);
    m.meter.mark("firstTextAt", 900);
    m.meter.mark("firstSampleAt", 1100);
    expect(m.meter.finishTurn()?.marks.firstTextAt).toBe(200);
  });

  it("метку можно поставить с явным временем (пришло позже, чем случилось)", () => {
    const m = meter();
    m.clock.now = 5000;
    m.meter.mark("phraseEndAt", 4000);
    m.meter.mark("firstSampleAt", 4900);
    expect(m.meter.finishTurn()?.totalMs).toBe(900);
  });

  it("без звука (нет первого сэмпла) хода в отчёте нет", () => {
    const m = meter();
    m.meter.mark("phraseEndAt", 0);
    m.meter.mark("firstTextAt", 300);
    expect(m.meter.finishTurn()).toBeNull();
    expect(m.meter.summary().count).toBe(0);
  });

  it("если промежуточной метки нет, звено не считается, полная задержка — считается", () => {
    const m = meter();
    m.meter.mark("phraseEndAt", 0);
    m.meter.mark("firstSampleAt", 800);
    const report = m.meter.finishTurn();
    expect(report?.totalMs).toBe(800);
    expect(report?.legs).toEqual({});
  });

  it("новый конец фразы начинает новый ход: недоделанный прежний забывается", () => {
    const m = meter();
    m.meter.mark("phraseEndAt", 0);
    m.meter.mark("firstTextAt", 300);
    m.meter.mark("phraseEndAt", 5000);
    m.meter.mark("firstSampleAt", 5700);
    expect(m.meter.finishTurn()).toMatchObject({ totalMs: 700, marks: { phraseEndAt: 5000 } });
  });

  it("метка без начатого хода (нет конца фразы) игнорируется", () => {
    const m = meter();
    m.meter.mark("firstSampleAt", 100);
    expect(m.meter.finishTurn()).toBeNull();
  });

  it("после finishTurn метки нового хода не мешаются со старыми", () => {
    const m = meter();
    turn(m, 0, offsets(1000));
    m.meter.mark("firstSampleAt", 50_000);
    expect(m.meter.finishTurn()).toBeNull();
  });
});

describe("замер задержки: серия", () => {
  it("медиана и 90-й процентиль по ходам", () => {
    const m = meter();
    const totals = [900, 1100, 950, 1300, 1000, 2000, 980, 1050, 1200, 1020];
    totals.forEach((total, i) => turn(m, i * 10_000, offsets(total)));
    const summary = m.meter.summary();
    expect(summary.count).toBe(10);
    expect(summary.medianMs).toBe(1035); // между 1020 и 1050
    expect(summary.p90Ms).toBe(1300); // 9-е значение из 10 по возрастанию (метод ближайшего ранга)
  });

  it("нечётное число ходов: медиана — среднее по счёту", () => {
    const m = meter();
    [500, 900, 700].forEach((total, i) => turn(m, i * 10_000, offsets(total)));
    expect(m.meter.summary().medianMs).toBe(700);
  });

  it("вклад каждого звена: медиана по серии", () => {
    const m = meter();
    [
      { phraseEndAt: 0, firstTextAt: 300, firstSentenceAt: 400, speechStartedAt: 700, firstSampleAt: 800 },
      { phraseEndAt: 0, firstTextAt: 500, firstSentenceAt: 600, speechStartedAt: 900, firstSampleAt: 1000 },
      { phraseEndAt: 0, firstTextAt: 400, firstSentenceAt: 500, speechStartedAt: 800, firstSampleAt: 900 },
    ].forEach((o, i) => turn(m, i * 10_000, o));
    expect(m.meter.summary().legsMedianMs).toEqual({ model: 400, sentence: 100, speech: 300, delivery: 100 });
  });

  it("пустая серия", () => {
    expect(meter().meter.summary()).toEqual({ count: 0, medianMs: null, p90Ms: null, legsMedianMs: {} });
  });

  it("ходы хранятся с потолком, чтобы режим на часы не копил память", () => {
    const m = createLatencyMeter({ now: () => 0, keepTurns: 5 });
    for (let i = 0; i < 12; i++) {
      m.mark("phraseEndAt", 0);
      m.mark("firstSampleAt", 100 + i);
      m.finishTurn();
    }
    expect(m.summary().count).toBe(5);
    expect(m.summary().medianMs).toBe(109); // последние пять: 107…111
  });
});
