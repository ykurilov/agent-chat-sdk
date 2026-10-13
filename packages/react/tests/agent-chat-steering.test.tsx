// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { englishWorkLabels, russianLabels } from "../src/labels";
import { fakeChatServer } from "./support/fake-chat-server";
import { steeringStubSkin } from "./support/stub-skin";
import { kinds, renderAgentChat, sendQuestion, setupChatDom, submitQuestion } from "./support/chat-dom";

setupChatDom();

const composer = () => screen.getByLabelText("поле").closest("form")!;

describe("AgentChat: поправка на лету", () => {
  it("во время ответа поле принимает поправку: она в ленте после ответа, с пометкой «учтёт на следующем шаге»", async () => {
    const server = fakeChatServer();
    renderAgentChat(server, { skin: steeringStubSkin });
    const stream = await sendQuestion(server, "Нарисуй кнопку");
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "text-start", id: "t" });
    stream.push({ type: "text-delta", id: "t", delta: "Рисую" });
    await waitFor(() => expect(screen.getByText("Рисую")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("поле"), { target: { value: "Сделай синей" } });
    expect(composer().getAttribute("data-can-steer")).toBe("true");

    fireEvent.submit(composer());
    await waitFor(() => expect(server.requestsTo("steer")).toHaveLength(1));
    expect(screen.getByText("Сделай синей")).toBeTruthy();
    expect(screen.getByText(russianLabels.steeringPending)).toBeTruthy();
    expect(kinds().filter((kind) => kind === "user" || kind === "steering-pending")).toEqual(["user", "user", "steering-pending"]);
    expect(composer().getAttribute("data-busy")).toBe("true");
  });

  it("steering={false} — поле во время ответа не принимает поправок", async () => {
    const server = fakeChatServer();
    renderAgentChat(server, { skin: steeringStubSkin, steering: false });
    const stream = await sendQuestion(server, "Нарисуй кнопку");
    stream.push({ type: "start", messageId: "a1" });
    await waitFor(() => expect(composer().getAttribute("data-busy")).toBe("true"));
    expect(composer().hasAttribute("data-can-steer")).toBe(false);
    submitQuestion("Сделай синей");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.requestsTo("steer")).toHaveLength(0);
  });

  it("английская пометка есть в englishWorkLabels", async () => {
    const server = fakeChatServer({
      history: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Draw" }] }],
      running: true,
      resumable: true,
    });
    server.state.pendingMessages = [{ id: "s1", role: "user", parts: [{ type: "text", text: "Make it blue" }, { type: "data-agent-steer", data: true }] }];
    renderAgentChat(server, { skin: steeringStubSkin, labels: { ...russianLabels, ...englishWorkLabels } });
    expect(await screen.findByText(englishWorkLabels.steeringPending)).toBeTruthy();
  });

  it("ответ, прерванный ради поправки, без текста — не «модель не дала ответа»", async () => {
    const steer = { type: "data-agent-steer", data: true };
    const server = fakeChatServer({
      history: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "Проверь кнопку" }] },
        { id: "a1", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "slow_check", toolCallId: "c1", state: "output-available", input: {}, output: "ок" }], metadata: { status: "complete" } },
        { id: "s1", role: "user", parts: [{ type: "text", text: "Сделай синей" }, steer] },
        { id: "a2", role: "assistant", parts: [{ type: "text", text: "Учёл" }], metadata: { status: "complete" } },
        { id: "u2", role: "user", parts: [{ type: "text", text: "Ещё" }] },
        { id: "a3", role: "assistant", parts: [], metadata: { status: "complete" } },
      ],
    });
    const { container } = renderAgentChat(server, { skin: steeringStubSkin });
    await screen.findByText("Учёл");
    const answers = [...container.querySelectorAll('[data-kind="agent"]')].map((answer) => answer.getAttribute("data-empty"));
    expect(answers).toEqual(["false", "false", "true"]);
  });

  it("скин без `steering` (свой скин до договора 21) — как раньше: Enter во время ответа ничего не шлёт, canSteer не приходит", async () => {
    const server = fakeChatServer();
    renderAgentChat(server);
    const stream = await sendQuestion(server, "Нарисуй кнопку");
    stream.push({ type: "start", messageId: "a1" });
    await waitFor(() => expect(composer().getAttribute("data-busy")).toBe("true"));
    expect(composer().hasAttribute("data-can-steer")).toBe(false);
    submitQuestion("Сделай синей");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.requestsTo("steer")).toHaveLength(0);
    expect((screen.getByLabelText("поле") as HTMLTextAreaElement).value).toBe("Сделай синей");
  });
});
