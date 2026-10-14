// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";
import { stubWorkSkin } from "./support/stub-work-skin";
import type { ChatSkin } from "../src/skin-contract";

setupChatDom();

// 068: реплика живого сотрудника (`appendStaffMessage`) — сообщение сотрудника, а не пузырь человека и не плашка.

const question: HistoryMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Пришлите запись" }] };
const staff = (staffName?: string): HistoryMessage => ({
  id: "s1",
  role: "user",
  parts: [{ type: "data-agent-notice", data: { notices: [{ kind: "staff", title: "Вот запись эфира", ...(staffName && { staffName }) }] } }],
});

const withStaff: ChatSkin = {
  ...stubWorkSkin,
  StaffMessage: ({ text, staffName }) => (
    <div data-kind="staff" data-staff-name={staffName ?? ""}>
      {text}
    </div>
  ),
};

const userBubbles = () => Array.from(document.querySelectorAll('[data-kind="user"]')).map((element) => element.textContent);

describe("AgentChat: реплика сотрудника", () => {
  it("скин умеет StaffMessage (версия 25) — сообщение сотрудника с именем; ни пузыря человека, ни плашки, ни «Изменить»", async () => {
    renderAgentChat(fakeChatServer({ history: [question, staff("Ольга")] }), { skin: withStaff });
    await waitFor(() => expect(document.querySelector('[data-kind="staff"]')).not.toBeNull());
    const shown = document.querySelector<HTMLElement>('[data-kind="staff"]')!;
    expect(shown.textContent).toBe("Вот запись эфира");
    expect(shown.dataset.staffName).toBe("Ольга");
    expect(document.querySelectorAll('[data-kind="notice"]')).toHaveLength(0);
    expect(userBubbles()).toEqual(["Пришлите запись"]);
    expect(document.querySelectorAll('[data-action="edit"]')).toHaveLength(1);
  });

  it("скин без StaffMessage — ответом со стороны агента с подписью сотрудника, не пузырём человека", async () => {
    renderAgentChat(fakeChatServer({ history: [question, staff("Ольга"), { ...staff(), id: "s2" }] }), { skin: stubSkin });
    await waitFor(() => expect(document.querySelectorAll('[data-kind="agent"]')).toHaveLength(2));
    const answers = Array.from(document.querySelectorAll('[data-kind="agent"]')).map((element) => element.textContent);
    expect(answers[0]).toContain("Сотрудник Ольга");
    expect(answers[0]).toContain("Вот запись эфира");
    expect(answers[1]).toContain("Сотрудник");
    expect(userBubbles()).toEqual(["Пришлите запись"]);
    expect(screen.getByTestId("feed").textContent).toContain("Вот запись эфира");
  });
});
