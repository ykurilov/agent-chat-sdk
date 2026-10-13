// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentChat } from "../src/agent-chat";
import { useChatLabels } from "../src/labels";
import type { ChatSkin } from "../src/skin-contract";
import type { StepPhrases } from "../src/work-view/step-phrases";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { kinds, renderAgentChat, sendQuestion, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";
import { stubWorkSkin } from "./support/stub-work-skin";

setupChatDom();

/** Заглушка скина версии 23: живая строка и свёрнутые шаги видны в data-атрибутах. */
const simpleSkin: ChatSkin = {
  ...stubWorkSkin,
  Widget: ({ toolCallId }) => <div data-kind="widget" data-id={toolCallId} />,
  WorkSteps: function StubWorkSteps(view) {
    const labels = useChatLabels();
    if (view.state === "live") return <p data-kind="work-live">{view.phrase}</p>;
    return (
      <div data-kind="work-done" data-count={String(view.count)} data-open={String(view.open)}>
        <button type="button" aria-expanded={view.open} onClick={() => view.onOpenChange(!view.open)}>
          {labels.workView.stepsDone(view.count)}
        </button>
        {view.open && (
          <ul>
            {view.steps.map((step, index) => (
              <li key={index} data-kind="work-step" data-failed={String(step.failed)}>
                {step.phrase}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
};

const phrases: StepPhrases = {
  write_file: ({ input }) =>
    String((input as { path?: string } | undefined)?.path).endsWith("Calendar.tsx") ? { running: "Делаю календарь", done: "Сделал календарь" } : undefined,
  look_at_app: ({ input }) =>
    (input as { device?: string } | undefined)?.device === "mobile"
      ? { running: "Проверяю на телефоне", done: "Проверил на телефоне" }
      : { running: "Смотрю на приложение", done: "Посмотрел на приложение" },
};

const question = { id: "u1", role: "user" as const, parts: [{ type: "text", text: "Сделай календарь" }] };

const finishedTurn: HistoryMessage[] = [
  question,
  {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: "нужен календарь", state: "done" },
      {
        type: "tool-write_file",
        toolCallId: "call-1",
        state: "output-available",
        input: { path: "src/components/Calendar.tsx", content: '<div className="grid gap-6 lg:grid-cols-7">' },
        output: "ok",
      },
      { type: "step-start" },
      { type: "reasoning", text: "посмотрю на телефоне", state: "done" },
      { type: "tool-look_at_app", toolCallId: "call-2", state: "output-available", input: { device: "mobile" }, output: { screenshot: "…" } },
      { type: "step-start" },
      { type: "text", text: "Календарь готов.", state: "done" },
    ],
    metadata: { status: "complete", reasoningDurationsMs: { "0": 4000, "1": 2000 } },
  },
];

describe("AgentChat: простой и подробный вид работы агента", () => {
  it("по умолчанию — подробный вид, как раньше: мысли и строки инструментов", async () => {
    renderAgentChat(fakeChatServer({ history: finishedTurn }), { skin: simpleSkin, stepPhrases: phrases });
    const feed = await screen.findByTestId("feed");
    await waitFor(() => expect(kinds(feed)).toEqual(["user", "agent", "reasoning", "tool", "reasoning", "tool", "text"]));
  });

  it("простой вид после хода: одна строка «Сделано N шагов», раскрытие — понятные фразы без кода и путей", async () => {
    renderAgentChat(fakeChatServer({ history: finishedTurn }), { skin: simpleSkin, workView: "simple", stepPhrases: phrases });
    const feed = await screen.findByTestId("feed");
    await waitFor(() => expect(kinds(feed)).toEqual(["user", "agent", "work-done", "text"]));
    expect(feed.textContent).toContain("Сделано 2 шага");
    expect(feed.textContent).not.toContain("Думал");
    fireEvent.click(screen.getByRole("button", { name: "Сделано 2 шага" }));
    await waitFor(() => expect([...feed.querySelectorAll('[data-kind="work-step"]')].map((step) => step.textContent)).toEqual(["Сделал календарь", "Проверил на телефоне"]));
    expect(feed.textContent).not.toMatch(/Calendar\.tsx|className|write_file|look_at_app/);
  });

  it("режим меняется на лету, без перезагрузки чата", async () => {
    const server = fakeChatServer({ history: finishedTurn });
    const view = renderAgentChat(server, { skin: simpleSkin, workView: "simple", stepPhrases: phrases });
    const feed = await screen.findByTestId("feed");
    await waitFor(() => expect(kinds(feed)).toContain("work-done"));
    const historyLoads = server.requests.length;
    view.rerender(<AgentChat api="/api/chat" chatId="c1" skin={simpleSkin} workView="detailed" stepPhrases={phrases} />);
    await waitFor(() => expect(kinds(feed)).toEqual(["user", "agent", "reasoning", "tool", "reasoning", "tool", "text"]));
    view.rerender(<AgentChat api="/api/chat" chatId="c1" skin={simpleSkin} workView="simple" stepPhrases={phrases} />);
    await waitFor(() => expect(kinds(feed)).toEqual(["user", "agent", "work-done", "text"]));
    expect(server.requests.length).toBe(historyLoads);
  });

  it("во время хода — одна живая строка с текущим шагом; текст ответа сворачивает шаги", async () => {
    const server = fakeChatServer();
    renderAgentChat(server, { skin: simpleSkin, workView: "simple", stepPhrases: phrases });
    const stream = await sendQuestion(server, "Сделай календарь");
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "start-step" });
    stream.push({ type: "reasoning-start", id: "r1" });
    stream.push({ type: "reasoning-delta", id: "r1", delta: "думаю" });
    await waitFor(() => expect(screen.getByText("Думаю…").getAttribute("data-kind")).toBe("work-live"));

    stream.push({ type: "reasoning-end", id: "r1" });
    stream.push({ type: "tool-input-start", toolCallId: "call-1", toolName: "write_file" });
    stream.push({ type: "tool-input-available", toolCallId: "call-1", toolName: "write_file", input: { path: "src/components/Calendar.tsx", content: "<div/>" } });
    await waitFor(() => expect(document.querySelector('[data-kind="work-live"]')?.textContent).toBe("Делаю календарь…"));
    expect(document.querySelectorAll('[data-kind="work-live"]')).toHaveLength(1);
    expect(kinds(document.body)).not.toContain("tool");
    expect(kinds(document.body)).not.toContain("reasoning");

    stream.push({ type: "tool-output-available", toolCallId: "call-1", output: "ok" });
    stream.push({ type: "finish-step" });
    stream.push({ type: "start-step" });
    stream.push({ type: "tool-input-available", toolCallId: "call-2", toolName: "look_at_app", input: { device: "mobile" } });
    await waitFor(() => expect(document.querySelector('[data-kind="work-live"]')?.textContent).toBe("Проверяю на телефоне…"));

    stream.push({ type: "tool-output-available", toolCallId: "call-2", output: "ok" });
    stream.push({ type: "finish-step" });
    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t1" });
    stream.push({ type: "text-delta", id: "t1", delta: "Календарь готов." });
    await waitFor(() => expect(kinds(document.body)).toEqual(["user", "agent", "work-done", "text"]));
    stream.push({ type: "text-end", id: "t1" });
    act(() => stream.end());
  });

  it("подтверждение опасного действия, виджет и ошибка ответа видны как обычно", async () => {
    const history: HistoryMessage[] = [
      question,
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "step-start" },
          { type: "tool-write_file", toolCallId: "call-1", state: "output-available", input: { path: "src/components/Calendar.tsx" }, output: "ok" },
          { type: "tool-delete_folder", toolCallId: "call-2", state: "approval-requested", input: { folder: "старое" }, approval: { id: "ap1" } },
        ],
        metadata: { status: "awaiting_approval", reasoningDurationsMs: {} },
      },
    ];
    renderAgentChat(fakeChatServer({ history }), { skin: simpleSkin, workView: "simple", stepPhrases: phrases });
    const feed = await screen.findByTestId("feed");
    await waitFor(() => expect(kinds(feed)).toEqual(["user", "agent", "work-done", "tool"]));
    const approvalRow = feed.querySelector('[data-kind="tool"]')!;
    expect(approvalRow.getAttribute("data-approval")).toBe("requested");
    expect(screen.getByRole("button", { name: "allow" })).toBeTruthy();
  });

  it("ждущий виджет-вопрос не сворачивается", async () => {
    const history: HistoryMessage[] = [
      question,
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "step-start" },
          { type: "tool-look_at_app", toolCallId: "call-1", state: "output-available", input: {}, output: "ok" },
          { type: "tool-ask_choice", toolCallId: "w1", state: "input-available", input: { question: "Какой цвет?", options: ["Синий", "Зелёный"] } },
        ],
        metadata: { status: "awaiting_approval", reasoningDurationsMs: {} },
      },
    ];
    renderAgentChat(fakeChatServer({ history }), { skin: simpleSkin, workView: "simple", stepPhrases: phrases });
    const feed = await screen.findByTestId("feed");
    await waitFor(() => expect(kinds(feed)).toEqual(["user", "agent", "work-done", "widget"]));
  });

  it("ошибка функции фраз не ломает чат: общая фраза", async () => {
    const broken: StepPhrases = {
      ...phrases,
      write_file: () => {
        throw new Error("boom");
      },
    };
    renderAgentChat(fakeChatServer({ history: finishedTurn }), { skin: simpleSkin, workView: "simple", stepPhrases: broken });
    const feed = await screen.findByTestId("feed");
    await waitFor(() => expect(kinds(feed)).toContain("work-done"));
    fireEvent.click(screen.getByRole("button", { name: "Сделано 2 шага" }));
    await waitFor(() => expect([...feed.querySelectorAll('[data-kind="work-step"]')].map((step) => step.textContent)).toEqual(["Сделал шаг", "Проверил на телефоне"]));
  });

  it("помощник без подтверждения — шаг с фразой по его названию", async () => {
    const history: HistoryMessage[] = [
      question,
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "step-start" },
          {
            type: "tool-helper_researcher",
            toolCallId: "call-h",
            state: "output-available",
            input: { task: "Найди статьи" },
            output: { task: "Найди статьи", steps: [], text: "Нашёл", status: "done" },
          },
          { type: "text", text: "Вот статьи.", state: "done" },
        ],
        metadata: { status: "complete", reasoningDurationsMs: {} },
      },
    ];
    renderAgentChat(fakeChatServer({ history }), { skin: simpleSkin, workView: "simple" });
    const feed = await screen.findByTestId("feed");
    await waitFor(() => expect(kinds(feed)).toEqual(["user", "agent", "work-done", "text"]));
    fireEvent.click(screen.getByRole("button", { name: "Сделан 1 шаг" }));
    await waitFor(() => expect(feed.querySelector('[data-kind="work-step"]')?.textContent).toBe("Помощник «researcher» закончил"));
  });

  it("скин без WorkSteps (до версии 23): строка инструмента с «Сделано N шагов», список фраз — в результате, без входа", async () => {
    renderAgentChat(fakeChatServer({ history: finishedTurn }), { skin: stubSkin, workView: "simple", stepPhrases: phrases });
    const feed = await screen.findByTestId("feed");
    await waitFor(() => expect(kinds(feed)).toEqual(["user", "agent", "tool", "text"]));
    const row = feed.querySelector('[data-kind="tool"]')!;
    expect(row.getAttribute("data-title")).toBe("Сделано 2 шага");
    expect(row.getAttribute("data-input")).toBe("");
    expect(row.getAttribute("data-output")).toBe(JSON.stringify("Сделал календарь\nПроверил на телефоне"));
  });
});
