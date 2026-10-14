// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { RefObject } from "react";
import { describe, expect, it } from "vitest";
import type { ChatSkin } from "../src/skin-contract";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { kinds, renderAgentChat, sendQuestion, settle, setupChatDom, waitForFeedPositioned, waitForFeedScrollEnd } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";

const answered: HistoryMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Сколько будет 2+2?" }] },
  {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: "Складываю", state: "done" },
      { type: "text", text: "**4**", state: "done" },
    ],
    metadata: { status: "complete", reasoningDurationsMs: { "0": 2000 } },
  },
];

setupChatDom();

describe("AgentChat со скином-заглушкой", () => {
  it("рисует части ответа компонентами скина в порядке прихода; durationMs из метаданных", async () => {
    renderAgentChat(fakeChatServer({ history: answered }));
    const feed = await screen.findByTestId("feed");
    await waitFor(() => expect(kinds(feed)).toEqual(["user", "agent", "reasoning", "text"]));

    expect(feed.querySelector('[data-kind="user"]')?.textContent).toBe("Сколько будет 2+2?");
    const agent = feed.querySelector('[data-kind="agent"]');
    expect(agent?.getAttribute("data-status")).toBe("complete");
    expect(agent?.getAttribute("data-empty")).toBe("false");
    const reasoning = feed.querySelector('[data-kind="reasoning"]');
    expect(reasoning?.getAttribute("data-duration")).toBe("2000");
    expect(reasoning?.textContent).toBe("Складываю");
    expect(feed.querySelector('[data-kind="text"]')?.textContent).toBe("**4**");
  });

  it("выбор модели не показывает модель по умолчанию, пока история чата не загрузилась", async () => {
    const server = fakeChatServer();
    server.state.chatChoice = { modelId: "glm-5.3-flash", providerId: "fireworks", reasoning: "high" };
    server.state.hang.add("history");
    renderAgentChat(server);
    await waitFor(() => expect(server.requestsTo("history")).toHaveLength(1));
    await settle();
    // Меню — после истории: права (в том числе modelDetails) приходят с ней.
    expect(server.requestsTo("models")).toHaveLength(0);
    expect(screen.queryByLabelText("модель")).toBeNull();
  });

  it("выбор модели показывает выбор чата, как только история загрузилась", async () => {
    const server = fakeChatServer();
    server.state.chatChoice = { modelId: "glm-5.3-flash", providerId: "fireworks", reasoning: "high" };
    renderAgentChat(server);
    const picker = await screen.findByLabelText("модель");
    expect((picker as HTMLSelectElement).value).toBe("fireworks/glm-5.3-flash");
  });

  it("ответ из одних рассуждений — empty: true", async () => {
    const history: HistoryMessage[] = [
      answered[0]!,
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "reasoning", text: "Подумал", state: "done" }],
        metadata: { status: "complete", reasoningDurationsMs: { "0": 500 } },
      },
    ];
    renderAgentChat(fakeChatServer({ history }));
    await waitFor(() => expect(document.querySelector('[data-kind="agent"]')?.getAttribute("data-empty")).toBe("true"));
  });

  it("во время хода Reasoning получает durationMs: null, AgentMessage — status streaming", async () => {
    const server = fakeChatServer();
    renderAgentChat(server);
    const stream = await sendQuestion(server, "Вопрос");
    stream.push({ type: "start", messageId: "a1", messageMetadata: { modelId: "m", providerId: "p" } });
    stream.push({ type: "start-step" });
    stream.push({ type: "reasoning-start", id: "reasoning-0" });
    stream.push({ type: "reasoning-delta", id: "reasoning-0", delta: "Думаю" });

    await waitFor(() => expect(document.querySelector('[data-kind="reasoning"]')?.textContent).toBe("Думаю"));
    const reasoning = document.querySelector('[data-kind="reasoning"]');
    expect(reasoning?.getAttribute("data-duration")).toBe("null");
    expect(reasoning?.getAttribute("data-streaming")).toBe("true");
    expect(document.querySelector('[data-kind="agent"]')?.getAttribute("data-status")).toBe("streaming");
    expect(kinds(document.body)).toEqual(["user", "agent", "reasoning"]);

    stream.push({ type: "reasoning-end", id: "reasoning-0" });
    stream.push({ type: "message-metadata", messageMetadata: { reasoningDurationsMs: { "0": 1200 } } });
    await waitFor(() =>
      expect(document.querySelector('[data-kind="reasoning"]')?.getAttribute("data-duration")).toBe("1200"),
    );
    stream.end();
  });
});

/** Длинный чат: пары вопрос–ответ, у каждого ответа рассуждение и вызов инструмента. */
function longHistory(pairs: number): HistoryMessage[] {
  return Array.from({ length: pairs }, (_, index): HistoryMessage[] => [
    { id: `u${index}`, role: "user", parts: [{ type: "text", text: `вопрос ${index}` }] },
    {
      id: `a${index}`,
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "reasoning", text: `думаю ${index}`, state: "done" },
        {
          type: "tool-current_time",
          toolCallId: `call-${index}`,
          state: "output-available",
          input: { timeZone: "Asia/Tokyo" },
          output: "15:00",
        },
        { type: "text", text: `ответ ${index}`, state: "done" },
      ],
      metadata: { status: "complete", reasoningDurationsMs: { "0": 1000 } },
    },
  ]).flat();
}

const scroller = () => screen.getByTestId("scroller");
const byText = (kind: string, text: string) =>
  [...document.querySelectorAll<HTMLElement>(`[data-kind="${kind}"]`)].find((element) => element.textContent?.includes(text));

async function scrollFeedTo(top: number | "bottom") {
  await act(async () => {
    scroller().scrollTop = top === "bottom" ? scroller().scrollHeight : top;
  });
  await settle();
}

async function renderLongChat(pairs: number, skin: ChatSkin = stubSkin) {
  const server = fakeChatServer({ history: longHistory(pairs) });
  renderAgentChat(server, { skin });
  await waitFor(() => expect(document.querySelector('[data-kind="agent"]')).not.toBeNull());
  await settle();
  await waitForFeedPositioned();
  return server;
}

describe("договор скина версии 2: лента и раскрытие", () => {
  it("Layout получает scrollRef на свой скроллер, лента лежит внутри него", async () => {
    let received: RefObject<HTMLDivElement | null> | undefined;
    const Layout: ChatSkin["Layout"] = (props) => {
      received = props.scrollRef;
      return <stubSkin.Layout {...props} />;
    };
    await renderLongChat(50, { ...stubSkin, Layout });

    expect(received?.current).toBe(scroller());
    expect(scroller().contains(screen.getByTestId("feed"))).toBe(true);
    expect(scroller().querySelectorAll("[data-feed-item]").length).toBeGreaterThan(0);
    expect(screen.getByTestId("feed").getAttribute("role")).toBe("log");
    expect(screen.getByTestId("feed").getAttribute("aria-live")).toBe("off");
  });

  it("Reasoning и ToolCallRow получают open: false и onOpenChange; нажатие раскрывает", async () => {
    await renderLongChat(50);
    const reasoning = byText("reasoning", "думаю 49")!;
    const tool = [...document.querySelectorAll<HTMLElement>('[data-kind="tool"]')].at(-1)!;
    expect(reasoning.getAttribute("data-open")).toBe("false");
    expect(tool.getAttribute("data-open")).toBe("false");

    fireEvent.click(reasoning.querySelector("button")!);
    fireEvent.click(tool.querySelector("button")!);

    expect(byText("reasoning", "думаю 49")!.getAttribute("data-open")).toBe("true");
    expect(tool.getAttribute("data-open")).toBe("true");
    expect(reasoning.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
  });

  it("раскрытое переживает уход ответа из окна ленты и возвращение (FR-006)", async () => {
    await renderLongChat(50);
    await scrollFeedTo(0);
    const reasoning = byText("reasoning", "думаю 0")!;
    fireEvent.click(reasoning.querySelector("button")!);
    fireEvent.click(document.querySelector('[data-kind="tool"] button')!);
    expect(byText("reasoning", "думаю 0")!.getAttribute("data-open")).toBe("true");

    await scrollFeedTo("bottom");
    expect(byText("reasoning", "думаю 0")).toBeUndefined();

    await scrollFeedTo(0);
    expect(byText("reasoning", "думаю 0")!.getAttribute("data-open")).toBe("true");
    expect(document.querySelector('[data-kind="tool"]')!.getAttribute("data-open")).toBe("true");
    // Соседние части остались свёрнутыми.
    expect(byText("reasoning", "думаю 1")!.getAttribute("data-open")).toBe("false");
  });

  it("готовые сообщения не перерисовываются, пока растёт ответ (FR-005)", async () => {
    const renders = new Map<string, number>();
    const UserMessage: ChatSkin["UserMessage"] = ({ text }) => {
      renders.set(text, (renders.get(text) ?? 0) + 1);
      return <p data-kind="user">{text}</p>;
    };
    const server = await renderLongChat(50, { ...stubSkin, UserMessage });
    const stream = await sendQuestion(server, "новый вопрос");
    stream.push({ type: "start", messageId: "a-new", messageMetadata: { status: "streaming" } });
    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t1" });
    stream.push({ type: "text-delta", id: "t1", delta: "Пер" });
    await waitFor(() => expect(byText("text", "Пер")).toBeDefined());
    const before = new Map(renders);
    expect(before.size).toBeGreaterThan(3);

    for (const delta of ["вое", " слово", " второе", " третье"]) {
      stream.push({ type: "text-delta", id: "t1", delta });
      await settle();
    }
    await waitFor(() => expect(byText("text", "Первое слово второе третье")).toBeDefined());

    for (const [text, count] of before) expect([text, renders.get(text)]).toEqual([text, count]);
    stream.finish("t1");
  });

  // Пока лента едет вниз, окно ленты (virtua) не держит запаса над экраном и возвращает его через 150 мс тишины:
  // куски ответа реже этого срока снимали бы готовые сообщения над экраном и рисовали их заново.
  it("готовые сообщения не перерисовываются, когда куски ответа приходят с паузами (FR-005)", async () => {
    const renders = new Map<string, number>();
    const UserMessage: ChatSkin["UserMessage"] = ({ text }) => {
      renders.set(text, (renders.get(text) ?? 0) + 1);
      return <p data-kind="user">{text}</p>;
    };
    const server = await renderLongChat(50, { ...stubSkin, UserMessage });
    const stream = await sendQuestion(server, "новый вопрос");
    stream.push({ type: "start", messageId: "a-new", messageMetadata: { status: "streaming" } });
    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t1" });
    stream.push({ type: "text-delta", id: "t1", delta: "Пер" });
    await waitFor(() => expect(byText("text", "Пер")).toBeDefined());
    const before = new Map(renders);

    for (const delta of ["вое", " слово", " второе"]) {
      await waitForFeedScrollEnd();
      stream.push({ type: "text-delta", id: "t1", delta });
      await settle();
    }
    await waitFor(() => expect(byText("text", "Первое слово второе")).toBeDefined());

    for (const [text, count] of before) expect([text, renders.get(text)]).toEqual([text, count]);
    stream.finish("t1");
  });

  it("после ответа announcement — его текст; пока ответ идёт, он пуст (FR-009)", async () => {
    const server = await renderLongChat(5);
    expect(screen.getByTestId("announcement").textContent).toBe("");
    const stream = await sendQuestion(server, "Сколько будет 2+2?");

    stream.push({ type: "start", messageId: "a-new", messageMetadata: { status: "streaming" } });
    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t1" });
    stream.push({ type: "text-delta", id: "t1", delta: "Чет" });
    await waitFor(() => expect(byText("text", "Чет")).toBeDefined());
    expect(screen.getByTestId("announcement").textContent).toBe("");

    stream.push({ type: "text-delta", id: "t1", delta: "ыре" });
    stream.finish("t1");

    await waitFor(() => expect(screen.getByTestId("announcement").textContent).toBe("Четыре"));
  });
});
