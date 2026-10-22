// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ChatSkin } from "../src/skin-contract";
import { fakeChatServer } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";
setupChatDom();

const settingsSkin: ChatSkin = {
  ...stubSkin,
  Composer: (props) => <><stubSkin.Composer {...props} /><button aria-label="видимость мыслей" data-variant={props.options?.variant} onClick={() => props.options?.reasoningVisibility?.onChange(!props.options.reasoningVisibility.value)} /></>,
  AgentMessage: ({ modelDetails, ...props }) => <><stubSkin.AgentMessage {...props} /><output aria-label="модель ответа">{JSON.stringify(modelDetails)}</output></>,
};
it("AgentChat передаёт выбранный вид, скрывает мысли по переключателю и показывает настройки самого ответа", async () => {
  const server = fakeChatServer({ history: [{ id: "a1", role: "assistant", parts: [{ type: "reasoning", text: "Мысли ответа", state: "done" }, { type: "text", text: "Ответ", state: "done" }], metadata: { status: "complete", modelId: "glm-5.3-flash", providerId: "fireworks", reasoningLevel: "high" } }] });
  renderAgentChat(server, { skin: settingsSkin, composerOptions: { variant: "extended" } });
  await screen.findByText("Мысли ответа");
  await waitFor(() => expect(screen.getByLabelText("модель ответа").textContent).toContain('"reasoning":"high"'));
  expect(screen.getByLabelText("видимость мыслей").getAttribute("data-variant")).toBe("extended");
  fireEvent.click(screen.getByLabelText("видимость мыслей"));
  expect(screen.queryByText("Мысли ответа")).toBeNull();
  fireEvent.click(screen.getByLabelText("видимость мыслей"));
  expect(screen.getByText("Мысли ответа")).toBeTruthy();
});
it("у старого ответа неизвестный уровень не подменяется текущим выбором", async () => {
  const server = fakeChatServer({ history: [{ id: "a1", role: "assistant", parts: [{ type: "text", text: "Ответ", state: "done" }], metadata: { status: "complete", modelId: "deepseek-4.1-flash", providerId: "deepseek" } }] });
  renderAgentChat(server, { skin: settingsSkin, composerOptions: { variant: "extended" } });
  await waitFor(() => expect(screen.getByLabelText("модель ответа").textContent).toContain('"modelId":"deepseek-4.1-flash"'));
  expect(JSON.parse(screen.getByLabelText("модель ответа").textContent!)).not.toHaveProperty("reasoning");
});
