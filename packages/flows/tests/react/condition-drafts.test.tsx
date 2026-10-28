// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { parseFlow, type AgentFlow, type FlowCondition } from "../../src/format";
import { useFlowEditor } from "../../src/react/editor/use-flow-editor";
import fixture from "../fixtures/sales-review.json";
const parsed = parseFlow(fixture);
if (!parsed.ok) throw new Error("invalid fixture");
const initial = parsed.flow;
const catalog = { tools: initial.tools, events: [], widgets: [] };
afterEach(cleanup);
function useHarness(readOnly = false) {
  const [value, onChange] = useState<AgentFlow>(structuredClone(initial));
  return useFlowEditor({ value, onChange, catalog, readOnly });
}

describe("inactive condition drafts belong to the editor, not the wire document", () => {
  it("restores all four kinds including data value, event name and timer settings", () => {
    const { result } = renderHook(() => useHarness());
    const change = (when: FlowCondition) => act(() => result.current.changeExit("intro", "intro_clear", { when, to: "block" }));
    const current = () => result.current.flow.states[0]!.exits[0]!.when;
    change({ type: "data" } as FlowCondition);
    change({ type: "data", field: "sales", op: "eq", value: "до 10 продаж" });
    change({ type: "event" } as FlowCondition);
    change({ type: "event", event: "tool", name: "call_expert" });
    change({ type: "timer" } as FlowCondition);
    change({ type: "timer", from: "time_of_day", at: "15:45" });
    change({ type: "judge" } as FlowCondition);
    expect(current()).toEqual(initial.states[0]!.exits[0]!.when);
    change({ type: "judge", text: "Новая редакция условия" });
    for (const when of [
      { type: "data", field: "sales", op: "eq", value: "до 10 продаж" },
      { type: "event", event: "tool", name: "call_expert" },
      { type: "timer", from: "time_of_day", at: "15:45" },
      { type: "judge", text: "Новая редакция условия" },
    ] as FlowCondition[]) {
      change({ type: when.type } as FlowCondition);
      expect(current()).toEqual(when);
    }
    expect(Object.keys(result.current.flow.states[0]!.exits[0]!)).toEqual(["id", "when", "to"]);
  });

  it("discards removed exit drafts and starts fresh after importing JSON", () => {
    const { result } = renderHook(() => useHarness());
    const change = (when: FlowCondition) => act(() => result.current.changeExit("intro", "intro_clear", { when, to: "block" }));
    change({ type: "data" } as FlowCondition);
    change({ type: "data", field: "sales", op: "eq", value: "до 10 продаж" });
    change({ type: "judge" } as FlowCondition);
    act(() => { expect(result.current.loadJson(JSON.stringify(initial))).toBe(true); });
    change({ type: "data" } as FlowCondition);
    expect(result.current.flow.states[0]!.exits[0]!.when).toEqual({ type: "data", field: "name", op: "filled" });
    act(() => result.current.edit(flow => ({ ...flow, states: flow.states.map(state => state.id === "intro" ? { ...state, exits: [] } : state) })));
    act(() => result.current.edit(flow => ({ ...flow, states: flow.states.map(state => state.id === "intro" ? { ...state, exits: [{ id: "intro_clear", when: { type: "judge", text: "Другое правило" }, to: "block" }] } : state) })));
    change({ type: "data" } as FlowCondition);
    change({ type: "judge" } as FlowCondition);
    expect(result.current.flow.states[0]!.exits[0]!.when).toEqual({ type: "judge", text: "Другое правило" });
  });

  it("same-kind navigation does not clear text, while an explicit empty edit stays empty", () => {
    const { result } = renderHook(() => useHarness());
    const change = (when: FlowCondition) => act(() => result.current.changeExit("intro", "intro_clear", { when, to: "block" }));
    change({ type: "judge" } as FlowCondition);
    expect(result.current.flow.states[0]!.exits[0]!.when).toEqual(initial.states[0]!.exits[0]!.when);
    change({ type: "judge", text: "" });
    change({ type: "data" } as FlowCondition);
    change({ type: "judge" } as FlowCondition);
    expect(result.current.flow.states[0]!.exits[0]!.when).toEqual({ type: "judge", text: "" });
  });

  it("an explicit complete replacement takes precedence over an inactive draft", () => {
    const { result } = renderHook(() => useHarness());
    const change = (when: FlowCondition) => act(() => result.current.changeExit("intro", "intro_clear", { when, to: "block" }));
    change({ type: "data", field: "sales", op: "eq", value: "до 10 продаж" });
    change({ type: "judge" } as FlowCondition);
    change({ type: "data", field: "name", op: "filled" });
    expect(result.current.flow.states[0]!.exits[0]!.when).toEqual({ type: "data", field: "name", op: "filled" });
  });

  it("does not edit or replace a draft while readOnly is enabled", () => {
    const { result, rerender } = renderHook(({ readOnly }) => useHarness(readOnly), { initialProps: { readOnly: false } });
    act(() => result.current.changeExit("intro", "intro_clear", { when: { type: "data" } as FlowCondition, to: "block" }));
    const before = result.current.flow;
    rerender({ readOnly: true });
    act(() => result.current.changeExit("intro", "intro_clear", { when: { type: "judge", text: "Запрещённая правка" }, to: null }));
    expect(result.current.flow).toBe(before);
    rerender({ readOnly: false });
    act(() => result.current.changeExit("intro", "intro_clear", { when: { type: "judge" } as FlowCondition, to: "block" }));
    expect(result.current.flow.states[0]!.exits[0]!.when).toEqual(initial.states[0]!.exits[0]!.when);
  });
});
