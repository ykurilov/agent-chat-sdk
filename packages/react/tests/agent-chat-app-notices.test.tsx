// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";
import { stubWorkSkin } from "./support/stub-work-skin";
import type { ChatSkin } from "../src/skin-contract";
import type { NoticeLines } from "../src/agent-chat-extensions";

setupChatDom();

// 100: служебная пометка приложения (`kind: "app"`, право `appNotices`) — серая строка перед ответом, а не пузырь человека.

const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] };
const reply: HistoryMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Здравствуйте" }] };
const timer = (reasons: unknown[]): HistoryMessage => ({
  id: "n1",
  role: "user",
  parts: [{ type: "data-agent-notice", data: { notices: [{ kind: "app", name: "flow_timer", data: { reasons, silentMs: 67 * 60_000 } }] } }],
});
const nudge: HistoryMessage = { id: "a2", role: "assistant", parts: [{ type: "text", text: "Начнём с самого простого…" }] };

const withServiceLine: ChatSkin = { ...stubWorkSkin, ServiceLine: ({ text }) => <p data-kind="service-line">{text}</p> };

const noticeLines: NoticeLines = {
  flow_timer: ({ data }) => {
    const { reasons, silentMs } = data as { reasons: Array<{ kind: string }>; silentMs: number };
    const why = reasons.map((reason) => (reason.kind === "silence" ? "человек молчал" : "утро нового дня")).join(", ");
    return `Агент написал первым — ${why} ${Math.round(silentMs / 60_000)} мин`;
  },
};

const lines = () => Array.from(document.querySelectorAll('[data-kind="service-line"]')).map((element) => element.textContent);
const userBubbles = () => Array.from(document.querySelectorAll('[data-kind="user"]')).map((element) => element.textContent);

describe("AgentChat: служебные пометки приложения (noticeLines)", () => {
  it("по умолчанию выключено: без noticeLines пометки нет — ни строки, ни пузыря, ни плашки", async () => {
    renderAgentChat(fakeChatServer({ history: [question, reply, timer([{ kind: "silence", step: 1 }]), nudge] }), { skin: withServiceLine });
    await waitFor(() => expect(screen.getByTestId("feed").textContent).toContain("Начнём с самого простого"));
    expect(lines()).toEqual([]);
    expect(userBubbles()).toEqual(["Привет"]);
    expect(document.querySelectorAll('[data-kind="notice"]')).toHaveLength(0);
  });

  it("включено: серая строка с длительностью перед ответом", async () => {
    renderAgentChat(fakeChatServer({ history: [question, reply, timer([{ kind: "silence", step: 1 }]), nudge] }), {
      skin: withServiceLine,
      noticeLines,
    });
    await waitFor(() => expect(lines()).toEqual(["Агент написал первым — человек молчал 67 мин"]));
    expect(userBubbles()).toEqual(["Привет"]);
    const feed = screen.getByTestId("feed").textContent!;
    expect(feed.indexOf("Агент написал первым")).toBeLessThan(feed.indexOf("Начнём с самого простого"));
  });

  it("несколько причин — одна строка с перечислением", async () => {
    renderAgentChat(fakeChatServer({ history: [question, timer([{ kind: "morning" }, { kind: "silence", step: 2 }]), nudge] }), {
      skin: withServiceLine,
      noticeLines,
    });
    await waitFor(() => expect(lines()).toEqual(["Агент написал первым — утро нового дня, человек молчал 67 мин"]));
  });

  it("пометка без своей строки и скин без ServiceLine — ничего", async () => {
    const other: HistoryMessage = {
      id: "n2",
      role: "user",
      parts: [{ type: "data-agent-notice", data: { notices: [{ kind: "app", name: "flow_event", data: {} }] } }],
    };
    const view = renderAgentChat(fakeChatServer({ history: [question, other, nudge] }), { skin: withServiceLine, noticeLines });
    await waitFor(() => expect(screen.getByTestId("feed").textContent).toContain("Начнём с самого простого"));
    expect(lines()).toEqual([]);
    view.unmount();

    renderAgentChat(fakeChatServer({ history: [question, timer([{ kind: "silence", step: 1 }]), nudge] }), { skin: stubWorkSkin, noticeLines });
    await waitFor(() => expect(screen.getByTestId("feed").textContent).toContain("Начнём с самого простого"));
    expect(userBubbles()).toEqual(["Привет"]);
    expect(screen.getByTestId("feed").textContent).not.toContain("Агент написал первым");
  });
});
