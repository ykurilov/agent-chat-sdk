// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { stubChatListSkin } from "../../../react/tests/support/stub-chat-list-skin";
import { setupChatDom } from "../../../react/tests/support/chat-dom";
import { AgentSandbox } from "../../src/react";
import type { SandboxSkin } from "../../src/react";
import { fakeSandboxServer } from "./support/fake-sandbox-server";
import { stubSandboxChatSkin, stubSandboxSkin } from "./support/stub-sandbox-skin";

setupChatDom();
beforeEach(() => localStorage.clear());
it("passes live busy to both layout and journal without inventing journal rows", async () => {
  const server = fakeSandboxServer();
  vi.stubGlobal("fetch", server.fetch);
  const skin: SandboxSkin = {
    ...stubSandboxSkin,
    SandboxLayout: (props) => <div data-testid="layout-busy" data-busy={String(props.busy === true)}><stubSandboxSkin.SandboxLayout {...props} /></div>,
    JournalList: (props) => <div data-testid="journal-busy" data-busy={String(props.busy === true)}><stubSandboxSkin.JournalList {...props} /></div>,
  };
  render(<AgentSandbox skin={stubSandboxChatSkin} sandboxSkin={skin} chatListSkin={stubChatListSkin} />);
  const field = await screen.findByRole("textbox", { name: "поле" });
  await screen.findByTestId("journal-busy");
  expect(screen.getByTestId("layout-busy").getAttribute("data-busy")).toBe("false");
  fireEvent.change(field, { target: { value: "Вопрос" } });
  fireEvent.submit(field.closest("form")!);
  const chat = server.chatServer.chatServer;
  await waitFor(() => expect(chat.streams).toHaveLength(1));
  for (const id of ["layout-busy", "journal-busy"]) await waitFor(() => expect(screen.getByTestId(id).getAttribute("data-busy")).toBe("true"));
  expect(screen.getByTestId("journal").querySelectorAll("[data-row]")).toHaveLength(0);
  await act(async () => { chat.streams[0]!.answer("Ответ"); });
  for (const id of ["layout-busy", "journal-busy"]) await waitFor(() => expect(screen.getByTestId(id).getAttribute("data-busy")).toBe("false"));
});
