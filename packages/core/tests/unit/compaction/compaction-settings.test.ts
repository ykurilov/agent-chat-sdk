import { describe, expect, it } from "vitest";
import {
  effectiveThreshold,
  isContextNearLimit,
  resolveCompactionSettings,
} from "../../../src/compaction/compaction-settings";

describe("настройки сжатия", () => {
  it("без настроек — значения по умолчанию из решений: 200 тыс., хвост 20 тыс., потолок сводки 20 тыс.", () => {
    expect(resolveCompactionSettings(undefined)).toEqual({
      thresholdTokens: 200_000,
      tailTokens: 20_000,
      summaryCeilingTokens: 20_000,
      flushWaitMs: 30_000,
    });
  });

  it("false выключает сжатие", () => {
    expect(resolveCompactionSettings(false)).toBeNull();
  });

  it("свои значения заменяют только названные; модель и задание доходят как есть", () => {
    const settings = resolveCompactionSettings({
      thresholdTokens: 5000,
      tailTokens: 1000,
      model: { modelId: "m", providerId: "p" },
      instruction: "Сожми.",
    });
    expect(settings).toEqual({
      thresholdTokens: 5000,
      tailTokens: 1000,
      summaryCeilingTokens: 20_000,
      flushWaitMs: 30_000,
      model: { modelId: "m", providerId: "p" },
      instruction: "Сожми.",
    });
  });

  it("хвост не меньше порога и неположительные числа — ошибка при настройке, а не посреди чата", () => {
    expect(() => resolveCompactionSettings({ thresholdTokens: 1000, tailTokens: 1000 })).toThrow(/хвост/i);
    expect(() => resolveCompactionSettings({ thresholdTokens: 0 })).toThrow(/thresholdTokens/);
    expect(() => resolveCompactionSettings({ summaryCeilingTokens: -1 })).toThrow(/summaryCeilingTokens/);
  });

  it("порог для модели — не больше 80% её окна", () => {
    const settings = resolveCompactionSettings(undefined)!;
    expect(effectiveThreshold(settings, 1_000_000)).toBe(200_000);
    expect(effectiveThreshold(settings, 128_000)).toBe(102_400);
    expect(effectiveThreshold(settings, 250_000)).toBe(200_000);
    expect(effectiveThreshold(settings, 200_000)).toBe(160_000);
  });

  it("контекст у предела — от 90% окна", () => {
    expect(isContextNearLimit(89_999, 100_000)).toBe(false);
    expect(isContextNearLimit(90_000, 100_000)).toBe(true);
  });
});
