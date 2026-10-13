// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { kinds, renderAgentChat, sendQuestion, setupChatDom } from "./support/chat-dom";

setupChatDom();

function toolRows(): Array<Record<string, string | null>> {
  return [...document.querySelectorAll('[data-kind="tool"]')].map((row) => ({
    tool: row.getAttribute("data-tool"),
    state: row.getAttribute("data-state"),
    input: row.getAttribute("data-input"),
    output: row.getAttribute("data-output"),
    error: row.getAttribute("data-error"),
  }));
}

describe("AgentChat: вызовы инструментов", () => {
  it("законченные вызовы из истории — done и error с errorText, в порядке частей", async () => {
    const history: HistoryMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Который час?" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "step-start" },
          { type: "reasoning", text: "спрошу время", state: "done" },
          {
            type: "tool-current_time",
            toolCallId: "call-1",
            state: "output-available",
            input: { timeZone: "Asia/Tokyo" },
            output: "2026-09-29T15:00:00+09:00",
          },
          { type: "step-start" },
          { type: "reasoning", text: "поищу ещё", state: "done" },
          {
            type: "tool-broken_lookup",
            toolCallId: "call-2",
            state: "output-error",
            input: { query: "курс" },
            errorText: "сервис недоступен",
          },
          { type: "step-start" },
          { type: "text", text: "В Токио 15:00.", state: "done" },
        ],
        metadata: { status: "complete", reasoningDurationsMs: { "0": 100, "1": 100 } },
      },
    ];
    renderAgentChat(fakeChatServer({ history }));
    const feed = await screen.findByTestId("feed");

    await waitFor(() => expect(kinds(feed)).toEqual(["user", "agent", "reasoning", "tool", "reasoning", "tool", "text"]));
    expect(toolRows()).toEqual([
      {
        tool: "current_time",
        state: "done",
        input: JSON.stringify({ timeZone: "Asia/Tokyo" }),
        output: JSON.stringify("2026-09-29T15:00:00+09:00"),
        error: "",
      },
      { tool: "broken_lookup", state: "error", input: JSON.stringify({ query: "курс" }), output: "", error: "сервис недоступен" },
    ]);
  });

  it("во время хода: input-streaming и input-available — running, output-available — done", async () => {
    const server = fakeChatServer();
    renderAgentChat(server);
    const stream = await sendQuestion(server, "Сколько времени в Токио?");
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "start-step" });
    stream.push({ type: "tool-input-start", toolCallId: "call-1", toolName: "current_time" });
    stream.push({ type: "tool-input-delta", toolCallId: "call-1", inputTextDelta: '{"timeZone":"Asia/' });

    await waitFor(() => expect(toolRows()).toMatchObject([{ tool: "current_time", state: "running" }]));

    stream.push({
      type: "tool-input-available",
      toolCallId: "call-1",
      toolName: "current_time",
      input: { timeZone: "Asia/Tokyo" },
    });
    await waitFor(() =>
      expect(toolRows()).toMatchObject([
        { tool: "current_time", state: "running", input: JSON.stringify({ timeZone: "Asia/Tokyo" }) },
      ]),
    );

    stream.push({ type: "tool-output-available", toolCallId: "call-1", output: "15:00" });
    await waitFor(() =>
      expect(toolRows()).toMatchObject([{ tool: "current_time", state: "done", output: JSON.stringify("15:00") }]),
    );

    stream.push({ type: "finish-step" });
    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t1" });
    stream.push({ type: "text-delta", id: "t1", delta: "В Токио 15:00." });
    stream.push({ type: "text-end", id: "t1" });
    await waitFor(() => expect(kinds(document.body)).toEqual(["user", "agent", "tool", "text"]));
    stream.end();
  });
});
