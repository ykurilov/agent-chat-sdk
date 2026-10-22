// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSkin } from "../src/skin-contract";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, sendQuestion, settle, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";

/** Сколько раз лента отдала окну (Virtualizer) новый рендер: по ней видно, перерисовывалась ли лента. */
const feedRenders = vi.hoisted(() => ({ count: 0 }));

vi.mock("virtua", async (importOriginal) => {
  const actual = await importOriginal<typeof import("virtua")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    Virtualizer: (props: Record<string, unknown>) => {
      feedRenders.count += 1;
      return createElement(actual.Virtualizer as never, props);
    },
  };
});

const history: HistoryMessage[] = Array.from({ length: 10 }, (_, index): HistoryMessage[] => [
  { id: `u${index}`, role: "user", parts: [{ type: "text", text: `вопрос ${index}` }] },
  {
    id: `a${index}`,
    role: "assistant",
    parts: [{ type: "text", text: `ответ ${index}`, state: "done" }],
    metadata: { status: "complete" },
  },
]).flat();

setupChatDom();
beforeEach(() => {
  feedRenders.count = 0;
});

describe("лишние перерисовки чата", () => {
  it("ввод в поле не перерисовывает ленту", async () => {
    renderAgentChat(fakeChatServer({ history }));
    await waitFor(() => expect(document.querySelector('[data-kind="agent"]')).not.toBeNull());
    await settle();
    const field = await screen.findByLabelText("поле");
    const before = feedRenders.count;

    for (const value of ["В", "Во", "Вопр", "Вопрос"]) fireEvent.change(field, { target: { value } });

    expect((field as HTMLTextAreaElement).value).toBe("Вопрос");
    expect(feedRenders.count).toBe(before);
  });

  it("смена модели и уровня не перерисовывает ленту", async () => {
    const server = fakeChatServer({ history });
    renderAgentChat(server);
    await waitFor(() => expect(document.querySelector('[data-kind="agent"]')).not.toBeNull());
    const model = await screen.findByLabelText("модель");
    await settle();
    const before = feedRenders.count;

    fireEvent.change(model, { target: { value: "fireworks/glm-5.3-flash" } });
    await waitFor(() => expect(server.requestsTo("model")).toHaveLength(1));
    await waitFor(() => expect((screen.getByLabelText("рассуждения") as HTMLSelectElement).value).toBe("medium"));
    fireEvent.change(screen.getByLabelText("рассуждения"), { target: { value: "high" } });
    await waitFor(() => expect(server.requestsTo("model")).toHaveLength(2));
    await settle();

    expect(feedRenders.count).toBe(before);
  });

  it("расширенный вид: смена текущего уровня не перерисовывает старые ответы с прежними настройками", async () => {
    const server = fakeChatServer({ history });
    renderAgentChat(server, { composerOptions: { variant: "extended" } });
    await waitFor(() => expect(document.querySelector('[data-kind="agent"]')).not.toBeNull());
    const model = await screen.findByLabelText("модель");
    await settle();
    const before = feedRenders.count;
    fireEvent.change(model, { target: { value: "fireworks/glm-5.3-flash" } });
    await waitFor(() => expect(server.requestsTo("model")).toHaveLength(1));
    await settle();
    expect(feedRenders.count).toBe(before);
  });

  it("когда ответ закончился, кадра «ответ кончился, а итога для диктора ещё нет» не бывает", async () => {
    const frames: Array<{ busy: boolean; announcement: string }> = [];
    const Layout: ChatSkin["Layout"] = (props) => {
      frames.push({ busy: (props.composer as ReactElement<{ busy: boolean }>).props.busy, announcement: props.announcement });
      return <stubSkin.Layout {...props} />;
    };
    const server = fakeChatServer({ history });
    renderAgentChat(server, { skin: { ...stubSkin, Layout } });
    await waitFor(() => expect(document.querySelector('[data-kind="agent"]')).not.toBeNull());
    const stream = await sendQuestion(server, "Сколько будет 2+2?");
    stream.push({ type: "start", messageId: "a-new", messageMetadata: { status: "streaming" } });
    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t1" });
    stream.push({ type: "text-delta", id: "t1", delta: "Четыре" });
    await waitFor(() => expect(document.body.textContent).toContain("Четыре"));
    const answerStartedAt = frames.length;

    stream.finish("t1");
    await waitFor(() => expect(screen.getByTestId("announcement").textContent).toBe("Четыре"));
    await settle();

    const after = frames.slice(answerStartedAt);
    expect(after.at(-1)).toEqual({ busy: false, announcement: "Четыре" });
    expect(after.filter((frame) => !frame.busy && frame.announcement === "")).toEqual([]);
  });
});
