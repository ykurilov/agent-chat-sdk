// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPanel } from "../../src/agent-panel/agent-panel";
import { AgentPanelProvider } from "../../src/agent-panel/agent-panel-provider";
import { fakeChatListServer } from "../support/fake-chat-list-server";
import { setupChatDom, settle, submitQuestion } from "../support/chat-dom";
import { stubPanelSkin } from "../support/stub-agent-panel-skin";

setupChatDom();
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const page = (withPanel: boolean) => (
  <AgentPanelProvider api="/api/chat" userKey="ivan">
    <main>page</main>
    {withPanel && <AgentPanel skin={stubPanelSkin} />}
  </AgentPanelProvider>
);

const launcher = () => screen.getByTestId("launcher");
const answerText = () => document.querySelector('[data-kind="text"]')?.textContent ?? "";

describe("SC-003: ответ не обрывается, пока панель закрыта", () => {
  it("20 повторов: закрыть во время ответа, открыть — все куски ответа на месте", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      localStorage.clear();
      const server = fakeChatListServer([{ id: "c1", title: "Первый" }]);
      vi.stubGlobal("fetch", server.fetch);
      render(page(true));
      await screen.findByLabelText("поле");
      fireEvent.click(launcher());
      submitQuestion(`Вопрос ${attempt}`);
      await waitFor(() => expect(server.chatServer.streams).toHaveLength(1));
      const stream = server.chatServer.streams[0]!;
      stream.push({ type: "start", messageId: "a1" });
      stream.push({ type: "text-start", id: "t" });
      stream.push({ type: "text-delta", id: "t", delta: "Раз, " });
      await waitFor(() => expect(answerText()).toBe("Раз, "));

      fireEvent.click(launcher());
      expect(launcher().getAttribute("aria-expanded")).toBe("false");
      stream.push({ type: "text-delta", id: "t", delta: "два, " });
      stream.push({ type: "text-delta", id: "t", delta: "три." });
      stream.finish();
      await settle();

      fireEvent.click(launcher());
      expect(launcher().getAttribute("aria-expanded")).toBe("true");
      await waitFor(() => expect(answerText()).toBe("Раз, два, три."));
      expect(document.querySelector('[data-kind="text"]')?.getAttribute("data-streaming")).toBe("false");
      expect(server.chatServer.requestsTo("stop")).toHaveLength(0);
      expect(server.chatServer.requestsTo("stream")).toHaveLength(0);
      cleanup();
      vi.unstubAllGlobals();
    }
  }, 60_000);

  it("кнопку и панель убрали со страницы во время ответа — «стоп» не уходит", async () => {
    const server = fakeChatListServer([{ id: "c1", title: "Первый" }]);
    vi.stubGlobal("fetch", server.fetch);
    const view = render(page(true));
    await screen.findByLabelText("поле");
    submitQuestion("Вопрос");
    await waitFor(() => expect(server.chatServer.streams).toHaveLength(1));
    server.chatServer.streams[0]!.push({ type: "start", messageId: "a1" });
    server.chatServer.streams[0]!.push({ type: "text-start", id: "t" });
    server.chatServer.streams[0]!.push({ type: "text-delta", id: "t", delta: "Начало" });
    await waitFor(() => expect(answerText()).toBe("Начало"));

    view.rerender(page(false));
    expect(screen.queryByTestId("launcher")).toBeNull();
    await settle();
    expect(server.chatServer.requestsTo("stop")).toHaveLength(0);
  });
});
