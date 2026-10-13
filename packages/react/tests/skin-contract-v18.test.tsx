// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { ChatLabelsProvider, englishWorkLabels, russianLabels, useChatLabels } from "../src/labels";
import type { ChatLabels } from "../src/labels";
import type { AgentNoticeViewProps, ChatSkin, HelperCallView, TaskCardView, TaskStatusView, ToolApprovalView } from "../src/skin-contract";
import { stubSkin } from "./support/stub-skin";

afterEach(cleanup);

type Props<Part extends keyof ChatSkin> = NonNullable<ChatSkin[Part]> extends ComponentType<infer P> ? P : never;

describe("договор скина, версия 18: помощники, задачи, служебные сообщения (типы проверяет typecheck)", () => {
  it("три новые части необязательны", () => {
    expectTypeOf<ChatSkin["HelperCallRow"]>().toEqualTypeOf<ComponentType<HelperCallView> | undefined>();
    expectTypeOf<ChatSkin["TaskCard"]>().toEqualTypeOf<ComponentType<TaskCardView> | undefined>();
    expectTypeOf<ChatSkin["AgentNoticeView"]>().toEqualTypeOf<ComponentType<AgentNoticeViewProps> | undefined>();
    expect(true).toBe(true);
  });

  it("HelperCallRow: задание, шаги, итог, статус, подтверждение", () => {
    expectTypeOf<Props<"HelperCallRow">["task"]>().toEqualTypeOf<string>();
    expectTypeOf<Props<"HelperCallRow">["status"]>().toEqualTypeOf<"running" | "awaiting_approval" | "done" | "failed" | "background">();
    expectTypeOf<Props<"HelperCallRow">["approval"]>().toEqualTypeOf<ToolApprovalView | undefined>();
    expectTypeOf<Props<"HelperCallRow">["steps"][number]["kind"]>().toEqualTypeOf<"tool" | "text">();
    expect(true).toBe(true);
  });

  it("TaskCard: статус, сколько идёт, onCancel", () => {
    expectTypeOf<Props<"TaskCard">["status"]>().toEqualTypeOf<TaskStatusView>();
    expectTypeOf<Props<"TaskCard">["onCancel"]>().toEqualTypeOf<(() => void) | undefined>();
    expectTypeOf<Props<"TaskCard">["elapsedMs"]>().toEqualTypeOf<number>();
    expect(true).toBe(true);
  });

  it("AgentNoticeView: вид, название, итог и кнопки подтверждения", () => {
    expectTypeOf<Props<"AgentNoticeView">["kind"]>().toEqualTypeOf<
      "task_done" | "task_failed" | "task_canceled" | "task_interrupted" | "task_timed_out" | "task_awaiting_approval" | "conversation_started"
    >();
    expectTypeOf<Props<"AgentNoticeView">["approval"]>().toEqualTypeOf<ToolApprovalView | undefined>();
    expect(true).toBe(true);
  });

  it("скин версии 16 остаётся скином: новых частей нет, остальное работает", () => {
    const v16: ChatSkin = { ...stubSkin };
    expect(v16.HelperCallRow).toBeUndefined();
    expect(v16.TaskCard).toBeUndefined();
    expect(v16.AgentNoticeView).toBeUndefined();
  });
});

describe("подписи версии 18", () => {
  it("русские по умолчанию", () => {
    expect(russianLabels.helpers.assigned).toBe("Поручено");
    expect(russianLabels.helpers.returned).toBe("Вернул");
    expect(russianLabels.tasks.cancel).toBe("Отменить");
    expect(russianLabels.notices.taskCanceled).toBe("задача отменена");
    expect(russianLabels.notices.taskDone).toBe("задача готова");
    expect(russianLabels.tasks.status.running).toBe("Идёт");
    expect(russianLabels.tasks.elapsed(125_000, false)).toBe("идёт 2 мин 5 сек");
    expect(russianLabels.tasks.elapsed(125_000, true)).toBe("заняла 2 мин 5 сек");
    expect(russianLabels.chatListOrigin).toEqual({ telegram: "Telegram", vk: "ВКонтакте", max: "MAX" });
    expect(russianLabels.messengerStatus.usingTool("поиск")).toBe("Использую инструмент: поиск");
  });

  it("английские: те же ключи, ни одной русской буквы", () => {
    const shape = (value: unknown): unknown =>
      typeof value === "function" ? "fn" : typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)])) : "text";
    const { helpers, tasks, notices, messengerStatus, steeringPending } = russianLabels;
    expect(shape(englishWorkLabels)).toEqual(shape({ helpers, tasks, notices, messengerStatus, steeringPending }));
    const english = JSON.stringify([englishWorkLabels, englishWorkLabels.tasks.elapsed(65_000, false), englishWorkLabels.tasks.elapsed(65_000, true), englishWorkLabels.messengerStatus.usingTool("x")]);
    expect(english).not.toMatch(/[А-Яа-яЁё]/);
  });

  it("приложение задаёт часть надписей, остальные остаются русскими", () => {
    const labels: ChatLabels = { ...russianLabels, tasks: { cancel: "Стоп" } };
    function Probe() {
      const resolved = useChatLabels();
      return <p>{`${resolved.tasks.cancel}|${resolved.tasks.canceling}|${resolved.helpers.assigned}`}</p>;
    }
    render(
      <ChatLabelsProvider labels={labels}>
        <Probe />
      </ChatLabelsProvider>,
    );
    expect(screen.getByText("Стоп|Отменяем…|Поручено")).toBeTruthy();
  });
});
