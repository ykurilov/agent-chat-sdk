import { describe, expect, it } from "vitest";
import {
  PROVIDER_OUTAGE_ALERT_EVERY_MS,
  PROVIDER_OUTAGE_PAUSE_MS,
  PROVIDER_OUTAGE_PROBE_MS,
  createProviderOutages,
  isProviderOutage,
} from "../../../src/provider-errors/provider-outages";

/** Память отказов на подменённых часах: `advance` двигает время, `logged` — строки журнала. */
function outagesOnClock() {
  let time = 1_000_000;
  const logged: string[] = [];
  const outages = createProviderOutages({ now: () => time, logError: (line) => logged.push(line) });
  return { outages, logged, advance: (ms: number) => (time += ms) };
}

describe("isProviderOutage: провайдер не ответит ни на какой запрос", () => {
  it.each(["insufficient_funds", "invalid_key"] as const)("%s — да", (kind) => {
    expect(isProviderOutage(kind)).toBe(true);
  });

  it.each(["overloaded", "rate_limited", "context_overflow", "other"] as const)("%s — нет", (kind) => {
    expect(isProviderOutage(kind)).toBe(false);
  });
});

describe("createProviderOutages: пауза провайдера и громкая строка владельцу", () => {
  it("после отказа провайдер на паузе 5 минут с видом отказа; дальше — снова доступен", () => {
    const { outages, advance } = outagesOnClock();
    expect(PROVIDER_OUTAGE_PAUSE_MS).toBe(5 * 60_000);
    outages.report({ providerId: "deepseek", kind: "insufficient_funds", fallbackProviderId: "openrouter" });

    expect(outages.pausedKind("deepseek")).toBe("insufficient_funds");
    expect(outages.pausedKind("openrouter")).toBeUndefined();
    advance(PROVIDER_OUTAGE_PAUSE_MS - 1);
    expect(outages.pausedKind("deepseek")).toBe("insufficient_funds");
    advance(1);
    expect(outages.pausedKind("deepseek")).toBeUndefined();
  });

  it("громкая строка: кончились деньги, ходы через запасной", () => {
    const { outages, logged } = outagesOnClock();
    outages.report({ providerId: "deepseek", kind: "insufficient_funds", fallbackProviderId: "openrouter" });
    expect(logged).toEqual(["[ВНИМАНИЕ провайдер] deepseek: кончились деньги — ходы идут через запасной openrouter"]);
  });

  it("громкая строка: исчерпан предел расходов ключа", () => {
    const { outages, logged } = outagesOnClock();
    outages.report({ providerId: "openrouter", kind: "insufficient_funds", keyLimit: true, fallbackProviderId: "deepseek" });
    expect(logged).toEqual(["[ВНИМАНИЕ провайдер] openrouter: исчерпан предел расходов ключа — ходы идут через запасной deepseek"]);
  });

  it("громкая строка: ключ не принят; запасного нет — ходы падают", () => {
    const { outages, logged } = outagesOnClock();
    outages.report({ providerId: "deepseek", kind: "invalid_key" });
    expect(logged).toEqual(["[ВНИМАНИЕ провайдер] deepseek: ключ не принят — запасного нет, ходы падают с ошибкой"]);
  });

  it("строка о провайдере — не чаще раза в 15 минут; о другом провайдере — своя", () => {
    const { outages, logged, advance } = outagesOnClock();
    expect(PROVIDER_OUTAGE_ALERT_EVERY_MS).toBe(15 * 60_000);
    const report = () => outages.report({ providerId: "deepseek", kind: "insufficient_funds", fallbackProviderId: "openrouter" });

    report();
    advance(60_000);
    report();
    outages.report({ providerId: "openrouter", kind: "insufficient_funds" });
    advance(PROVIDER_OUTAGE_ALERT_EVERY_MS - 60_000 - 1);
    report();
    expect(logged.filter((line) => line.includes(" deepseek:"))).toHaveLength(1);
    expect(logged.filter((line) => line.includes(" openrouter:"))).toHaveLength(1);

    advance(1);
    report();
    expect(logged.filter((line) => line.includes(" deepseek:"))).toHaveLength(2);
  });

  it("каждый новый отказ продлевает паузу", () => {
    const { outages, advance } = outagesOnClock();
    outages.report({ providerId: "deepseek", kind: "insufficient_funds" });
    advance(PROVIDER_OUTAGE_PAUSE_MS - 1_000);
    outages.report({ providerId: "deepseek", kind: "invalid_key" });
    advance(2_000);
    expect(outages.pausedKind("deepseek")).toBe("invalid_key");
  });

  it("громкая строка: запасные есть, но тоже на паузе — так и сказано", () => {
    const { outages, logged } = outagesOnClock();
    outages.report({ providerId: "deepseek", kind: "insufficient_funds", fallbacksPaused: true });
    expect(logged).toEqual(["[ВНИМАНИЕ провайдер] deepseek: кончились деньги — запасные тоже на паузе, ходы падают с ошибкой"]);
  });

  it("провайдер ответил — пауза снята, а строка при новом отказе — всё равно не чаще раза в 15 минут («мигание»)", () => {
    const { outages, logged, advance } = outagesOnClock();
    outages.report({ providerId: "deepseek", kind: "insufficient_funds" });
    outages.recovered("deepseek");
    expect(outages.pausedKind("deepseek")).toBeUndefined();
    advance(60_000);
    outages.report({ providerId: "deepseek", kind: "insufficient_funds" });
    expect(logged).toHaveLength(1);
    advance(PROVIDER_OUTAGE_ALERT_EVERY_MS - 60_000);
    outages.report({ providerId: "deepseek", kind: "insufficient_funds" });
    expect(logged).toHaveLength(2);
  });
});

describe("createProviderOutages: после паузы — одна пробная попытка на всех", () => {
  it("admit: неизвестный провайдер — пускает; на паузе — вид отказа", () => {
    const { outages } = outagesOnClock();
    expect(outages.admit("deepseek")).toBeUndefined();
    outages.report({ providerId: "deepseek", kind: "insufficient_funds" });
    expect(outages.admit("deepseek")).toBe("insufficient_funds");
  });

  it("пауза кончилась: первый ход пробует, остальные — мимо, пока проба идёт", () => {
    const { outages, advance } = outagesOnClock();
    outages.report({ providerId: "deepseek", kind: "insufficient_funds" });
    advance(PROVIDER_OUTAGE_PAUSE_MS);

    expect(outages.admit("deepseek")).toBeUndefined();
    expect(outages.admit("deepseek")).toBe("insufficient_funds");
    expect(outages.pausedKind("deepseek")).toBe("insufficient_funds");
  });

  it("проба ответила — пускаются все", () => {
    const { outages, advance } = outagesOnClock();
    outages.report({ providerId: "deepseek", kind: "insufficient_funds" });
    advance(PROVIDER_OUTAGE_PAUSE_MS);
    outages.admit("deepseek");
    outages.recovered("deepseek");
    expect(outages.admit("deepseek")).toBeUndefined();
    expect(outages.admit("deepseek")).toBeUndefined();
  });

  it("проба отказала — новая пауза на 5 минут", () => {
    const { outages, advance } = outagesOnClock();
    outages.report({ providerId: "deepseek", kind: "insufficient_funds" });
    advance(PROVIDER_OUTAGE_PAUSE_MS);
    outages.admit("deepseek");
    outages.report({ providerId: "deepseek", kind: "insufficient_funds" });
    advance(PROVIDER_OUTAGE_PAUSE_MS - 1);
    expect(outages.admit("deepseek")).toBe("insufficient_funds");
    advance(1);
    expect(outages.admit("deepseek")).toBeUndefined();
  });

  it("проба пропала без итога (сбой другого рода, «Стоп») — через минуту пробует следующий ход", () => {
    const { outages, advance } = outagesOnClock();
    expect(PROVIDER_OUTAGE_PROBE_MS).toBe(60_000);
    outages.report({ providerId: "deepseek", kind: "insufficient_funds" });
    advance(PROVIDER_OUTAGE_PAUSE_MS);
    outages.admit("deepseek");
    advance(PROVIDER_OUTAGE_PROBE_MS - 1);
    expect(outages.admit("deepseek")).toBe("insufficient_funds");
    advance(1);
    expect(outages.admit("deepseek")).toBeUndefined();
  });
});
