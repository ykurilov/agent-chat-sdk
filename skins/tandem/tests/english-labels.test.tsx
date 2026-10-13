// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createAttachmentsClient, englishAttachmentsLabels } from "@ykurilov/agent-chat-attachments/react";
import { AgentChat, ChatLabelsProvider, englishLabels } from "@ykurilov/agent-chat-react";
import type { AgentChatProps } from "@ykurilov/agent-chat-react";
import { englishWebToolTitles, withWebToolTitles } from "@ykurilov/agent-chat-web-tools/labels";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChatServer } from "../../../packages/react/tests/support/fake-chat-server";
import type { HistoryMessage } from "../../../packages/react/tests/support/fake-chat-server";
import { installFakeLayout } from "../../../packages/react/tests/support/fake-layout";
import { tandemSkin } from "../src";

const cyrillic = /[А-Яа-яЁё]/;
const spokenAttributes = ["aria-label", "aria-description", "aria-valuetext", "aria-roledescription", "title", "placeholder", "alt"];

/** Всё, что видит или слышит человек: тексты на странице и подписи для экранного диктора. */
function visibleTexts(root: ParentNode = document.body): string[] {
  const texts: string[] = [];
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.trim();
    if (text) texts.push(text);
  }
  for (const element of root.querySelectorAll("*")) {
    for (const name of spokenAttributes) {
      const value = element.getAttribute(name)?.trim();
      if (value) texts.push(value);
    }
  }
  return texts;
}

/** Русские надписи: их нет ни у скина, ни у дизайн-системы — `englishLabels` переводит и надписи `@tandem/ui` (0.7). */
const russianLeftovers = () => visibleTexts().filter((text) => cyrillic.test(text));

let layout: ReturnType<typeof installFakeLayout>;
beforeEach(() => {
  layout = installFakeLayout();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  layout.uninstall();
});

const labels = withWebToolTitles(englishLabels, englishWebToolTitles);
const attachments = createAttachmentsClient(englishAttachmentsLabels);

function renderEnglishChat(server: ReturnType<typeof fakeChatServer>, props: Partial<AgentChatProps> = {}) {
  vi.stubGlobal("fetch", server.fetch);
  return render(
    <ChatLabelsProvider labels={labels}>
      <AgentChat api="/api/chat" chatId="c1" skin={tandemSkin} attachments={attachments} spendingLimits {...props} />
    </ChatLabelsProvider>,
  );
}

const question: HistoryMessage = {
  id: "u1",
  role: "user",
  parts: [
    { type: "text", text: "Plan a trip" },
    { type: "file", url: "attachment:f1", mediaType: "text/plain", filename: "notes.txt" },
  ],
};

const markdown = ["Here is the plan.", "", "| Day | Place |", "| --- | --- |", "| 1 | Sea |", "", "- [x] Tickets", "- [ ] Hotel", "", "```", "npm run trip", "```"].join("\n");

const finished: HistoryMessage = {
  id: "a1",
  role: "assistant",
  parts: [
    { type: "step-start" },
    { type: "reasoning", text: "Let me think", state: "done" },
    { type: "tool-web_search", toolCallId: "call-1", state: "output-available", input: { query: "sea" }, output: { results: [] } },
    { type: "tool-read_page", toolCallId: "call-2", state: "output-error", input: { url: "https://example.com" }, errorText: "timeout" },
    {
      type: "tool-helper_researcher",
      toolCallId: "call-h",
      state: "output-available",
      input: { task: "Find three beaches" },
      output: { task: "Find three beaches", steps: [{ type: "text", text: "Found two" }], text: "Two beaches", status: "done" },
    },
    { type: "text", text: markdown, state: "done" },
  ],
  metadata: { status: "complete", reasoningDurationsMs: {} },
};

const waitingFor = (part: Record<string, unknown>): HistoryMessage[] => [
  question,
  { id: "a1", role: "assistant", parts: [{ type: "step-start" }, part], metadata: { status: "awaiting_approval", reasoningDurationsMs: {} } },
];

describe("Тандем с englishLabels: в чате нет русских букв", () => {
  it("законченный ответ: рассуждения, инструменты, помощник, таблица, код, файл, выбор модели, лимит", async () => {
    const server = fakeChatServer({ history: [question, finished] });
    server.state.spending = { state: "warning", scope: "user", period: "month", share: 0.83, resetsAt: "2026-11-01T00:00:00.000Z" };
    renderEnglishChat(server);
    await screen.findByText("Here is the plan.");
    await waitFor(() => expect(screen.getByText(/of the limit/)).toBeTruthy());
    await waitFor(() => expect(document.querySelector("button[aria-haspopup=menu]")).not.toBeNull());
    expect(russianLeftovers()).toEqual([]);
  });

  it("ответ идёт: строка ожидания, «Стоп»", async () => {
    const server = fakeChatServer({ history: [] });
    renderEnglishChat(server);
    const field = await screen.findByLabelText(englishLabels.composerLabel);
    fireEvent.change(field, { target: { value: "Plan a trip" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    act(() => server.streams[0]!.push({ type: "start", messageId: "a1" }));
    await waitFor(() => expect(document.querySelector("[data-thinking-status]")).not.toBeNull());
    expect(russianLeftovers()).toEqual([]);
  });

  it("подтверждение действия", async () => {
    renderEnglishChat(
      fakeChatServer({
        history: waitingFor({ type: "tool-delete_notes", title: "Delete notes", toolCallId: "call-1", state: "approval-requested", input: {}, approval: { id: "ap1" } }),
      }),
    );
    await screen.findByText(englishLabels.approvalAllow);
    expect(russianLeftovers()).toEqual([]);
  });

  it("вопрос с вариантами", async () => {
    renderEnglishChat(
      fakeChatServer({ history: waitingFor({ type: "tool-ask_choice", toolCallId: "w1", state: "input-available", input: { question: "Where?", options: ["Sea", "Mountains"] } }) }),
    );
    await screen.findByText("Mountains");
    expect(russianLeftovers()).toEqual([]);
  });

  it("нет связи с сервером", async () => {
    const server = fakeChatServer({ history: [] });
    renderEnglishChat(server, { liveness: { reconnectDelaysMs: [0, 0, 0] } });
    const field = await screen.findByLabelText(englishLabels.composerLabel);
    fireEvent.change(field, { target: { value: "Plan a trip" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    act(() => {
      server.streams[0]!.push({ type: "start", messageId: "a1" });
      server.streams[0]!.push({ type: "text-start", id: "t" });
      server.streams[0]!.push({ type: "text-delta", id: "t", delta: "Started" });
    });
    await screen.findByText("Started");
    server.state.down = true;
    act(() => server.streams[0]!.break());
    await screen.findByText(englishLabels.connectionLost);
    expect(russianLeftovers()).toEqual([]);
  });

  it("простой вид работы агента: свёрнутые шаги раскрыты", async () => {
    renderEnglishChat(fakeChatServer({ history: [question, finished] }), { workView: "simple" });
    fireEvent.click(await screen.findByRole("button", { name: /steps done/ }));
    await waitFor(() => expect(document.querySelectorAll("[data-work-step]").length).toBeGreaterThan(0));
    expect(russianLeftovers()).toEqual([]);
  });

  it("чата нет", async () => {
    const server = fakeChatServer({ history: [] });
    server.state.notFound = true;
    renderEnglishChat(server);
    await screen.findByText(englishLabels.chatNotFound);
    expect(russianLeftovers()).toEqual([]);
  });
});
