import { describe, expect, it, vi } from "vitest";
import type { FlowSchedule } from "../../src/format/flow-format";
import { chatWriteBlock, createFirstMessageRules } from "../../src/runtime/first-message-rules";
import { memoryFlowStore } from "../../src/store/memory";

// T703: правила «писать первым» — сценарий ← приложение ← SDK; закрытый день, окно, пауза; canWriteNow последним.

const MSK = "Europe/Moscow";
const msk = (day: number, hours: number, minutes = 0) => Date.UTC(2026, 9, day, hours - 3, minutes);
const anna = { ownerId: "anna", chatId: "c1", timeZone: MSK };
const schedule = (extra: Partial<FlowSchedule> = {}): FlowSchedule => ({ dayStart: "08:00", nightFrom: "22:30", lateStartHours: 3, farewellOnDeadline: false, ...extra });
const open = { dayClosedOn: null, pausedUntil: null, windowClosed: false };

describe("T703: правила сценария главнее приложения", () => {
  it("ночь сценария — [nightFrom, dayStart): в 22:00 можно, в 07:30 — перенос на 08:00", async () => {
    const rules = createFirstMessageRules({ quietHours: { from: "21:00", to: "09:00" } }, memoryFlowStore())!;
    expect(await rules.check({ ...anna, at: msk(14, 22), schedule: schedule() })).toEqual({ allowed: true });
    expect(await rules.check({ ...anna, at: msk(14, 7, 30), schedule: schedule() })).toEqual({ allowed: false, retryAt: msk(14, 8) });
    // Без nightFrom — начало ночи приложения, конец — начало дня сценария.
    const { nightFrom: _night, ...noNight } = schedule();
    expect(await rules.check({ ...anna, at: msk(14, 21, 30), schedule: noNight })).toEqual({ allowed: false, retryAt: msk(15, 8) });
  });

  it("потолок сценария главнее потолка приложения", async () => {
    const store = memoryFlowStore();
    const rules = createFirstMessageRules({ maxPerDay: 5 }, store)!;
    await rules.record({ ownerId: "anna", at: msk(14, 10), timeZone: MSK });
    const one = schedule({ firstMessages: { maxPerDay: 1 } });
    expect(await rules.check({ ...anna, at: msk(14, 11), schedule: one })).toEqual({ allowed: false, retryAt: msk(15, 8) });
  });

  it("закрытый день, пауза, окно — запрет до canWriteNow; приложение не спрашивается", async () => {
    const canWriteNow = vi.fn(() => true);
    const rules = createFirstMessageRules({ canWriteNow }, memoryFlowStore())!;
    const at = msk(14, 12);
    expect(await rules.check({ ...anna, at, schedule: schedule(), chat: { ...open, dayClosedOn: "2026-10-14" } })).toEqual({ allowed: false, retryAt: msk(15, 8) });
    expect(await rules.check({ ...anna, at, schedule: schedule(), chat: { ...open, pausedUntil: new Date(msk(14, 14)).toISOString() } })).toEqual({
      allowed: false,
      retryAt: msk(14, 14),
    });
    expect(await rules.check({ ...anna, at, schedule: schedule(), chat: { ...open, windowClosed: true } })).toEqual({ allowed: false, retryAt: null });
    expect(canWriteNow).not.toHaveBeenCalled();
    expect(await rules.check({ ...anna, at, schedule: schedule(), chat: { ...open, dayClosedOn: "2026-10-13" } })).toEqual({ allowed: true });
    expect(canWriteNow).toHaveBeenCalledOnce();
  });

  it("chatWriteBlock — то же без правил приложения (firstMessages: false); прошедшая пауза не мешает", () => {
    expect(chatWriteBlock({ ...open, windowClosed: true }, msk(14, 12), MSK, undefined)).toEqual({ retryAt: null });
    expect(chatWriteBlock({ ...open, pausedUntil: new Date(msk(14, 11)).toISOString() }, msk(14, 12), MSK, schedule())).toBeNull();
    expect(chatWriteBlock({ ...open, dayClosedOn: "2026-10-14" }, msk(14, 12), MSK, undefined)).toBeNull();
  });
});
