// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramsClient } from "../src/agent-chat-extensions";
import { splitMermaidBlocks } from "../src/diagrams/mermaid-blocks";
import type { ChatSkin, DiagramColors, MediaViewerProps } from "../src/skin-contract";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, sendQuestion, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";
import { leaveViewerHistory } from "./support/viewer-history";

setupChatDom();

const fence = "\x60\x60\x60";
const mermaid = (source: string) => `${fence}mermaid\n${source}\n${fence}`;

beforeEach(leaveViewerHistory);
afterEach(() => document.documentElement.classList.remove("dark"));

const lightColors: DiagramColors = { background: "#fff", text: "#111", line: "#555", node: "#eee", accent: "#06c", dark: false };
const darkColors: DiagramColors = { background: "#111", text: "#eee", line: "#aaa", node: "#222", accent: "#4af", dark: true };

function fakeDiagrams() {
  const render = vi.fn(async (source: string, colors: DiagramColors) =>
    source.includes("ошибка") ? { error: "Parse error" } : { svg: `<svg data-dark="${colors.dark}">${source}</svg>` },
  );
  return { client: { render } satisfies DiagramsClient, render };
}

/** Скин-проба: блоки схем рисуются по `renderDiagram`, готовая схема — кнопкой «открыть N». */
const AgentText: ChatSkin["AgentText"] = ({ markdown, renderDiagram, onOpenDiagram }) => {
  if (!renderDiagram) return <div data-kind="text" data-plain="">{markdown}</div>;
  let blockIndex = 0;
  return (
    <div data-kind="text">
      {splitMermaidBlocks(markdown).map((segment, index) => {
        if (segment.kind === "markdown") return <p key={index}>{segment.markdown}</p>;
        const n = blockIndex++;
        const view = renderDiagram(segment.source, n);
        return (
          <figure key={index} data-diagram={n} data-state={view.state} {...(view.state !== "streaming" && { "data-source": view.source })} {...(view.state === "ready" && { "data-svg": view.svg })}>
            {onOpenDiagram && view.state === "ready" && (
              <button type="button" onClick={(event) => onOpenDiagram(n, event.currentTarget)}>
                открыть {n}
              </button>
            )}
          </figure>
        );
      })}
    </div>
  );
};
function MediaViewer({ items, onClose }: MediaViewerProps) {
  return (
    <div role="dialog" data-keys={items.map((item) => item.key).join(",")} data-kinds={items.map((item) => item.kind).join(",")}>
      {items.map((item) => (item.kind === "diagram" ? <output key={item.key}>{item.source}</output> : null))}
      <button type="button" onClick={onClose}>
        закрыть
      </button>
    </div>
  );
}
const diagramColors = (dark: boolean) => (dark ? darkColors : lightColors);
const skin: ChatSkin = { ...stubSkin, AgentText, MediaViewer, diagramColors };

const answer = (id: string, ...texts: string[]): HistoryMessage => ({
  id,
  role: "assistant",
  parts: texts.map((text) => ({ type: "text", text, state: "done" })),
  metadata: { status: "complete" },
});
const history: HistoryMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Нарисуй" }] },
  answer("m2", `Вот так:\n${mermaid("graph TD\nA-->B")}`, `И ещё:\n${mermaid("graph TD\nC-->D")}`),
  { id: "u3", role: "user", parts: [{ type: "text", text: "Сломай" }] },
  answer("m4", mermaid("graph TD\nошибка")),
];

const figure = (key: string) => document.querySelector<HTMLElement>(`[data-diagram="${key}"]`);
const figuresOf = (messageText: string) => [...(screen.getByText(messageText).closest("[data-kind=text]")?.querySelectorAll("figure") ?? [])];

describe("AgentChat: схемы в ответе (T037)", () => {
  it("без diagrams блок ```mermaid — обычный код: renderDiagram скину не передаётся", async () => {
    renderAgentChat(fakeChatServer({ history }), { skin });
    await screen.findByText("Сломай");
    expect(document.querySelectorAll("[data-plain]").length).toBeGreaterThan(0);
    expect(document.querySelector("figure")).toBeNull();
  });

  it("закрытые блоки рисуются в цветах скина: ready со svg, ошибка — failed с исходником", async () => {
    const { client, render } = fakeDiagrams();
    renderAgentChat(fakeChatServer({ history }), { skin, diagrams: client });
    await screen.findByText("Сломай");
    await waitFor(() => expect(document.querySelectorAll('figure[data-state="streaming"]')).toHaveLength(0));
    const [first] = figuresOf("Вот так:");
    expect(first!.dataset.state).toBe("ready");
    expect(first!.dataset.svg).toBe('<svg data-dark="false">graph TD\nA-->B</svg>');
    const failed = document.querySelector<HTMLElement>('figure[data-state="failed"]')!;
    expect(failed.dataset.source).toBe("graph TD\nошибка");
    expect(render).toHaveBeenCalledWith("graph TD\nA-->B", lightColors);
    expect(render).toHaveBeenCalledTimes(3);
  });

  it("клик открывает окно просмотра с одной схемой; ключ — <messageId>:<номер блока в ответе>", async () => {
    const { client } = fakeDiagrams();
    renderAgentChat(fakeChatServer({ history }), { skin, diagrams: client });
    await screen.findByText("Сломай");
    const second = await waitFor(() => figuresOf("И ещё:")[0]!.querySelector("button")!);
    fireEvent.click(second);
    const dialog = screen.getByRole("dialog");
    expect(dialog.dataset.keys).toBe("m2:1");
    expect(dialog.dataset.kinds).toBe("diagram");
    expect(dialog.querySelector("output")?.textContent).toBe("graph TD\nC-->D");
    fireEvent.click(screen.getByText("закрыть"));
    expect(document.activeElement).toBe(second);
  });

  it("скин без окна просмотра: onOpenDiagram нет, схема всё равно рисуется", async () => {
    const { client } = fakeDiagrams();
    const { MediaViewer: _viewer, ...withoutViewer } = skin;
    renderAgentChat(fakeChatServer({ history }), { skin: withoutViewer, diagrams: client });
    await waitFor(() => expect(figuresOf("Вот так:")[0]?.dataset.state).toBe("ready"));
    expect(screen.queryByText(/открыть/)).toBeNull();
  });

  it("скин без diagramColors: рисовальщик получает цвета по умолчанию", async () => {
    const { client, render } = fakeDiagrams();
    const { diagramColors: _colors, ...withoutColors } = skin;
    renderAgentChat(fakeChatServer({ history }), { skin: withoutColors, diagrams: client });
    await waitFor(() => expect(render).toHaveBeenCalled());
    expect(render.mock.calls[0]![1]).toMatchObject({ dark: false, background: expect.any(String), text: expect.any(String) });
  });

  it("смена темы перерисовывает схему в тёмных цветах (FR-028)", async () => {
    const { client, render } = fakeDiagrams();
    renderAgentChat(fakeChatServer({ history }), { skin, diagrams: client });
    await waitFor(() => expect(figuresOf("Вот так:")[0]?.dataset.state).toBe("ready"));
    act(() => document.documentElement.classList.add("dark"));
    await waitFor(() => expect(figuresOf("Вот так:")[0]?.dataset.svg).toBe('<svg data-dark="true">graph TD\nA-->B</svg>'));
    expect(render).toHaveBeenCalledWith("graph TD\nA-->B", darkColors);
  });

  it("пока ответ печатается и блок не закрыт — streaming без рисования; закрылся — рисуется, не дожидаясь конца ответа", async () => {
    const { client, render } = fakeDiagrams();
    const server = fakeChatServer({ history: [] });
    renderAgentChat(server, { skin, diagrams: client });
    const stream = await sendQuestion(server, "Нарисуй процесс");
    stream.push({ type: "start", messageId: "a1", messageMetadata: { status: "streaming" } });
    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t1" });
    stream.push({ type: "text-delta", id: "t1", delta: `Схема:\n${fence}mermaid\ngraph TD\nA-->` });
    await waitFor(() => expect(figure("0")?.dataset.state).toBe("streaming"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(render).not.toHaveBeenCalled();

    stream.push({ type: "text-delta", id: "t1", delta: `B\n${fence}\nДальше текст` });
    await waitFor(() => expect(figure("0")?.dataset.state).toBe("ready"));
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith("graph TD\nA-->B", lightColors);
    stream.finish("t1");
  });

  it("одна схема в двух сообщениях и в окне просмотра: id в странице не повторяются, ссылки каждой вставки ведут в свой рисунок", async () => {
    const drawing = (source: string) =>
      `<svg id="agent-chat-diagram-1" viewBox="0 0 10 10"><style>#agent-chat-diagram-1 .n{fill:red}#agent-chat-diagram-1 path{stroke:url(#grad)}</style>` +
      `<defs><linearGradient id="grad"/><marker id="agent-chat-diagram-1_arrow"><path d="M0 0"/></marker></defs>` +
      `<path class="n" marker-end="url(#agent-chat-diagram-1_arrow)"/><use href="#agent-chat-diagram-1_arrow"/><text>${source}</text></svg>`;
    const client: DiagramsClient = { render: async (source) => ({ svg: drawing(source) }) };
    const InsertingText: ChatSkin["AgentText"] = ({ markdown, renderDiagram, onOpenDiagram }) => {
      let blockIndex = 0;
      return (
        <div data-kind="text">
          {splitMermaidBlocks(markdown).map((segment, index) => {
            if (segment.kind === "markdown") return <p key={index}>{segment.markdown}</p>;
            const n = blockIndex++;
            const view = renderDiagram!(segment.source, n);
            return view.state === "ready" ? (
              <figure key={index} data-state="ready">
                <div dangerouslySetInnerHTML={{ __html: view.svg }} />
                <button type="button" onClick={(event) => onOpenDiagram?.(n, event.currentTarget)}>
                  открыть
                </button>
              </figure>
            ) : (
              <figure key={index} data-state={view.state} />
            );
          })}
        </div>
      );
    };
    const InsertingViewer = ({ items }: MediaViewerProps) => (
      <div role="dialog">{items.map((item) => (item.kind === "diagram" ? <div key={item.key} dangerouslySetInnerHTML={{ __html: item.svg }} /> : null))}</div>
    );
    const twice: HistoryMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Нарисуй" }] },
      answer("m2", `Первая:\n${mermaid("graph TD\nA-->B")}`),
      { id: "u3", role: "user", parts: [{ type: "text", text: "Ещё раз" }] },
      answer("m4", `Вторая:\n${mermaid("graph TD\nA-->B")}`),
    ];
    renderAgentChat(fakeChatServer({ history: twice }), { skin: { ...skin, AgentText: InsertingText, MediaViewer: InsertingViewer }, diagrams: client });
    await waitFor(() => expect(document.querySelectorAll('figure[data-state="ready"]')).toHaveLength(2));
    fireEvent.click(screen.getAllByText("открыть")[0]!);
    await screen.findByRole("dialog");

    const svgs = [...document.querySelectorAll("svg")];
    expect(svgs).toHaveLength(3);
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const svg of svgs) {
      const references = [
        ...[...svg.querySelectorAll("*")].flatMap((element) =>
          [...element.attributes].flatMap(({ value }) => [...value.matchAll(/url\(#([^)]+)\)|^#(.+)$/g)].map((match) => match[1] ?? match[2]!)),
        ),
        ...[...(svg.querySelector("style")?.textContent ?? "").matchAll(/#([\w-]+)/g)].map((match) => match[1]!),
      ];
      expect(references.length).toBeGreaterThanOrEqual(5);
      for (const id of references) expect(svg.id === id || svg.querySelector(`[id="${id}"]`) !== null, `#${id} в своём рисунке`).toBe(true);
    }
  });
});
