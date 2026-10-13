// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubChatListSkin } from "../../../react/tests/support/stub-chat-list-skin";
import { setupChatDom } from "../../../react/tests/support/chat-dom";
import type { HistoryMessage } from "../../../react/tests/support/fake-chat-server";
import { AgentSandbox, russianPeopleChatsLabels as labels } from "../../src/react";
import type { PeopleChatsView, SandboxSkin } from "../../src/react";
import { fakeSandboxServer } from "./support/fake-sandbox-server";
import { stubSandboxChatSkin, stubSandboxSkin } from "./support/stub-sandbox-skin";

setupChatDom();
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const personHistory: HistoryMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Как оплатить?" }] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "Картой на сайте.", state: "done" }], metadata: { status: "complete" } },
];

function renderSandbox(server: ReturnType<typeof fakeSandboxServer>, sandboxSkin: SandboxSkin = stubSandboxSkin) {
  vi.stubGlobal("fetch", server.fetch);
  server.personChat.state.history = personHistory;
  return render(<AgentSandbox skin={stubSandboxChatSkin} sandboxSkin={sandboxSkin} chatListSkin={stubChatListSkin} people />);
}

async function openVeraChat() {
  fireEvent.click(await screen.findByRole("button", { name: labels.peopleSection }));
  fireEvent.change(await screen.findByLabelText(labels.searchPerson), { target: { value: "вер" } });
  fireEvent.click(screen.getByRole("button", { name: labels.search }));
  fireEvent.click(await screen.findByRole("button", { name: "Вера" }));
  fireEvent.click(await screen.findByRole("button", { name: "Про оплату" }));
  await screen.findByText("Картой на сайте.");
}

describe("AgentSandbox: раздел «Чаты людей»", () => {
  it("поиск человека → его чаты → чат на чтение без поля ввода и кнопок правки", async () => {
    const server = fakeSandboxServer();
    renderSandbox(server);
    await openVeraChat();

    expect(screen.getByText(labels.subjectChat, { exact: false })).toBeTruthy();
    expect(screen.getByText(labels.readOnly)).toBeTruthy();
    expect(screen.queryByLabelText("поле")).toBeNull();
    expect(document.querySelector('[data-action="edit"], [data-action="regenerate"], [data-action="edit-answer"], [data-kind="answer-retry"]')).toBeNull();
    expect(server.requestsTo("/people")).toHaveLength(2);
    expect(server.requestsTo("/people/vera/chats")).toHaveLength(1);
    expect(server.personChat.requests.some((request) => request.url.endsWith("/api/sandbox/people/vera/pc1"))).toBe(true);
    expect(server.personChat.requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("«Проверить в копии» создаёт копию и открывает её как песочный чат", async () => {
    const server = fakeSandboxServer();
    renderSandbox(server);
    await openVeraChat();

    fireEvent.click(screen.getByRole("button", { name: labels.copy }));
    await screen.findByLabelText("поле");
    expect(server.requestsTo("/people/vera/pc1/staff-copy")).toEqual([expect.objectContaining({ method: "POST" })]);
    await waitFor(() => expect(within(screen.getByTestId("chat-list")).getByText("Копия: Про оплату").closest("li")?.getAttribute("aria-current")).toBe("true"));
    expect(screen.getByRole("button", { name: labels.sandboxSection }).getAttribute("aria-pressed")).toBe("true");
  });

  it("копия не создалась: понятная ошибка, чат остаётся открытым", async () => {
    const server = fakeSandboxServer();
    server.state.people.copyRefusal = "empty_chat";
    renderSandbox(server);
    await openVeraChat();

    fireEvent.click(screen.getByRole("button", { name: labels.copy }));
    expect((await screen.findByRole("alert")).textContent).toBe(labels.emptyChat);
    expect(screen.getByText("Картой на сайте.")).toBeTruthy();
  });

  it("приложение не дало поиск: человек открывается по введённому id", async () => {
    const server = fakeSandboxServer();
    server.state.people.search = false;
    renderSandbox(server);
    fireEvent.click(await screen.findByRole("button", { name: labels.peopleSection }));

    fireEvent.change(await screen.findByLabelText(labels.personId), { target: { value: " vera " } });
    fireEvent.click(screen.getByRole("button", { name: labels.openPerson }));
    await screen.findByRole("button", { name: "Про оплату" });
    expect(server.requestsTo("/people/vera/chats")).toHaveLength(1);
  });

  it("без `people` — как раньше: ни полосы разделов, ни запросов к людям, свой `SandboxSections` скина не зовётся", async () => {
    const server = fakeSandboxServer();
    vi.stubGlobal("fetch", server.fetch);
    const sections = vi.fn(({ children }: { children: ReactNode }) => <>{children}</>);
    render(<AgentSandbox skin={stubSandboxChatSkin} sandboxSkin={{ ...stubSandboxSkin, SandboxSections: sections }} chatListSkin={stubChatListSkin} />);
    await screen.findByTestId("chat-list");

    expect(screen.queryByRole("navigation", { name: labels.sections })).toBeNull();
    expect(screen.queryByRole("button", { name: labels.peopleSection })).toBeNull();
    expect(sections).not.toHaveBeenCalled();
    expect(server.requestsTo("/people")).toHaveLength(0);
  });

  it("скин со своими `SandboxSections` и `PeopleChats` рисует раздел сам", async () => {
    const server = fakeSandboxServer();
    const views: PeopleChatsView[] = [];
    renderSandbox(server, {
      ...stubSandboxSkin,
      SandboxSections: ({ section, onSectionChange, children }) => (
        <div data-testid="sections" data-section={section}>
          <button type="button" onClick={() => onSectionChange("people")}>
            люди
          </button>
          {children}
        </div>
      ),
      PeopleChats: (view) => {
        views.push(view);
        return <div data-testid="people-chats" data-searchable={String(view.searchable)} />;
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "люди" }));
    await waitFor(() => expect(screen.getByTestId("people-chats").getAttribute("data-searchable")).toBe("true"));
    expect(screen.getByTestId("sections").getAttribute("data-section")).toBe("people");
    expect(views.at(-1)).toMatchObject({ peopleState: "idle", people: [], copying: false });
  });
});
