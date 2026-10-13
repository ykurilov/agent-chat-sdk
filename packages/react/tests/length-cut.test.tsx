// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatLabelsProvider, russianLabels, useChatLabels } from "../src/labels";
import { fakeChatServer } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";

setupChatDom();

describe("ответ, оборванный по длине (FR-054)", () => {
  it("отметка `data-length-cut` в ответе — скин получает cutByLength", async () => {
    const server = fakeChatServer({
      history: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "Отчёт" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "text", text: "Первая половина отчёта" }, { type: "data-length-cut", data: true }],
          metadata: { status: "complete" },
        },
      ],
    });
    renderAgentChat(server);

    await screen.findByText("Первая половина отчёта");
    expect(document.querySelector("[data-kind='agent']")?.getAttribute("data-cut-by-length")).toBe("true");
  });

  it("обычный ответ — поля у скина нет", async () => {
    const server = fakeChatServer({
      history: [{ id: "a1", role: "assistant", parts: [{ type: "text", text: "Обычный ответ." }], metadata: { status: "complete" } }],
    });
    renderAgentChat(server);

    await screen.findByText("Обычный ответ.");
    expect(document.querySelector("[data-kind='agent']")?.hasAttribute("data-cut-by-length")).toBe(false);
  });

  it("надпись по умолчанию — «Ответ оборван по длине»; словарь без неё получает русскую", () => {
    expect(russianLabels.answerCutByLength).toBe("Ответ оборван по длине");
    function Shown() {
      return <span>{useChatLabels().answerCutByLength}</span>;
    }
    const { answerCutByLength: _skip, ...withoutCut } = russianLabels;
    render(
      <ChatLabelsProvider labels={withoutCut}>
        <Shown />
      </ChatLabelsProvider>,
    );
    expect(screen.getByText("Ответ оборван по длине")).toBeTruthy();
  });
});
