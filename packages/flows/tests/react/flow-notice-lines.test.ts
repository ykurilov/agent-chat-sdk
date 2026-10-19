import { describe, expect, it } from "vitest";
import { englishFlowNoticeLabels, flowNoticeLines, russianFlowNoticeLabels } from "../../src/react";

// 100: строки пометок «агент написал первым» для экрана (право `appNotices`): своя строка на каждую причину.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const lines = flowNoticeLines();
const timer = (data: unknown) => lines.flow_timer!({ name: "flow_timer", data });

describe("100 flowNoticeLines: строка на каждую причину", () => {
  it("касание при молчании — с длительностью «1 ч 7 мин»", () => {
    expect(timer({ reasons: [{ kind: "silence", step: 1 }], silentMs: 67 * MIN })).toBe("Агент написал первым — человек молчал 1 ч 7 мин");
  });

  it("утро нового дня, касание по расписанию, ответ на ночные сообщения", () => {
    expect(timer({ reasons: [{ kind: "morning" }], silentMs: 14 * HOUR })).toBe("Агент написал первым — утро нового дня, человек молчал 14 ч");
    expect(timer({ reasons: [{ kind: "daily", at: "19:00" }] })).toBe("Агент написал первым — касание по расписанию в 19:00");
    expect(timer({ reasons: [{ kind: "night_messages", count: 3 }], silentMs: 9 * HOUR })).toBe(
      "Агент написал первым — ответ на ночные сообщения (3), человек молчал 9 ч",
    );
  });

  it("срок ноды: дни ноды, день программы, общий срок — с названием следующего шага", () => {
    const moved = (when: unknown) => timer({ reasons: [{ kind: "transition", stateId: "s2" }], exit: { stateTitle: "Практика", when } });
    expect(moved({ type: "timer", from: "state_days", days: 2 })).toBe("Агент написал первым — срок шага вышел (шаг длился 2 д) → «Практика»");
    expect(moved({ type: "timer", from: "program_day", day: 3 })).toBe("Агент написал первым — срок шага вышел (наступил день 3) → «Практика»");
    expect(moved({ type: "timer", from: "since_start", amount: 7, unit: "d" })).toBe("Агент написал первым — общий срок вышел (7 д с начала разговора) → «Практика»");
    expect(moved({ type: "timer", from: "silence", amount: 3, unit: "h" })).toBe("Агент написал первым — срок шага вышел (тишина 3 ч) → «Практика»");
    expect(timer({ reasons: [{ kind: "transition", stateId: "s2" }] })).toBe("Агент написал первым — срок шага вышел");
  });

  it("несколько причин — одна строка с перечислением; длительность один раз", () => {
    expect(
      timer({ reasons: [{ kind: "transition", stateId: "s2" }, { kind: "morning" }, { kind: "silence", step: 2 }], silentMs: DAY + 5 * MIN, exit: { stateTitle: "Итог" } }),
    ).toBe("Агент написал первым — срок шага вышел → «Итог», утро нового дня, человек молчал 1 д 5 мин");
  });

  it("прощание по сроку программы; меньше минуты; непонятные данные — строки нет", () => {
    expect(lines.flow_deadline!({ name: "flow_deadline", data: { reasons: [{ kind: "farewell" }], silentMs: 2 * DAY } })).toBe(
      "Агент написал первым — прощание: срок программы вышел, человек молчал 2 д",
    );
    expect(timer({ reasons: [{ kind: "silence", step: 1 }], silentMs: 10_000 })).toBe("Агент написал первым — человек молчал меньше минуты");
    expect(timer(null)).toBeUndefined();
    expect(timer({ reasons: [] })).toBeUndefined();
  });

  it("свои подписи и английские", () => {
    const english = flowNoticeLines(englishFlowNoticeLabels);
    expect(english.flow_timer!({ name: "flow_timer", data: { reasons: [{ kind: "silence", step: 1 }], silentMs: 67 * MIN } })).toBe(
      "The agent wrote first — the person was silent for 1 h 7 min",
    );
    const own = flowNoticeLines({ ...russianFlowNoticeLabels, wroteFirst: (reasons) => `Сам написал: ${reasons}` });
    expect(own.flow_timer!({ name: "flow_timer", data: { reasons: [{ kind: "morning" }] } })).toBe("Сам написал: утро нового дня");
  });
});
