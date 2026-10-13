// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { ChatLabelsProvider, russianLabels, useChatLabels } from "../src/labels";
import type { ChatLabels, ResolvedChatLabels } from "../src/labels";
import type { ChatSkin } from "../src/skin-contract";
import { stubSkin } from "./support/stub-skin";

type AgentMessageProps = ChatSkin["AgentMessage"] extends ComponentType<infer P> ? P : never;
type ToolCallRowProps = ChatSkin["ToolCallRow"] extends ComponentType<infer P> ? P : never;

afterEach(cleanup);

describe("договор скина, версия 15: правка ответа агента (типы проверяет typecheck)", () => {
  it("AgentMessage получает необязательные onEdit и edited", () => {
    expectTypeOf<AgentMessageProps["onEdit"]>().toEqualTypeOf<(() => void) | undefined>();
    expectTypeOf<AgentMessageProps["edited"]>().toEqualTypeOf<boolean | undefined>();
    expect(true).toBe(true);
  });

  it("ToolCallRow получает необязательный outputEdited", () => {
    expectTypeOf<ToolCallRowProps["outputEdited"]>().toEqualTypeOf<boolean | undefined>();
    expect(true).toBe(true);
  });

  it("скин версии 14 остаётся скином: компоненты без новых полей подходят", () => {
    const oldAgentMessage: ChatSkin["AgentMessage"] = ({ children }: { status: AgentMessageProps["status"]; children: ReactNode; onCopy: () => void; empty: boolean }) => (
      <div>{children}</div>
    );
    const oldToolCallRow: ChatSkin["ToolCallRow"] = ({ toolName }: { toolName: string; state: ToolCallRowProps["state"]; open: boolean; onOpenChange: (open: boolean) => void }) => (
      <p>{toolName}</p>
    );
    const v14: ChatSkin = { ...stubSkin, AgentMessage: oldAgentMessage, ToolCallRow: oldToolCallRow };
    expect(typeof v14.AgentMessage).toBe("function");
  });
});

describe("подписи версии 15", () => {
  it("в словаре необязательные, после провайдера — обязательные", () => {
    expectTypeOf<ChatLabels["answerEdited"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ChatLabels["toolOutputEdited"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ChatLabels["editAnswer"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ResolvedChatLabels["answerEdited"]>().toEqualTypeOf<string>();
    expectTypeOf<ResolvedChatLabels["toolOutputEdited"]>().toEqualTypeOf<string>();
    expectTypeOf<ResolvedChatLabels["editAnswer"]>().toEqualTypeOf<string>();
    expect(true).toBe(true);
  });

  it("русские надписи по умолчанию", () => {
    expect(russianLabels.answerEdited).toBe("Изменено человеком");
    expect(russianLabels.toolOutputEdited).toBe("Результат изменён");
    expect(russianLabels.editAnswer).toBe("Изменить ответ");
  });

  it("словарь без новых надписей получает русские", () => {
    function Shown() {
      const labels = useChatLabels();
      return (
        <p>
          {labels.answerEdited} | {labels.toolOutputEdited} | {labels.editAnswer}
        </p>
      );
    }
    const { answerEdited: _a, toolOutputEdited: _t, editAnswer: _e, ...withoutV15 } = russianLabels;
    render(
      <ChatLabelsProvider labels={withoutV15}>
        <Shown />
      </ChatLabelsProvider>,
    );
    expect(screen.getByText("Изменено человеком | Результат изменён | Изменить ответ")).toBeTruthy();
  });
});
