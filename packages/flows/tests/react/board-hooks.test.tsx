// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFlow, type AgentFlow } from "../../src/format";
import type { FlowEditorSkin } from "../../src/react";
import { useFlowEditor } from "../../src/react/editor/use-flow-editor";
import { addSideTask } from "../../src/react/editor/side-task-model";
import { FlowTestChat, type FlowTestChatConnection } from "../../src/react/test-chat";
import salesReview from "../fixtures/sales-review.json";

// Этап 10 сценариев: свои проверки приложения в редакторе (T1001) и перемотка тестового чата к началу дня (T1004).

afterEach(cleanup);

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const flow = (() => {
  const parsed = parseFlow(salesReview);
  if (!parsed.ok) throw new Error("пример не разобран");
  return parsed.flow;
})();
const withSchedule: AgentFlow = { ...flow, schedule: { dayStart: "09:00", lateStartHours: 3, farewellOnDeadline: false, lengthDays: 3 } };
const catalog = { tools: ["give_booking_link", "call_expert"], events: ["booking_link"], widgets: [] };

describe("T1001 свои проверки приложения", () => {
  function useHarness(initial: AgentFlow, checks: Parameters<typeof useFlowEditor>[0]["checks"]) {
    const [value, setValue] = useState(initial);
    return useFlowEditor({ value, onChange: setValue, catalog, checks, timeZone: "UTC" });
  }

  it("находки приложения идут после встроенных; клик ведёт на ноду и на попутную задачу", () => {
    const made = addSideTask(flow, "Узнать город");
    const checks = vi.fn((current: AgentFlow) => [
      { path: "states[2]", message: "«Продажа» только в одной ноде" },
      { path: "sideTasks[0]", message: "Задача без поля", level: "warning" as const },
    ]);
    const hook = renderHook(() => useHarness(made.flow, checks));
    const issues = hook.result.current.issues;
    expect(checks).toHaveBeenCalled();
    expect(issues.slice(-2)).toEqual([
      { level: "error", code: "app_check", message: "«Продажа» только в одной ноде", place: { stateId: "offer" } },
      { level: "warning", code: "app_check", message: "Задача без поля", place: { sideTaskId: made.sideTaskId } },
    ]);
    expect(hook.result.current.issueCount).toEqual({ errors: 1, warnings: 1 });

    act(() => hook.result.current.goToIssue(issues.at(-2)!));
    expect(hook.result.current.selection).toEqual({ kind: "state", stateId: "offer" });
    act(() => hook.result.current.goToIssue(issues.at(-1)!));
    expect(hook.result.current.selection).toEqual({ kind: "overview", sideTaskId: made.sideTaskId });
  });

  it("проверка приложения упала — редактор работает, находка об этом в списке", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const hook = renderHook(() =>
      useHarness(flow, () => {
        throw new Error("сломалось");
      }),
    );
    expect(hook.result.current.issues.at(-1)).toMatchObject({ level: "warning", code: "app_check_failed" });
    spy.mockRestore();
  });
});

const nothing = () => null;
const skin = {
  FlowEditorFrame: ({ header, board, panel }) => (
    <div>
      {header}
      {board}
      <aside data-testid="panel">{panel}</aside>
    </div>
  ),
  FlowHeader: (props) => (props.onOpenTestChat ? <button onClick={props.onOpenTestChat}>тест</button> : null),
  FlowStateNode: nothing,
  FlowAnyStateNode: nothing,
  FlowEdge: nothing,
  FlowLegend: nothing,
  FlowZoomControls: nothing,
  FlowOverviewPanel: () => <p>обзор</p>,
  FlowStatePanel: nothing,
  FlowAnyStatePanel: nothing,
  FlowExitCard: nothing,
  FlowCardPanel: nothing,
  FlowFieldRow: nothing,
  FlowCheckPanel: nothing,
  FlowRunPanel: nothing,
  FlowJsonDialog: nothing,
  FlowMigrateDialog: nothing,
  FlowTestChatFrame: (props) => (
    <section>
      <p data-testid="clock">{props.clock}</p>
      <p data-testid="day">{props.day ?? "нет"}</p>
      {props.onNextDay && <button onClick={props.onNextDay}>утро</button>}
      {props.children}
    </section>
  ),
} satisfies FlowEditorSkin;

describe("T1004 тестовый чат: к началу следующего дня", () => {
  const HOUR = 3_600_000;
  function connection(): FlowTestChatConnection & { advanceToNextDay: ReturnType<typeof vi.fn> } {
    let day = 1;
    return {
      start: async () => ({ chatId: "test-1" }),
      advance: async (_chatId, ms) => ({ timeOffset: ms }),
      advanceToNextDay: vi.fn(async () => {
        day += 1;
        return { timeOffset: 18 * HOUR };
      }),
      readRun: async () => ({ state: "intro", path: [], day: { day, totalDays: 3, isLastDay: day === 3, dayStartedAt: 0, nextDayStartAt: 0 } }),
      renderChat: (chatId) => <p data-testid="chat">{chatId}</p>,
    };
  }

  it("кнопка есть только у сценария с «Днями и временем»; после перемотки строка дня обновляется", async () => {
    const testChat = connection();
    const view = render(<FlowTestChat skin={skin} value={withSchedule} onChange={() => {}} catalog={catalog} testChat={testChat} timeZone="Europe/Moscow" />);
    fireEvent.click(screen.getByText("тест"));
    await screen.findByTestId("chat");
    await waitFor(() => expect(screen.getByTestId("day").textContent).toMatch(/^День 1 из 3 · \d\d:\d\d$/));

    fireEvent.click(screen.getByText("утро"));
    await waitFor(() => expect(screen.getByTestId("day").textContent).toMatch(/^День 2 из 3 · /));
    expect(testChat.advanceToNextDay).toHaveBeenCalledWith("test-1");
    expect(screen.getByTestId("clock").textContent).toBe("+18 ч");

    view.rerender(<FlowTestChat skin={skin} value={flow} onChange={() => {}} catalog={catalog} testChat={testChat} />);
    expect(screen.queryByText("утро")).toBeNull();
  });

  it("приложение не дало перемотку до утра — кнопки нет", async () => {
    const { advanceToNextDay: _skip, ...testChat } = connection();
    render(<FlowTestChat skin={skin} value={withSchedule} onChange={() => {}} catalog={catalog} testChat={testChat} />);
    fireEvent.click(screen.getByText("тест"));
    await screen.findByTestId("chat");
    expect(screen.queryByText("утро")).toBeNull();
  });
});
