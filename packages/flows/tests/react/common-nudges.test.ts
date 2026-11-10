import { describe, expect, it } from "vitest";
import type { AgentFlow, FlowNudges } from "../../src/format";
import { stateNudges } from "../../src/engine/nudges";
import { russianFlowEditorLabels as labels } from "../../src/labels/editor";
import { flowToJson, loadFlowJson } from "../../src/react/editor/editor-model";
import { commonNudges, nudgesSummary, setScheduleOn, setStateNudges, updateCommonNudges } from "../../src/react/editor/schedule-model";
import { fixtureFlow } from "../flow-fixtures";

// Общие касания сценария на доске: один редактор показывает действующие (`schedule.nudges`, иначе `nudges` сценария)
// и правит то место, где они действуют. Скрытых касаний, которые тайно начнут действовать, не остаётся.

const ROOT: FlowNudges = { afterSilence: [{ amount: 2, unit: "h" }], giveUpAfter: { amount: 3, unit: "d" } };
const DAYS: FlowNudges = { afterSilence: [{ amount: 30, unit: "min" }], dailyAt: ["19:00"] };
const EDITED: FlowNudges = { afterSilence: [{ amount: 5, unit: "h" }] };

const base = (): AgentFlow => {
  const flow = fixtureFlow("sales-review");
  const { schedule: _schedule, nudges: _nudges, ...rest } = flow;
  return rest as AgentFlow;
};
const withRoot = (): AgentFlow => ({ ...base(), nudges: structuredClone(ROOT) });
const withDays = (nudges?: FlowNudges): AgentFlow => {
  const on = setScheduleOn(base(), true);
  return nudges ? { ...on, schedule: { ...on.schedule!, nudges: structuredClone(nudges) } } : on;
};
const roundTrip = (flow: AgentFlow) => {
  const loaded = loadFlowJson(flowToJson(flow));
  if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
  return loaded.flow;
};
const acting = (flow: AgentFlow) => stateNudges(flow, flow.states[0]!.id);

describe("действующие общие касания", () => {
  it("без «Дней и времени» — касания сценария", () => {
    expect(commonNudges(withRoot())).toEqual(ROOT);
  });

  it("есть касания «Дней и времени» — они, как у движка", () => {
    const flow = { ...withDays(DAYS), nudges: structuredClone(ROOT) };
    expect(commonNudges(flow)).toEqual(DAYS);
    expect(commonNudges(flow)).toEqual(acting(flow));
  });

  it("дни включены без своих касаний — действуют касания сценария", () => {
    const flow = { ...withDays(), nudges: structuredClone(ROOT) };
    expect(commonNudges(flow)).toEqual(ROOT);
    expect(acting(flow)).toEqual(ROOT);
  });

  it("касаний нет нигде — null", () => {
    expect(commonNudges(base())).toBeNull();
  });
});

describe("правка общих касаний", () => {
  it("без «Дней и времени» пишет в касания сценария и дни не включает", () => {
    const flow = roundTrip(updateCommonNudges(withRoot(), EDITED));
    expect(flow.nudges).toEqual(EDITED);
    expect(flow.schedule).toBeUndefined();
    expect(acting(flow)).toEqual(EDITED);
  });

  it("включение из «выкл» без дней — касания сценария", () => {
    const flow = updateCommonNudges(base(), EDITED);
    expect(flow.nudges).toEqual(EDITED);
    expect(flow.schedule).toBeUndefined();
  });

  it("дни включены, действуют касания сценария — правятся они, «Дни и время» не трогаются", () => {
    const before = { ...withDays(), nudges: structuredClone(ROOT) };
    const flow = updateCommonNudges(before, EDITED);
    expect(flow.nudges).toEqual(EDITED);
    expect(flow.schedule).toEqual(before.schedule);
  });

  it("действуют касания «Дней и времени» — правятся они, перекрытые касания сценария убираются", () => {
    const flow = roundTrip(updateCommonNudges({ ...withDays(DAYS), nudges: structuredClone(ROOT) }, EDITED));
    expect(flow.schedule?.nudges).toEqual(EDITED);
    expect(flow).not.toHaveProperty("nudges");
    expect(acting(flow)).toEqual(EDITED);
  });

  it("«выключить» убирает касания из обоих мест: агент действительно не пишет", () => {
    const flow = roundTrip(updateCommonNudges({ ...withDays(DAYS), nudges: structuredClone(ROOT) }, null));
    expect(flow.schedule).toBeDefined();
    expect(flow.schedule).not.toHaveProperty("nudges");
    expect(flow).not.toHaveProperty("nudges");
    expect(commonNudges(flow)).toBeNull();
    expect(acting(flow)).toBeNull();
  });

  it("пустые части убираются", () => {
    const flow = updateCommonNudges(base(), { afterSilence: [{ amount: 1, unit: "h" }], dailyAt: [], giveUpAfter: undefined });
    expect(flow.nudges).toEqual({ afterSilence: [{ amount: 1, unit: "h" }] });
  });
});

describe("«Дни и время» и общие касания", () => {
  it("включение не меняет действующих касаний", () => {
    const flow = setScheduleOn(withRoot(), true);
    expect(commonNudges(flow)).toEqual(ROOT);
    expect(acting(flow)).toEqual(ROOT);
  });

  it("выключение сохраняет действующие касания «Дней и времени» касаниями сценария", () => {
    const flow = roundTrip(setScheduleOn({ ...withDays(DAYS), nudges: structuredClone(ROOT) }, false));
    expect(flow.schedule).toBeUndefined();
    expect(flow.nudges).toEqual(DAYS);
    expect(acting(flow)).toEqual(DAYS);
  });

  it("выключение без касаний «Дней и времени» оставляет касания сценария как были", () => {
    const flow = setScheduleOn({ ...withDays(), nudges: structuredClone(ROOT) }, false);
    expect(flow.nudges).toEqual(ROOT);
  });
});

describe("свои касания этапа", () => {
  it("образец — действующие общие касания, и без «Дней и времени»", () => {
    const flow = setStateNudges(withRoot(), "intro", "own");
    expect(flow.states.find((state) => state.id === "intro")!.nudges).toEqual(ROOT);
  });
});

describe("касания одной строкой", () => {
  it("сроки тишины, время каждый день и конец разговора", () => {
    expect(nudgesSummary({ ...DAYS, giveUpAfter: { amount: 3, unit: "d" } }, labels)).toBe(
      "30 мин · каждый день в 19:00 · молчит 3 дн. — разговор окончен",
    );
    expect(nudgesSummary({ afterSilence: [{ amount: 15, unit: "min" }, { amount: 1, unit: "h" }] }, labels)).toBe("15 мин · 1 ч");
  });
});
