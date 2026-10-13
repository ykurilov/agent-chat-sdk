// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { CompactionRecord, HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, settle, setupChatDom, waitForFeedPositioned } from "./support/chat-dom";
import { russianLabels } from "../src/labels";

setupChatDom();

const pair = (n: number): HistoryMessage[] => [
  { id: `u${n}`, role: "user", parts: [{ type: "text", text: `вопрос ${n}` }] },
  { id: `a${n}`, role: "assistant", parts: [{ type: "text", text: `ответ ${n}`, state: "done" }], metadata: { status: "complete" } },
];
const history = [1, 2, 3].flatMap(pair);

const record = (id: string, through: string, summary: string): CompactionRecord => ({
  id,
  fromMessageId: "u1",
  throughMessageId: through,
  summary,
  summaryTokens: 30,
  createdAt: "2026-03-01T10:09:00.000Z",
});

/** Всё, что в ленте: сообщения и разделители в порядке следования. */
function feedOrder(): string[] {
  return [...document.querySelectorAll('[data-kind="user"], [data-kind="agent"], [data-kind="compaction-divider"]')].map((node) =>
    node.getAttribute("data-kind") === "compaction-divider"
      ? "разделитель"
      : (node.textContent ?? "").replace(russianLabels.regenerate, "").trim(),
  );
}

describe("лента: разделитель «История сжата»", () => {
  it("стоит сразу после последнего сжатого сообщения, все сообщения на месте", async () => {
    const server = fakeChatServer({ history });
    server.state.compactions = [record("c1", "a1", "## Цель\nПереезд")];
    renderAgentChat(server);
    await screen.findByText("ответ 3");
    expect(feedOrder()).toEqual(["вопрос 1", "ответ 1", "разделитель", "вопрос 2", "ответ 2", "вопрос 3", "ответ 3"]);
  });

  it("подпись — из словаря; по клику раскрывается сводка, повторный клик сворачивает", async () => {
    const server = fakeChatServer({ history });
    server.state.compactions = [record("c1", "a2", "## Цель\nПереезд")];
    renderAgentChat(server, { labels: { ...russianLabels, historyCompacted: "Сжато!" } });
    await screen.findByLabelText("сжатие");
    await waitForFeedPositioned();
    const toggle = screen.getByLabelText("сжатие");
    expect(toggle.textContent).toBe("Сжато!");
    expect(screen.queryByText(/Переезд/)).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText(/Переезд/).textContent).toContain("## Цель");
    fireEvent.click(toggle);
    expect(screen.queryByText(/Переезд/)).toBeNull();
  });

  it("у каждой записи ветки свой разделитель и своя сводка", async () => {
    const server = fakeChatServer({ history });
    server.state.compactions = [record("c1", "a1", "первая сводка"), record("c2", "a2", "вторая сводка")];
    renderAgentChat(server);
    await screen.findByText("ответ 3");
    await waitForFeedPositioned();
    const dividers = document.querySelectorAll('[data-kind="compaction-divider"]');
    expect(dividers).toHaveLength(2);
    fireEvent.click(within(dividers[1] as HTMLElement).getByLabelText("сжатие"));
    expect(screen.getByText("вторая сводка")).toBeTruthy();
    expect(screen.queryByText("первая сводка")).toBeNull();
  });

  it("запись, чьего сообщения в ленте нет, разделителя не даёт", async () => {
    const server = fakeChatServer({ history });
    server.state.compactions = [record("c1", "нет-такого", "сводка")];
    renderAgentChat(server);
    await screen.findByText("ответ 3");
    await settle();
    expect(document.querySelector('[data-kind="compaction-divider"]')).toBeNull();
  });

  it("без записей разделителей нет", async () => {
    renderAgentChat(fakeChatServer({ history }));
    await screen.findByText("ответ 3");
    expect(document.querySelector('[data-kind="compaction-divider"]')).toBeNull();
  });

  it("раскрытая сводка переживает перерисовку ленты", async () => {
    const server = fakeChatServer({ history });
    server.state.compactions = [record("c1", "a1", "сводка-раз")];
    renderAgentChat(server);
    await screen.findByLabelText("сжатие");
    await waitForFeedPositioned();
    fireEvent.click(screen.getByLabelText("сжатие"));
    expect(screen.getByText("сводка-раз")).toBeTruthy();
    const field = await screen.findByLabelText("поле");
    fireEvent.change(field, { target: { value: "набираю" } });
    await waitFor(() => expect(screen.getByText("сводка-раз")).toBeTruthy());
  });
});
