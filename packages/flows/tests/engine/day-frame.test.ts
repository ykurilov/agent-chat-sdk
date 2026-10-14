import { describe, expect, it } from "vitest";
import { DEFAULT_HARD_FRAME_TEXT, dayClosedToday, frameState, hardFrameText, humanMessagesToday } from "../../src/engine/day-frame";
import type { FlowRun } from "../../src/engine/flow-run";
import type { FlowSchedule } from "../../src/format/flow-format";

// T801: рамки дня по счёту сообщений человека за день сценария — чистые функции.

const MSK = "Europe/Moscow";
/** Момент по Москве, октябрь 2026. */
const msk = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour - 3, minute);
const schedule = { dayStart: "09:00", nightFrom: "21:00", dayFrame: { softFrom: 12, hardAt: 15, hardText: "Утром отвечу!" } } as FlowSchedule;

describe("frameState", () => {
  const frame = schedule.dayFrame;

  it("до мягкой рамки — normal; с N-го — soft; на M-м — last; дальше — closed", () => {
    expect(frameState(1, frame)).toBe("normal");
    expect(frameState(11, frame)).toBe("normal");
    expect(frameState(12, frame)).toBe("soft");
    expect(frameState(14, frame)).toBe("soft");
    expect(frameState(15, frame)).toBe("last");
    expect(frameState(16, frame)).toBe("closed");
    expect(frameState(40, frame)).toBe("closed");
  });

  it("рамок нет — всегда normal", () => {
    expect(frameState(100, undefined)).toBe("normal");
    expect(frameState(100, {})).toBe("normal");
  });

  it("только мягкая — soft без конца; только жёсткая — normal до M-го", () => {
    expect(frameState(30, { softFrom: 5 })).toBe("soft");
    expect(frameState(4, { softFrom: 5 })).toBe("normal");
    expect(frameState(9, { hardAt: 10 })).toBe("normal");
    expect(frameState(10, { hardAt: 10 })).toBe("last");
    expect(frameState(11, { hardAt: 10 })).toBe("closed");
  });

  it("готовая фраза — своя или по умолчанию", () => {
    expect(hardFrameText(frame)).toBe("Утром отвечу!");
    expect(hardFrameText({ hardAt: 3 })).toBe(DEFAULT_HARD_FRAME_TEXT);
    expect(hardFrameText({ hardAt: 3, hardText: "  " })).toBe(DEFAULT_HARD_FRAME_TEXT);
  });
});

describe("счёт за день сценария", () => {
  const run = { dayCounts: { "2026-10-14": 7 } } as unknown as FlowRun;

  it("ключ — день, который идёт: до начала дня — ещё вчерашний", () => {
    expect(humanMessagesToday(run, msk(14, 15), MSK, schedule)).toBe(7);
    expect(humanMessagesToday(run, msk(15, 8, 59), MSK, schedule)).toBe(7);
    expect(humanMessagesToday(run, msk(15, 9), MSK, schedule)).toBe(0);
    expect(humanMessagesToday({ dayCounts: undefined } as unknown as FlowRun, msk(14, 15), MSK, schedule)).toBe(0);
  });

  it("закрытый день: только сегодняшний, утром снова открыт", () => {
    expect(dayClosedToday("2026-10-14", msk(14, 22), MSK, schedule)).toBe(true);
    expect(dayClosedToday("2026-10-14", msk(15, 8), MSK, schedule)).toBe(true);
    expect(dayClosedToday("2026-10-14", msk(15, 9), MSK, schedule)).toBe(false);
    expect(dayClosedToday(null, msk(14, 22), MSK, schedule)).toBe(false);
  });
});
