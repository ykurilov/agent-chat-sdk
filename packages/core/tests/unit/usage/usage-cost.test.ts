import { describe, expect, it } from "vitest";
import type { ModelPrice } from "../../../src/models/model-catalog";
import { costOfSteps, costOfUsage } from "../../../src/usage/usage-cost";
import type { UsageTokens } from "../../../src/usage/usage-cost";

const usage = (fields: Partial<UsageTokens> = {}): UsageTokens => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  ...fields,
});

const price: ModelPrice = { inputPerMillion: 0.3, outputPerMillion: 1.2, cachedInputPerMillion: 0.006 };

describe("costOfUsage: доллары из токенов", () => {
  it("нулевой расход стоит ноль", () => {
    expect(costOfUsage(usage(), price)).toBe(0);
  });

  it("вход и выход по своим ценам", () => {
    expect(costOfUsage(usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), price)).toBeCloseTo(1.5, 10);
  });

  it("вход из кэша берётся по цене кэша, остальной вход — по цене входа", () => {
    // 2 000 обычных × 0,30 + 8 000 из кэша × 0,006 + 500 выхода × 1,20, всё за миллион
    const cost = costOfUsage(usage({ inputTokens: 10_000, cachedInputTokens: 8_000, outputTokens: 500 }), price);
    expect(cost).toBeCloseTo((2_000 * 0.3 + 8_000 * 0.006 + 500 * 1.2) / 1_000_000, 12);
  });

  it("нет цены кэша — прочитанное из кэша идёт по цене входа", () => {
    const noCachePrice: ModelPrice = { inputPerMillion: 0.3, outputPerMillion: 1.2 };
    const cost = costOfUsage(usage({ inputTokens: 10_000, cachedInputTokens: 8_000 }), noCachePrice);
    expect(cost).toBeCloseTo((10_000 * 0.3) / 1_000_000, 12);
  });

  it("запись в кэш идёт по цене записи и не считается дважды как обычный вход", () => {
    const withWrite: ModelPrice = { ...price, cacheWritePerMillion: 0.125 };
    const cost = costOfUsage(usage({ inputTokens: 10_000, cachedInputTokens: 4_000, cacheWriteTokens: 2_000 }), withWrite);
    expect(cost).toBeCloseTo((4_000 * 0.3 + 4_000 * 0.006 + 2_000 * 0.125) / 1_000_000, 12);
  });

  it("нет цены записи — записанное в кэш идёт по цене входа", () => {
    const cost = costOfUsage(usage({ inputTokens: 10_000, cacheWriteTokens: 2_000 }), price);
    expect(cost).toBeCloseTo((10_000 * 0.3) / 1_000_000, 12);
  });

  it("рассуждения уже входят в выход и отдельно не прибавляются", () => {
    const cost = costOfUsage(usage({ outputTokens: 1_000_000, reasoningTokens: 400_000 }), price);
    expect(cost).toBeCloseTo(1.2, 10);
  });

  it("кэш больше входа (сбой данных провайдера) не даёт отрицательной цены", () => {
    expect(costOfUsage(usage({ inputTokens: 100, cachedInputTokens: 500 }), price)).toBeGreaterThanOrEqual(0);
  });
});

describe("costOfUsage: ступени цены по длине контекста", () => {
  const tiered: ModelPrice = {
    inputPerMillion: 1,
    outputPerMillion: 2,
    cachedInputPerMillion: 0.1,
    cacheWritePerMillion: 1.25,
    tiers: [
      { inputTokensAbove: 272_000, inputPerMillion: 2, outputPerMillion: 3, cachedInputPerMillion: 0.2, cacheWritePerMillion: 2.5 },
      { inputTokensAbove: 500_000, inputPerMillion: 4, outputPerMillion: 6 },
    ],
  };

  it("вход до порога включительно — обычная цена", () => {
    expect(costOfUsage(usage({ inputTokens: 272_000, outputTokens: 1_000 }), tiered)).toBeCloseTo((272_000 * 1 + 1_000 * 2) / 1_000_000, 12);
  });

  it("вход выше порога — весь запрос по цене ступени, кэш тоже", () => {
    const spent = usage({ inputTokens: 300_000, cachedInputTokens: 100_000, cacheWriteTokens: 50_000, outputTokens: 1_000 });
    expect(costOfUsage(spent, tiered)).toBeCloseTo((150_000 * 2 + 100_000 * 0.2 + 50_000 * 2.5 + 1_000 * 3) / 1_000_000, 12);
  });

  it("берётся самая высокая подходящая ступень; нет цены кэша у ступени — кэш по её цене входа", () => {
    const spent = usage({ inputTokens: 600_000, cachedInputTokens: 100_000, outputTokens: 1_000 });
    expect(costOfUsage(spent, tiered)).toBeCloseTo((500_000 * 4 + 100_000 * 4 + 1_000 * 6) / 1_000_000, 12);
  });
});

describe("costOfSteps: ступень выбирается по каждому запросу, а не по сумме хода", () => {
  const tiered: ModelPrice = { inputPerMillion: 1, outputPerMillion: 2, tiers: [{ inputTokensAbove: 272_000, inputPerMillion: 2, outputPerMillion: 3 }] };

  it("два шага по 200 тысяч — оба по обычной цене, хотя вместе 400 тысяч", () => {
    const step = usage({ inputTokens: 200_000, outputTokens: 1_000 });
    expect(costOfSteps([step, step], tiered)).toBeCloseTo((2 * (200_000 * 1 + 1_000 * 2)) / 1_000_000, 12);
  });

  it("шаг выше порога идёт по ступени, шаг ниже — по обычной цене", () => {
    const steps = [usage({ inputTokens: 100_000 }), usage({ inputTokens: 300_000, outputTokens: 1_000 })];
    expect(costOfSteps(steps, tiered)).toBeCloseTo((100_000 * 1 + 300_000 * 2 + 1_000 * 3) / 1_000_000, 12);
  });
});


describe("costOfUsage: часы пик", () => {
  // Как у DeepSeek: базовая цена непиковая, по будням 01–04 и 06–10 UTC всё вдвое дороже.
  const offPeak: ModelPrice = {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cachedInputPerMillion: 0.003,
    peakHours: { multiplier: 2, windows: [{ days: [1, 2, 3, 4, 5], from: "01:00", to: "04:00" }, { days: [1, 2, 3, 4, 5], from: "06:00", to: "10:00" }] },
  };
  const spent = usage({ inputTokens: 10_000, cachedInputTokens: 8_000, outputTokens: 500 });
  const base = (2_000 * 0.15 + 8_000 * 0.003 + 500 * 0.6) / 1_000_000;

  it("без времени запроса — базовая цена", () => {
    expect(costOfUsage(spent, offPeak)).toBeCloseTo(base, 12);
  });

  it("будний день в пик (вторник 02:30 UTC) — вдвое, кэш тоже вдвое", () => {
    expect(costOfUsage(spent, offPeak, new Date("2026-10-06T02:30:00Z"))).toBeCloseTo(base * 2, 12);
  });

  it("граница окна: 04:00 уже не пик, 06:00 — пик, 09:59 — пик, 10:00 — нет", () => {
    expect(costOfUsage(spent, offPeak, new Date("2026-10-06T04:00:00Z"))).toBeCloseTo(base, 12);
    expect(costOfUsage(spent, offPeak, new Date("2026-10-06T06:00:00Z"))).toBeCloseTo(base * 2, 12);
    expect(costOfUsage(spent, offPeak, new Date("2026-10-06T09:59:59Z"))).toBeCloseTo(base * 2, 12);
    expect(costOfUsage(spent, offPeak, new Date("2026-10-06T10:00:00Z"))).toBeCloseTo(base, 12);
  });

  it("выходной (суббота 02:30 UTC) — базовая цена", () => {
    expect(costOfUsage(spent, offPeak, new Date("2026-10-10T02:30:00Z"))).toBeCloseTo(base, 12);
  });

  it("попадания в кэш — своим множителем", () => {
    const cacheFlat: ModelPrice = { ...offPeak, peakHours: { ...offPeak.peakHours!, cachedInputMultiplier: 1 } };
    const peak = (2_000 * 0.15 * 2 + 8_000 * 0.003 + 500 * 0.6 * 2) / 1_000_000;
    expect(costOfUsage(spent, cacheFlat, new Date("2026-10-06T02:30:00Z"))).toBeCloseTo(peak, 12);
  });

  it("окна по часам своего пояса и даты-исключения (праздники)", () => {
    const moscow: ModelPrice = {
      inputPerMillion: 1,
      outputPerMillion: 1,
      peakHours: { multiplier: 3, timeZone: "Europe/Moscow", windows: [{ days: [1, 2, 3, 4, 5, 6, 7], from: "09:00", to: "18:00" }], exceptDates: ["2026-10-07"] },
    };
    const million = usage({ inputTokens: 1_000_000 });
    // 06:30 UTC = 09:30 по Москве — пик; 05:30 UTC = 08:30 — нет.
    expect(costOfUsage(million, moscow, new Date("2026-10-06T06:30:00Z"))).toBeCloseTo(3, 10);
    expect(costOfUsage(million, moscow, new Date("2026-10-06T05:30:00Z"))).toBeCloseTo(1, 10);
    expect(costOfUsage(million, moscow, new Date("2026-10-07T06:30:00Z"))).toBeCloseTo(1, 10);
  });

  it("окно через полночь (22:00–02:00) действует в обе стороны", () => {
    const night: ModelPrice = { inputPerMillion: 1, outputPerMillion: 1, peakHours: { multiplier: 2, windows: [{ days: [2], from: "22:00", to: "02:00" }] } };
    const million = usage({ inputTokens: 1_000_000 });
    expect(costOfUsage(million, night, new Date("2026-10-06T23:00:00Z"))).toBeCloseTo(2, 10);
    // Среда 01:00 — продолжение вторничного окна.
    expect(costOfUsage(million, night, new Date("2026-10-07T01:00:00Z"))).toBeCloseTo(2, 10);
    expect(costOfUsage(million, night, new Date("2026-10-07T23:00:00Z"))).toBeCloseTo(1, 10);
  });

  it("ход из шагов в разное время: каждый шаг по своему часу", () => {
    const steps = [
      { ...usage({ outputTokens: 1_000_000 }), at: "2026-10-06T03:59:00Z" },
      { ...usage({ outputTokens: 1_000_000 }), at: "2026-10-06T04:01:00Z" },
    ];
    expect(costOfSteps(steps, offPeak)).toBeCloseTo(0.6 * 2 + 0.6, 10);
  });
});

describe("costOfUsage: запись в кэш на 5 минут и на час", () => {
  // Цены Claude Haiku 5.5 у OpenRouter на 2026-10-11; от 100 тысяч токенов входа — ступень впятеро дороже.
  const haiku: ModelPrice = {
    inputPerMillion: 0.1,
    outputPerMillion: 0.5,
    cachedInputPerMillion: 0.01,
    cacheWritePerMillion: 0.125,
    cacheWrite1hPerMillion: 0.2,
    tiers: [{ inputTokensAbove: 99_999, inputPerMillion: 0.5, outputPerMillion: 2.5, cachedInputPerMillion: 0.05, cacheWritePerMillion: 0.625, cacheWrite1hPerMillion: 1 }],
  };
  const spent = usage({ inputTokens: 20_000, cachedInputTokens: 2_000, cacheWriteTokens: 17_000, outputTokens: 100 });

  it("без отметки срока — запись по цене 5 минут", () => {
    expect(costOfUsage(spent, haiku)).toBeCloseTo((1_000 * 0.1 + 2_000 * 0.01 + 17_000 * 0.125 + 100 * 0.5) / 1_000_000, 12);
  });

  it("срок записи — час: запись по часовой цене, остальное как было", () => {
    expect(costOfUsage(spent, { ...haiku, cacheWriteTtl: "1h" })).toBeCloseTo((1_000 * 0.1 + 2_000 * 0.01 + 17_000 * 0.2 + 100 * 0.5) / 1_000_000, 12);
  });

  it("ступень по длине контекста — часовая цена ступени", () => {
    const long = usage({ inputTokens: 120_000, cachedInputTokens: 100_000, cacheWriteTokens: 19_000, outputTokens: 1_000 });
    const want = (1_000 * 0.5 + 100_000 * 0.05 + 19_000 * 1 + 1_000 * 2.5) / 1_000_000;
    expect(costOfUsage(long, { ...haiku, cacheWriteTtl: "1h" })).toBeCloseTo(want, 12);
    expect(costOfUsage(long, haiku)).toBeCloseTo((1_000 * 0.5 + 100_000 * 0.05 + 19_000 * 0.625 + 1_000 * 2.5) / 1_000_000, 12);
  });

  it("срок час, а часовой цены нет — по цене записи 5 минут", () => {
    const { cacheWrite1hPerMillion: _hour, tiers: _tiers, ...noHourPrice } = haiku;
    expect(costOfUsage(spent, { ...noHourPrice, cacheWriteTtl: "1h" })).toBeCloseTo(costOfUsage(spent, noHourPrice), 12);
  });

  it("часы пик умножают и часовую запись", () => {
    const peak: ModelPrice = { ...haiku, cacheWriteTtl: "1h", peakHours: { multiplier: 2, windows: [{ days: [1, 2, 3, 4, 5, 6, 7], from: "00:00", to: "23:59" }] } };
    const writeOnly = usage({ inputTokens: 10_000, cacheWriteTokens: 10_000 });
    expect(costOfUsage(writeOnly, peak, new Date("2026-10-06T12:00:00Z"))).toBeCloseTo((10_000 * 0.2 * 2) / 1_000_000, 12);
  });
});
