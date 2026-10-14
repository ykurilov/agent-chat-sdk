import { describe, expect, it, vi } from "vitest";
import { FLOW_CHAIN_LIMIT, startRun, type Transition } from "../../src/engine";
import { advance, transitionNotice } from "../../src/runtime/flow-events";
import { fixtureFlow, HOUR } from "../flow-fixtures";

describe("шаг сценария в ходе", () => {
  const flow = fixtureFlow("sales-review");

  it("предел переходов подряд: перехода нет, строка в журнал", () => {
    const run = { ...startRun(flow, 0), state: "remind", chain: FLOW_CHAIN_LIMIT };
    const onChainLimit = vi.fn();
    const out: Transition[] = [];
    const next = advance(flow, run, { type: "event", event: "message" }, { now: HOUR, card: {}, out, onChainLimit });
    expect(next).toBe(run);
    expect(out).toEqual([]);
    expect(onChainLimit).toHaveBeenCalledWith(run);
  });

  it("служебное сообщение: условие словами и точный первый текст цели", () => {
    const notice = transitionNotice(flow, [{ from: "intro", to: "remind", exitId: "any_silence", decidedBy: "timer", tags: [], at: 0 }]);
    expect(notice).toMatchObject({ kind: "app", name: "flow_transition" });
    expect(notice.title).toContain("Сработало: тишина 3 ч → «Напоминание».");
    expect(notice.title).toContain("скажи ровно это: «Вы ещё здесь? Можем продолжить, когда будет удобно.»");
  });
});
