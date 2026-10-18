// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FlowTestChatFrameProps } from "@ykurilov/agent-chat-flows/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tandemFlowEditorSkin } from "../src/flows";

afterEach(cleanup);

const { FlowTestChatFrame } = tandemFlowEditorSkin;

const frame = (extra: Partial<FlowTestChatFrameProps> = {}): FlowTestChatFrameProps => ({
  stateTitle: "Знакомство",
  clock: "как сейчас",
  advanceSteps: [{ label: "20 мин", ms: 1_200_000 }],
  onAdvance: vi.fn(),
  day: null,
  busy: false,
  failed: false,
  onReset: vi.fn(),
  onClose: vi.fn(),
  children: null,
  ...extra,
});

describe("099 тестовый чат Тандема: к следующему напоминанию и своё время", () => {
  it("кнопка «К следующему напоминанию» есть, только если её дали; ждёт во время перемотки", () => {
    const onNextFirstMessage = vi.fn();
    const view = render(<FlowTestChatFrame {...frame({ onNextFirstMessage })} />);
    fireEvent.click(screen.getByRole("button", { name: "К следующему напоминанию" }));
    expect(onNextFirstMessage).toHaveBeenCalledTimes(1);

    view.rerender(<FlowTestChatFrame {...frame({ onNextFirstMessage, busy: true })} />);
    expect((screen.getByRole("button", { name: "К следующему напоминанию" }) as HTMLButtonElement).disabled).toBe(true);

    view.rerender(<FlowTestChatFrame {...frame()} />);
    expect(screen.queryByRole("button", { name: "К следующему напоминанию" })).toBeNull();
  });

  it("впереди сценарий ничего не напишет — так и сказано", () => {
    render(<FlowTestChatFrame {...frame({ onNextFirstMessage: vi.fn(), nothingScheduled: true })} />);
    expect(screen.getByRole("status").textContent).toBe("Впереди сценарий сам ничего не напишет");
  });

  it("своё время: Enter перематывает и чистит поле; непонятное — подсказка, поле остаётся", () => {
    const onAdvanceText = vi.fn((text: string) => text !== "скоро");
    render(<FlowTestChatFrame {...frame({ onAdvanceText })} />);
    const field = screen.getByRole("textbox", { name: "Своё время" }) as HTMLInputElement;

    fireEvent.change(field, { target: { value: "скоро" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onAdvanceText).toHaveBeenLastCalledWith("скоро");
    expect(field.value).toBe("скоро");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/Не понял время/)).toBeTruthy();

    fireEvent.change(field, { target: { value: "1 ч 30 мин" } });
    expect(field.getAttribute("aria-invalid")).toBe("false");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onAdvanceText).toHaveBeenLastCalledWith("1 ч 30 мин");
    expect(field.value).toBe("");
  });
});
