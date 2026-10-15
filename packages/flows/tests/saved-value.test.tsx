// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { parseFlow, type AgentFlow } from "../src/format";
import { sameFlow } from "../src/react";
import { useFlowEditor, type UseFlowEditorOptions } from "../src/react/editor/use-flow-editor";
import salesReview from "./fixtures/sales-review.json";

afterEach(cleanup);

const parsed = (json: unknown): AgentFlow => {
  const result = parseFlow(json);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.flow;
};
const original = () => parsed(salesReview);
const renamed = (flow: AgentFlow, name = "Другое"): AgentFlow => ({ ...flow, name });
const catalog = { tools: ["give_booking_link", "call_expert"], events: ["booking_link"], widgets: [] };

/** Приложение держит сценарий у себя; доска монтируется заново, а value остаётся прежним. */
function mount(initial: AgentFlow, savedValue: AgentFlow | undefined, extra: Partial<UseFlowEditorOptions> = {}) {
  return renderHook(
    ({ saved }: { saved: AgentFlow | undefined }) => {
      const [value, setValue] = useState(initial);
      return useFlowEditor({ value, onChange: setValue, catalog, savedValue: saved, ...extra });
    },
    { initialProps: { saved: savedValue } },
  );
}

describe("savedValue: «Сохранено» считается от сервера, а не от момента монтирования", () => {
  it("перемонтирование с изменённым value: «не сохранено», сохранение доступно", () => {
    const hook = mount(renamed(original()), original());
    expect(hook.result.current.dirty).toBe(true);
  });

  it("без savedValue прежнее поведение: при монтировании всё «сохранено»", () => {
    const hook = mount(renamed(original()), undefined);
    expect(hook.result.current.dirty).toBe(false);
  });

  it("после успешного onSave отправленное считается сохранённым, пока не пришло новое savedValue", async () => {
    const hook = mount(renamed(original()), original(), { onSave: async () => ({ ok: true }) });
    await act(async () => hook.result.current.save());
    expect(hook.result.current.dirty).toBe(false);
    act(() => hook.result.current.edit((flow) => renamed(flow, "Ещё правка")));
    expect(hook.result.current.dirty).toBe(true);
  });

  it("новое savedValue пересчитывает статус", async () => {
    const hook = mount(renamed(original()), original(), { onSave: async () => ({ ok: true }) });
    await act(async () => hook.result.current.save());
    expect(hook.result.current.dirty).toBe(false);
    // Сервер ответил другим черновиком: отправленное больше не опора.
    hook.rerender({ saved: renamed(original(), "Чужое") });
    expect(hook.result.current.dirty).toBe(true);
    hook.rerender({ saved: renamed(original()) });
    expect(hook.result.current.dirty).toBe(false);
  });

  it("отказ в сохранении оставляет «не сохранено»", async () => {
    const hook = mount(renamed(original()), original(), { onSave: async () => ({ ok: false, issues: [] }) });
    await act(async () => hook.result.current.save());
    expect(hook.result.current.dirty).toBe(true);
  });
});

describe("sameFlow", () => {
  it("порядок ключей не важен (jsonb переставляет их)", () => {
    const a = original();
    const reorder = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reorder)
        : value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)]))
          : value;
    expect(sameFlow(a, reorder(a) as AgentFlow)).toBe(true);
  });

  it("другое значение или другой порядок состояний — не то же самое", () => {
    const a = original();
    expect(sameFlow(a, renamed(a))).toBe(false);
    expect(sameFlow(a, { ...a, states: [...a.states].reverse() })).toBe(false);
  });
});
