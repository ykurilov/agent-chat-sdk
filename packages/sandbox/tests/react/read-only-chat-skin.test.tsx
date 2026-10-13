// @vitest-environment jsdom
import { render } from "@testing-library/react";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import type { ComponentProps, ComponentType } from "react";
import { describe, expect, it } from "vitest";
import { readOnlyChatSkin } from "../../src/react/read-only-chat-skin";

type Slot = "ToolCallRow" | "HelperCallRow" | "AgentNoticeView" | "TaskCard" | "Widget";

/** Скин, который запоминает, с чем его позвали. */
function recordingSkin() {
  const calls: Partial<Record<Slot, unknown>> = {};
  const slot = (name: Slot) => (props: unknown) => {
    calls[name] = props;
    return null;
  };
  const skin = { ToolCallRow: slot("ToolCallRow"), HelperCallRow: slot("HelperCallRow"), AgentNoticeView: slot("AgentNoticeView"), TaskCard: slot("TaskCard"), Widget: slot("Widget") } as unknown as ChatSkin;
  return { skin, calls };
}

function draw<Name extends Slot>(skin: ChatSkin, name: Name, props: ComponentProps<NonNullable<ChatSkin[Name]>>) {
  const Component = skin[name] as ComponentType<Record<string, unknown>>;
  render(<Component {...(props as Record<string, unknown>)} />);
}

const decide = () => undefined;
const requested = { state: "requested" as const, onDecide: decide, pending: false, failed: false, canAlways: true };

describe("скин чата на чтение", () => {
  it("подтверждений инструментов, помощников и задач нет: решать за человека нельзя", () => {
    const { skin, calls } = recordingSkin();
    const readOnly = readOnlyChatSkin(skin);
    draw(readOnly, "ToolCallRow", { toolName: "delete_task", approval: requested, state: "running", open: false, onOpenChange: decide });
    draw(readOnly, "HelperCallRow", { name: "x", task: "t", steps: [], text: "", status: "awaiting_approval", approval: requested, open: false, onOpenChange: decide });
    draw(readOnly, "AgentNoticeView", { kind: "task_awaiting_approval", title: "Задача", approval: requested });
    draw(readOnly, "TaskCard", { id: "t1", title: "Задача", status: "running", elapsedMs: 0, onCancel: decide });

    expect(calls.ToolCallRow).toMatchObject({ toolName: "delete_task", state: "running" });
    expect(calls.ToolCallRow).not.toHaveProperty("approval");
    expect(calls.HelperCallRow).not.toHaveProperty("approval");
    expect(calls.AgentNoticeView).not.toHaveProperty("approval");
    expect(calls.TaskCard).not.toHaveProperty("onCancel");
  });

  it("итог решения остаётся пометкой", () => {
    const { skin, calls } = recordingSkin();
    draw(readOnlyChatSkin(skin), "ToolCallRow", { toolName: "delete_task", approval: { state: "denied" }, state: "done", open: false, onOpenChange: decide });
    expect(calls.ToolCallRow).toMatchObject({ approval: { state: "denied" } });
  });

  it("виджеты не нажимаются: без ответа, а свой виджет приложения — запасным видом", () => {
    const { skin, calls } = recordingSkin();
    const readOnly = readOnlyChatSkin(skin);
    const base = { toolCallId: "w1", active: true, pending: false, answeredByMessage: false };
    draw(readOnly, "Widget", { ...base, kind: "form", title: "Анкета", fields: [], onSubmit: decide });
    expect(calls.Widget).toMatchObject({ kind: "form", active: false });
    expect(calls.Widget).not.toHaveProperty("onSubmit");
    draw(readOnly, "Widget", { ...base, kind: "choice", question: "Да?", options: ["да"], onChoose: decide });
    expect(calls.Widget).not.toHaveProperty("onChoose");
    draw(readOnly, "Widget", { ...base, kind: "custom", name: "map", question: "Где?", content: <button type="button">ответить</button> });
    expect(calls.Widget).toMatchObject({ kind: "custom", active: false });
    expect(calls.Widget).not.toHaveProperty("content");
  });
});
