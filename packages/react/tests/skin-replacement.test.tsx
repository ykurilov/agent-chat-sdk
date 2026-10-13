// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentChat } from "../src/agent-chat";
import type { ChatSkin } from "../src/skin-contract";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { kinds, renderAgentChat, settle, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";

/** Своя строка вызова приложения: те же пропсы, другой вид. */
const CustomToolCallRow: ChatSkin["ToolCallRow"] = ({ toolName, state, input, output, errorText }) => (
  <div data-kind="custom-tool" data-tool={toolName} data-state={state}>
    {`${toolName} ${JSON.stringify(input)} → ${state === "error" ? errorText : JSON.stringify(output)}`}
  </div>
);

const history: HistoryMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Который час в Токио?" }] },
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
        output: "15:00",
      },
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
    metadata: { status: "complete", reasoningDurationsMs: { "0": 100 } },
  },
];

setupChatDom();

/** Лента без строк вызова: вид и текст всех остальных компонентов. */
function feedWithoutToolRows(): string {
  const feed = screen.getByTestId("feed").cloneNode(true) as HTMLElement;
  for (const row of feed.querySelectorAll('[data-kind="tool"], [data-kind="custom-tool"]')) row.remove();
  return feed.innerHTML;
}

describe("AgentChat: замена компонента скина (US5-3, FR-027)", () => {
  it("skin={{ ...stubSkin, ToolCallRow: Custom }} рисует Custom с теми же пропсами, остальное как у стандартного скина", async () => {
    const standard = renderAgentChat(fakeChatServer({ history }));
    await waitFor(() => expect(document.querySelectorAll('[data-kind="tool"]')).toHaveLength(2));
    const standardKinds = kinds();
    const standardFeed = feedWithoutToolRows();
    standard.unmount();

    renderAgentChat(fakeChatServer({ history }), { skin: { ...stubSkin, ToolCallRow: CustomToolCallRow } });
    await waitFor(() => expect(document.querySelectorAll('[data-kind="custom-tool"]')).toHaveLength(2));

    expect(document.querySelectorAll('[data-kind="tool"]')).toHaveLength(0);
    expect(kinds()).toEqual(standardKinds.map((kind) => (kind === "tool" ? "custom-tool" : kind)));
    expect(feedWithoutToolRows()).toBe(standardFeed);
    expect([...document.querySelectorAll('[data-kind="custom-tool"]')].map((row) => row.textContent)).toEqual([
      'current_time {"timeZone":"Asia/Tokyo"} → "15:00"',
      'broken_lookup {"query":"курс"} → сервис недоступен',
    ]);
  });

  it("замена на ходу: меняется только строка вызова, чат не перезагружается, набранный текст на месте", async () => {
    const server = fakeChatServer({ history });
    const view = renderAgentChat(server);
    await waitFor(() => expect(document.querySelectorAll('[data-kind="tool"]')).toHaveLength(2));
    const field = screen.getByLabelText<HTMLTextAreaElement>("поле");
    fireEvent.change(field, { target: { value: "черновик" } });
    const userMessage = document.querySelector('[data-kind="user"]');
    const answerText = document.querySelector('[data-kind="text"]');
    const requestsBefore = server.requests.length;

    view.rerender(<AgentChat api="/api/chat" chatId="c1" skin={{ ...stubSkin, ToolCallRow: CustomToolCallRow }} />);

    expect(document.querySelectorAll('[data-kind="custom-tool"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-kind="tool"]')).toHaveLength(0);
    // Остальные компоненты не пересоздавались: те же DOM-узлы.
    expect(document.querySelector('[data-kind="user"]')).toBe(userMessage);
    expect(document.querySelector('[data-kind="text"]')).toBe(answerText);
    expect(screen.getByLabelText<HTMLTextAreaElement>("поле")).toBe(field);
    expect(field.value).toBe("черновик");
    expect(server.requests.length).toBe(requestsBefore);
  });
});

describe("замена компонента в окне ленты (FR-008, US1-7)", () => {
  it("в чате из 500 сообщений заменённый ToolCallRow рисуется у видимых ответов, остальное — по умолчанию", async () => {
    const longHistory: HistoryMessage[] = Array.from({ length: 250 }, (_, index): HistoryMessage[] => [
      { id: `u${index}`, role: "user", parts: [{ type: "text", text: `вопрос ${index}` }] },
      {
        id: `a${index}`,
        role: "assistant",
        parts: [
          { type: "step-start" },
          {
            type: "tool-current_time",
            toolCallId: `call-${index}`,
            state: "output-available",
            input: { timeZone: "Asia/Tokyo" },
            output: "15:00",
          },
          { type: "text", text: `ответ ${index}`, state: "done" },
        ],
        metadata: { status: "complete" },
      },
    ]).flat();
    renderAgentChat(fakeChatServer({ history: longHistory }), { skin: { ...stubSkin, ToolCallRow: CustomToolCallRow } });
    await waitFor(() => expect(document.querySelectorAll('[data-kind="custom-tool"]').length).toBeGreaterThan(0));
    await settle();

    // Окно ленты: строк вызова столько, сколько видимых ответов; стандартных строк нет.
    expect(document.querySelectorAll("[data-feed-item]").length).toBeLessThanOrEqual(40);
    expect(document.querySelectorAll('[data-kind="custom-tool"]').length).toBeGreaterThan(3);
    expect(document.querySelectorAll('[data-kind="tool"]')).toHaveLength(0);
    // Остальные компоненты — стандартные заглушки.
    expect(document.querySelectorAll('[data-kind="user"]').length).toBeGreaterThan(3);
    expect(document.querySelectorAll('[data-kind="text"]').length).toBeGreaterThan(3);
    expect(document.querySelector('[data-kind="text"]')!.textContent).toMatch(/^ответ \d+$/);
    expect(screen.getByTestId("feed").textContent).toContain("ответ 249");
  });
});
