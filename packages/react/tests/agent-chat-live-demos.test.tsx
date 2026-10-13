// @vitest-environment jsdom
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { splitAnswerFences } from "../src/live-demos/answer-fences";
import type { ChatSkin, DiagramColors, LiveDemoColors } from "../src/skin-contract";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, renderChatHook, sendQuestion, setupChatDom, submitQuestion } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";

setupChatDom();
afterEach(() => document.documentElement.classList.remove("dark"));

const fence = "\x60\x60\x60";
const demo = (source: string) => `${fence}html-demo\n${source}\n${fence}`;
const mermaid = (source: string) => `${fence}mermaid\n${source}\n${fence}`;

const lightDemo: LiveDemoColors = { background: "#fafafa", surface: "#eee", text: "#111", muted: "#666", border: "#ccc", accent: "#06c", onAccent: "#fff", dark: false };
const darkDemo: LiveDemoColors = { ...lightDemo, background: "#0b0b0b", text: "#eee", dark: true };
const diagramColors = (dark: boolean): DiagramColors => ({ background: dark ? "#000" : "#fff", text: "#111", line: "#555", node: "#eee", accent: "#06c", dark });

/** Скин-проба: демонстрации по `renderDemo` — `figure[data-demo]` с состоянием, рамкой или причиной показа кодом. */
const AgentText: ChatSkin["AgentText"] = ({ markdown, renderDemo, renderDiagram }) => {
  if (!renderDemo && !renderDiagram) return <div data-kind="text" data-plain="">{markdown}</div>;
  const counters = { demo: 0, mermaid: 0 };
  return (
    <div data-kind="text">
      {splitAnswerFences(markdown, { diagrams: Boolean(renderDiagram), demos: Boolean(renderDemo) }).map((segment, index) => {
        if (segment.kind === "markdown") return <p key={index}>{segment.markdown}</p>;
        if (segment.kind === "mermaid") return <figure key={index} data-diagram={counters.mermaid++} data-state={renderDiagram!(segment.source, counters.mermaid - 1).state} />;
        const n = counters.demo++;
        const view = renderDemo!(segment.source, n);
        return (
          <figure key={index} data-demo={n} data-state={view.state} {...(view.state === "code" && { "data-reason": view.reason, "data-source": view.source })}>
            {view.state === "ready" && view.frame}
          </figure>
        );
      })}
    </div>
  );
};
const skin: ChatSkin = { ...stubSkin, AgentText, demoColors: (dark) => (dark ? darkDemo : lightDemo), diagramColors };

const answer = (id: string, ...texts: string[]): HistoryMessage => ({ id, role: "assistant", parts: texts.map((text) => ({ type: "text", text, state: "done" })), metadata: { status: "complete" } });
const slider = '<input type="range"><output>0.7</output><script>/* меняет текст */</script>';
const history: HistoryMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Покажи" }] },
  answer("m2", `Подвигайте:\n${demo(slider)}\n${mermaid("graph TD\nA-->B")}\nИ ещё:\n${demo("<b>два</b>")}`),
  { id: "u3", role: "user", parts: [{ type: "text", text: "Большую" }] },
  answer("m4", `Вот:\n${demo(`<p>${"a".repeat(31_000)}</p>`)}`),
  { id: "u5", role: "user", parts: [{ type: "text", text: "Оборванную" }] },
  answer("m6", `Обрыв:\n${fence}html-demo\n<p>не дописано`),
];

/** Документ с кодом модели — вложенная рамка внутри промежуточного документа. */
const demoSource = (frame: Element) => JSON.parse(/f\.srcdoc=("(?:[^"\\]|\\.)*");/.exec(frame.getAttribute("srcdoc")!)![1]!) as string;
const demoFigure = (n: number, near: string) => screen.getByText(near).closest("[data-kind=text]")!.querySelector<HTMLElement>(`figure[data-demo="${n}"]`);

describe("AgentChat: живые демонстрации в ответе (043)", () => {
  it("без liveDemos блок ```html-demo — обычный код: renderDemo скину не передаётся", async () => {
    renderAgentChat(fakeChatServer({ history }), { skin });
    await screen.findByText("Большую");
    expect(document.querySelector("figure[data-demo]")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("закрытый блок — ready с рамкой слоя поведения: sandbox, код в srcdoc, цвета скина; схемы рядом нумеруются как прежде", async () => {
    renderAgentChat(fakeChatServer({ history }), { skin, liveDemos: true, diagrams: { render: async () => ({ svg: "<svg/>" }) } });
    await screen.findByText("Большую");
    const first = demoFigure(0, "Подвигайте:")!;
    expect(first.dataset.state).toBe("ready");
    const frame = first.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(demoSource(frame)).toContain(slider);
    expect(demoSource(frame)).toContain("--bg:#fafafa");
    expect(frame.getAttribute("title")).toBe("Живая демонстрация");
    expect(demoSource(demoFigure(1, "Подвигайте:")!.querySelector("iframe")!)).toContain("<b>два</b>");
    expect(document.querySelector('figure[data-diagram="0"]')).not.toBeNull();
  });

  it("больше 30 КБ — кодом с причиной tooLarge; незакрытый блок в готовом ответе — кодом с причиной unfinished", async () => {
    renderAgentChat(fakeChatServer({ history }), { skin, liveDemos: true });
    await screen.findByText("Оборванную");
    const large = demoFigure(0, "Вот:")!;
    expect(large.dataset.state).toBe("code");
    expect(large.dataset.reason).toBe("tooLarge");
    expect(large.querySelector("iframe")).toBeNull();
    const cut = demoFigure(0, "Обрыв:")!;
    expect(cut.dataset.reason).toBe("unfinished");
    expect(cut.dataset.source).toBe("<p>не дописано");
  });

  it("скин без demoColors — цвета по умолчанию; смена темы — документ рамки в тёмных цветах", async () => {
    const { demoColors: _colors, ...withoutColors } = skin;
    renderAgentChat(fakeChatServer({ history }), { skin: withoutColors, liveDemos: true });
    await screen.findByText("Большую");
    expect(demoFigure(0, "Подвигайте:")!.querySelector("iframe")!.getAttribute("srcdoc")).toContain("color-scheme:light");
    act(() => document.documentElement.classList.add("dark"));
    await waitFor(() => expect(demoFigure(0, "Подвигайте:")!.querySelector("iframe")!.getAttribute("srcdoc")).toContain("color-scheme:dark"));
  });

  it("пока блок не закрыт — streaming без рамки; закрылся — запускается, не дожидаясь конца ответа", async () => {
    const server = fakeChatServer({ history: [] });
    renderAgentChat(server, { skin, liveDemos: true });
    const stream = await sendQuestion(server, "Покажи демонстрацию");
    stream.push({ type: "start", messageId: "a1", messageMetadata: { status: "streaming" } });
    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t1" });
    stream.push({ type: "text-delta", id: "t1", delta: `Смотрите:\n${fence}html-demo\n<p>раз` });
    await waitFor(() => expect(document.querySelector<HTMLElement>('figure[data-demo="0"]')?.dataset.state).toBe("streaming"));
    expect(document.querySelector("iframe")).toBeNull();
    stream.push({ type: "text-delta", id: "t1", delta: `</p>\n${fence}\nДальше` });
    await waitFor(() => expect(document.querySelector<HTMLElement>('figure[data-demo="0"]')?.dataset.state).toBe("ready"));
    expect(demoSource(document.querySelector("iframe")!)).toContain("<p>раз</p>");
    stream.finish("t1");
  });

  it("история с externalContent: ни одна демонстрация не запускается — код с пометкой «чужой текст», рамок нет", async () => {
    const server = fakeChatServer({ history });
    server.state.externalContent = true;
    renderAgentChat(server, { skin, liveDemos: true });
    await screen.findByText("Большую");
    const first = demoFigure(0, "Подвигайте:")!;
    expect(first.dataset.state).toBe("code");
    expect(first.dataset.reason).toBe("externalContent");
    expect(first.dataset.source).toBe(slider);
    expect(document.querySelector("iframe")).toBeNull();
    // Большая и оборванная — по-прежнему со своей причиной: про них пометка точнее.
    expect(demoFigure(0, "Вот:")!.dataset.reason).toBe("tooLarge");
    expect(demoFigure(0, "Обрыв:")!.dataset.reason).toBe("unfinished");
  });

  it("кусок потока data-external-content посреди ответа: демонстрация после него — кодом, и прежние рамки чата гаснут", async () => {
    const server = fakeChatServer({ history });
    renderAgentChat(server, { skin, liveDemos: true });
    await screen.findByText("Большую");
    expect(demoFigure(0, "Подвигайте:")!.dataset.state).toBe("ready");
    const stream = await sendQuestion(server, "Найди в интернете");
    stream.push({ type: "start", messageId: "a1", messageMetadata: { status: "streaming" } });
    stream.push({ type: "start-step" });
    stream.push({ type: "data-external-content", data: true, transient: true });
    stream.push({ type: "text-start", id: "t1" });
    stream.push({ type: "text-delta", id: "t1", delta: `Смотрите:\n${demo("<p>чужое</p>")}\nВсё` });
    await waitFor(() => expect(document.querySelector<HTMLElement>('figure[data-demo="0"][data-reason="externalContent"]')).not.toBeNull());
    await waitFor(() => expect(document.querySelector("iframe")).toBeNull());
    expect(demoFigure(0, "Подвигайте:")!.dataset.reason).toBe("externalContent");
    stream.finish("t1");
  });

  it("ход закончился между историей и подключением: перечитанная история с признаком выключает демонстрации", async () => {
    const server = fakeChatServer({ history, running: true });
    let release!: () => void;
    server.state.gate.stream = new Promise<void>((resolve) => (release = resolve));
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.requestsTo("stream")).toHaveLength(1));
    expect(result.current.externalContent).toBe(false);
    // Пока клиент подключался, ход закончился, и в чат попал чужой текст.
    server.state.running = false;
    server.state.externalContent = true;
    release();
    await waitFor(() => expect(server.requestsTo("history")).toHaveLength(2));
    await waitFor(() => expect(result.current.externalContent).toBe(true));
  });

  it("отказ по лимиту расходов: история, прочитанная после отказа, тоже несёт признак", async () => {
    const server = fakeChatServer({ history });
    renderAgentChat(server, { skin, liveDemos: true, spendingLimits: true, liveness: { reconnectDelaysMs: [0, 0, 0] } });
    await screen.findByText("Большую");
    expect(demoFigure(0, "Подвигайте:")!.dataset.state).toBe("ready");
    server.state.refuseSpending = { scope: "user", period: "month", resetsAt: "2026-11-01T00:00:00.000Z" };
    server.state.externalContent = true;
    submitQuestion("Ещё");
    await waitFor(() => expect(server.requestsTo("history")).toHaveLength(2));
    await waitFor(() => expect(demoFigure(0, "Подвигайте:")!.dataset.reason).toBe("externalContent"));
  });

  it("другой чат: признак прежнего чата сбрасывается", async () => {
    const server = fakeChatServer({ history });
    server.state.externalContent = true;
    const { result, rerender } = renderChatHook(server);
    await waitFor(() => expect(result.current.externalContent).toBe(true));
    server.state.externalContent = false;
    rerender({ chatId: "c2" });
    await waitFor(() => expect(server.requestsTo("history")).toHaveLength(2));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.externalContent).toBe(false);
  });
});
