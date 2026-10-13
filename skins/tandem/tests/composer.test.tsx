// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TandemSpendingNotice } from "../src/spending-notice";
import { TooltipProvider } from "@tandem/ui";
import type { ModelChoiceView } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemComposer } from "../src/composer";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Ширина экрана для проверок: узкая или широкая. */
function stubScreen(narrow: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: narrow,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

const choice = (override: Partial<ModelChoiceView> = {}): ModelChoiceView => ({
  providers: [
    { id: "fireworks", name: "Fireworks", models: [{ id: "glm-5.3-flash", name: "GLM 5.3 Flash" }] },
    { id: "openrouter", name: "OpenRouter", models: [{ id: "gpt-6-luna", name: "GPT 6 Luna" }] },
  ],
  current: { providerId: "openrouter", modelId: "gpt-6-luna" },
  onChange: vi.fn(),
  reasoningLevels: [
    { id: "low", name: "Низкий" },
    { id: "high", name: "Высокий" },
  ],
  reasoning: "low",
  onReasoningChange: vi.fn(),
  ...override,
});

function renderComposer(props: Partial<ComponentProps<typeof TandemComposer>> = {}) {
  return render(
    <TooltipProvider>
      <TandemComposer value="" onValueChange={vi.fn()} onSubmit={vi.fn()} busy={false} onStop={vi.fn()} {...props} />
    </TooltipProvider>,
  );
}

describe("поле ввода Тандема: лимит расходов", () => {
  it("отправка остановлена лимитом: поле неактивно", () => {
    stubScreen(false);
    renderComposer({ value: "Привет", sendingBlocked: true });
    expect((screen.getByLabelText("Сообщение") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("остановка лимитом: поле связано с надписью через aria-describedby, без остановки связи нет", () => {
    stubScreen(false);
    const { rerender } = renderComposer({ value: "Привет" });
    const wrap = (props: Partial<ComponentProps<typeof TandemComposer>>) => (
      <TooltipProvider>
        <TandemComposer value="Привет" onValueChange={vi.fn()} onSubmit={vi.fn()} busy={false} onStop={vi.fn()} {...props} />
      </TooltipProvider>
    );
    expect(screen.getByLabelText("Сообщение").getAttribute("aria-describedby")).toBeNull();
    rerender(wrap({ sendingBlocked: true, sendingBlockedReasonId: "spending-1" }));
    expect(screen.getByLabelText("Сообщение").getAttribute("aria-describedby")).toBe("spending-1");
    rerender(wrap({}));
    expect(screen.getByLabelText("Сообщение").getAttribute("aria-describedby")).toBeNull();
  });

  it("поле в фокусе, отправку остановили: фокус переходит на надпись, а не пропадает; когда лимит снят, возвращается в поле", () => {
    stubScreen(false);
    const tree = (props: Partial<ComponentProps<typeof TandemComposer>>) => (
      <TooltipProvider>
        <TandemSpendingNotice id="spending-1" state={props.sendingBlocked ? "exhausted" : "none"} text={props.sendingBlocked ? "Лимит исчерпан" : ""} />
        <TandemComposer value="Привет" onValueChange={vi.fn()} onSubmit={vi.fn()} busy={false} onStop={vi.fn()} {...props} />
      </TooltipProvider>
    );
    const { rerender } = render(tree({}));
    const textarea = screen.getByLabelText("Сообщение") as HTMLTextAreaElement;
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    rerender(tree({ sendingBlocked: true, sendingBlockedReasonId: "spending-1" }));
    expect(document.activeElement).toBe(document.getElementById("spending-1"));

    rerender(tree({}));
    expect(document.activeElement).toBe(screen.getByLabelText("Сообщение"));
  });

  it("поле не было в фокусе: остановка фокус не трогает", () => {
    stubScreen(false);
    const { rerender } = renderComposer({ value: "Привет" });
    const wrap = (props: Partial<ComponentProps<typeof TandemComposer>>) => (
      <TooltipProvider>
        <TandemComposer value="Привет" onValueChange={vi.fn()} onSubmit={vi.fn()} busy={false} onStop={vi.fn()} {...props} />
      </TooltipProvider>
    );
    rerender(wrap({ sendingBlocked: true, sendingBlockedReasonId: "spending-1" }));
    expect(document.activeElement).toBe(document.body);
  });

  it("без остановки поле активно", () => {
    stubScreen(false);
    renderComposer({ value: "Привет" });
    expect((screen.getByLabelText("Сообщение") as HTMLTextAreaElement).disabled).toBe(false);
  });
});

describe("поле ввода Тандема: выбор модели", () => {
  it("на широком экране провайдеры — подменю: в подписи кнопки модель, затем провайдер", () => {
    stubScreen(false);
    renderComposer({ modelChoice: choice() });

    expect(screen.getByRole("button", { name: "Модель: GPT 6 Luna, OpenRouter" })).toBeTruthy();
  });

  it("на узком экране подменю не помещается рядом с меню: один список «модель · провайдер»", () => {
    stubScreen(true);
    renderComposer({ modelChoice: choice() });

    expect(screen.getByRole("button", { name: "Модель: GPT 6 Luna · OpenRouter" })).toBeTruthy();
  });

  it("без modelChoice рисует простое поле: выбора модели нет", () => {
    renderComposer();

    expect(screen.queryByText("GPT 6 Luna")).toBeNull();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("с modelChoice показывает текущую модель и кнопку уровня рассуждений", () => {
    renderComposer({ modelChoice: choice() });

    expect(screen.getByText("GPT 6 Luna")).toBeTruthy();
    expect(screen.getByRole("button", { name: /рассужд|reasoning/i })).toBeTruthy();
  });

  it("у модели без уровней кнопки уровня нет", () => {
    renderComposer({ modelChoice: choice({ reasoningLevels: [] }) });

    expect(screen.getByText("GPT 6 Luna")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /рассужд|reasoning/i })).toBeNull();
  });

  it("пока список не загрузился (providers пуст), меню нет, поле работает", () => {
    renderComposer({ modelChoice: choice({ providers: [] }) });

    expect(screen.queryByText("GPT 6 Luna")).toBeNull();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("ошибка выбора видна текстом со статусом", () => {
    renderComposer({ modelChoice: choice({ error: "Не удалось сменить модель" }) });

    expect(screen.getByRole("status").textContent).toContain("Не удалось сменить модель");
  });

  it("ошибка списка видна и без меню", () => {
    renderComposer({ modelChoice: choice({ providers: [], error: "Список моделей не загрузился" }) });

    expect(screen.getByRole("status").textContent).toContain("Список моделей не загрузился");
  });

  it("пока идёт ответ, рядом кнопка «стоп», а выбор модели не заблокирован", () => {
    renderComposer({ busy: true, modelChoice: choice() });

    expect(screen.getByRole("button", { name: /останов|stop/i })).toBeTruthy();
    expect(screen.getByText("GPT 6 Luna").closest("button")?.hasAttribute("disabled")).toBe(false);
  });

  it.each([
    ["простое поле", {}],
    ["поле с выбором модели", { modelChoice: choice() }],
  ])("%s: пока идёт ответ, «Отправить» в рамке сама становится «Стоп», без колёсика и без второй кнопки", (_name, extra) => {
    stubScreen(false);
    const onStop = vi.fn();
    const { container } = renderComposer({ busy: true, onStop, ...extra });
    const frame = screen.getByLabelText("Сообщение").closest("[class*='rounded-[16px]']") as HTMLElement;

    const stops = screen.getAllByRole("button", { name: /останов|stop/i });
    expect(stops).toHaveLength(1);
    expect(frame.contains(stops[0]!)).toBe(true);
    expect(screen.queryByRole("button", { name: "Отправить" })).toBeNull();
    expect(container.querySelector(".tandem-spinner")).toBeNull();

    stops[0]!.click();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("пока идёт ответ, Enter ничего не отправляет", () => {
    stubScreen(false);
    const onSubmit = vi.fn();
    renderComposer({ busy: true, value: "Привет", onSubmit });
    fireEvent.keyDown(screen.getByLabelText("Сообщение"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("ответ закончился: снова обычная «Отправить», «Стопа» нет", () => {
    stubScreen(false);
    renderComposer({ busy: false, value: "Привет" });
    expect(screen.getByRole("button", { name: "Отправить" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /останов|stop/i })).toBeNull();
  });
});
