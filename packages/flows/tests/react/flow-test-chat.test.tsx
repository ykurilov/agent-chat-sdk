// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFlow, type AgentFlow } from "../../src/format";
import { FlowTestChat, formatClockOffset, type FlowTestChatConnection } from "../../src/react/test-chat";
import type { FlowEditorSkin } from "../../src/react";
import salesReview from "../fixtures/sales-review.json";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// T101: тестовый чат рядом с доской — открыть из шапки, чат приложения в панели, перемотка часов, подсветка состояния.

afterEach(cleanup);

// Доске нужен наблюдатель размеров; в jsdom его нет.
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

const nothing = () => null;
/** Скин-заглушка: шапка — кнопка теста, узел — строка с отметкой прогона, рамка теста — часы и кнопки. */
const skin = {
  FlowEditorFrame: ({ header, board, panel }) => (
    <div>
      {header}
      {board}
      <aside data-testid="panel">{panel}</aside>
    </div>
  ),
  FlowHeader: (props) => (props.onOpenTestChat ? <button onClick={props.onOpenTestChat}>тест</button> : null),
  FlowStateNode: (props) => <div data-testid={`node-${props.stateId}`} data-run={props.run ?? ""} />,
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
    <section aria-label="тестовый чат">
      <p data-testid="state">{props.stateTitle}</p>
      <p data-testid="clock">{props.clock}</p>
      {props.advanceSteps.map((step) => (
        <button key={step.ms} onClick={() => props.onAdvance(step.ms)}>
          {step.label}
        </button>
      ))}
      <button onClick={props.onReset}>заново</button>
      <button onClick={props.onClose}>закрыть</button>
      {props.children}
    </section>
  ),
} satisfies FlowEditorSkin;

type FakeRun = { state: string; path: Array<{ state: string }> };

function connection(): FlowTestChatConnection & {
  start: ReturnType<typeof vi.fn>;
  advance: ReturnType<typeof vi.fn>;
  readRun: ReturnType<typeof vi.fn>;
  /** Место чатов на «сервере»: тест меняет, хук читает через `readRun`. */
  runs: Map<string, FakeRun>;
} {
  let chats = 0;
  let offset = 0;
  const runs = new Map<string, FakeRun>();
  return {
    runs,
    // Доске нужны только состояние и путь: остальное место в подделке не нужно.
    readRun: vi.fn(async (chatId: string) => (runs.get(chatId) ?? null) as Awaited<ReturnType<FlowTestChatConnection["readRun"]>>),
    start: vi.fn(async (_flow: AgentFlow) => {
      chats += 1;
      offset = 0;
      return { chatId: `test-${chats}` };
    }),
    advance: vi.fn(async (_chatId: string, ms: number) => ({ timeOffset: (offset += ms) })),
    renderChat: (chatId: string) => <p data-testid="chat">{chatId}</p>,
  };
}

function renderEditor(testChat: FlowTestChatConnection) {
  return render(<FlowTestChat skin={skin} value={flow} onChange={() => {}} catalog={{ tools: [], events: [], widgets: [] }} testChat={testChat} />);
}

describe("T101 formatClockOffset", () => {
  it("сдвиг готовой строкой", () => {
    expect(formatClockOffset(0)).toBe("как сейчас");
    expect(formatClockOffset(20 * MIN)).toBe("+20 мин");
    expect(formatClockOffset(3 * HOUR + 20 * MIN)).toBe("+3 ч 20 мин");
    expect(formatClockOffset(DAY + 3 * HOUR)).toBe("+1 д 3 ч");
  });
});

describe("T101 FlowTestChat", () => {
  it("кнопка в шапке открывает новый тестовый чат по сценарию из редактора — чат приложения в панели рядом с доской", async () => {
    const testChat = connection();
    renderEditor(testChat);
    expect(screen.getByTestId("panel").textContent).toBe("обзор");

    fireEvent.click(screen.getByText("тест"));
    await waitFor(() => expect(screen.getByTestId("chat").textContent).toBe("test-1"));
    expect(testChat.start).toHaveBeenCalledWith(flow);
    expect(screen.getByTestId("state").textContent).toBe("Знакомство");
    expect(screen.getByTestId("clock").textContent).toBe("как сейчас");
    // Пока ходов нет, чат стоит в стартовом состоянии.
    expect(screen.getByTestId("node-intro").dataset.run).toBe("current");

    fireEvent.click(screen.getByText("закрыть"));
    expect(screen.getByTestId("panel").textContent).toBe("обзор");
    expect(screen.getByTestId("node-intro").dataset.run).toBe("");
  });

  it("подсветка по месту с сервера (readRun): текущее и пройденные; ход в чате подхватывается опросом", async () => {
    const testChat = connection();
    renderEditor(testChat);
    fireEvent.click(screen.getByText("тест"));
    await screen.findByTestId("chat");
    await waitFor(() => expect(testChat.readRun).toHaveBeenCalledWith("test-1"));
    expect(screen.getByTestId("node-intro").dataset.run).toBe("current");

    testChat.runs.set("test-1", { state: "remind", path: [{ state: "intro" }, { state: "remind" }] });
    await waitFor(() => expect(screen.getByTestId("node-remind").dataset.run).toBe("current"), { timeout: 3000 });
    expect(screen.getByTestId("node-intro").dataset.run).toBe("visited");
    expect(screen.getByTestId("state").textContent).toBe("Напоминание");
  });

  it("перемотка перечитывает место сразу, не дожидаясь опроса", async () => {
    const testChat = connection();
    testChat.advance.mockImplementation(async (chatId: string, ms: number) => {
      testChat.runs.set(chatId, { state: "remind", path: [{ state: "intro" }, { state: "remind" }] });
      return { timeOffset: ms };
    });
    renderEditor(testChat);
    fireEvent.click(screen.getByText("тест"));
    await screen.findByTestId("chat");

    fireEvent.click(screen.getByText("3 ч"));
    await waitFor(() => expect(screen.getByTestId("node-remind").dataset.run).toBe("current"), { timeout: 500 });
  });

  it("перемотка: сервер сдвигает часы чата, рамка показывает сдвиг; «заново» — новый чат с часами как сейчас", async () => {
    const testChat = connection();
    renderEditor(testChat);
    fireEvent.click(screen.getByText("тест"));
    await screen.findByTestId("chat");

    fireEvent.click(screen.getByText("3 ч"));
    await waitFor(() => expect(screen.getByTestId("clock").textContent).toBe("+3 ч"));
    expect(testChat.advance).toHaveBeenCalledWith("test-1", 3 * HOUR);
    fireEvent.click(screen.getByText("20 мин"));
    await waitFor(() => expect(screen.getByTestId("clock").textContent).toBe("+3 ч 20 мин"));

    fireEvent.click(screen.getByText("заново"));
    await waitFor(() => expect(screen.getByTestId("chat").textContent).toBe("test-2"));
    expect(screen.getByTestId("clock").textContent).toBe("как сейчас");
  });
});
