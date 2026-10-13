// @vitest-environment jsdom
import { TooltipProvider } from "@tandem/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemAgentMessage } from "../src/agent-message";
import { TandemBranchSwitcher } from "../src/branch-switcher";
import { TandemMessageEditor } from "../src/message-editor";
import { TandemUserMessage } from "../src/user-message";

afterEach(cleanup);

describe("переключатель веток", () => {
  it("показывает «2/3»; стрелки зовут обработчики", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(<TandemBranchSwitcher position={2} count={3} onPrevious={onPrevious} onNext={onNext} />);
    expect(screen.getByRole("group", { name: "Вариант 2 из 3" }).textContent).toBe("2/3");
    fireEvent.click(screen.getByRole("button", { name: "Предыдущий вариант" }));
    fireEvent.click(screen.getByRole("button", { name: "Следующий вариант" }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("на краю стрелка неактивна", () => {
    render(<TandemBranchSwitcher position={1} count={2} onNext={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Предыдущий вариант" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Следующий вариант" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("сообщение собеседника", () => {
  const renderMessage = (props: Partial<Parameters<typeof TandemUserMessage>[0]> = {}) =>
    render(
      <TooltipProvider>
        <TandemUserMessage text="Привет" {...props} />
      </TooltipProvider>,
    );

  it("«Изменить» есть, пока правка доступна; на телефоне без наведения кнопка в дереве и нажимается", () => {
    const onEdit = vi.fn();
    renderMessage({ onEdit });
    fireEvent.click(screen.getByRole("button", { name: "Изменить сообщение" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("правка недоступна — кнопки нет, а строка под пузырём занимает место: лента не подпрыгивает", () => {
    const { container, rerender } = renderMessage({ onEdit: vi.fn() });
    const withEdit = container.querySelector("div > div:last-child")!.className;
    rerender(
      <TooltipProvider>
        <TandemUserMessage text="Привет" />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: "Изменить сообщение" })).toBeNull();
    expect(container.querySelector("div > div:last-child")!.className).toBe(withEdit);
  });

  it("переключатель веток стоит под пузырём", () => {
    renderMessage({ branchSwitcher: <span>2/2</span> });
    expect(screen.getByText("2/2")).toBeTruthy();
  });
});

describe("правка сообщения", () => {
  const renderEditor = (props: Partial<Parameters<typeof TandemMessageEditor>[0]> = {}) => {
    const handlers = { onValueChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn() };
    render(<TandemMessageEditor value="Привет" canSave {...handlers} {...props} />);
    return handlers;
  };

  it("поле с текстом и фокусом; кнопки «Отправить» и «Отмена»", () => {
    const handlers = renderEditor();
    const field = screen.getByLabelText("Изменить сообщение") as HTMLTextAreaElement;
    expect(field.value).toBe("Привет");
    expect(document.activeElement).toBe(field);
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it("Enter отправляет, Shift+Enter — нет, Esc отменяет", () => {
    const handlers = renderEditor();
    const field = screen.getByLabelText("Изменить сообщение");
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(handlers.onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it("пустой текст отправить нельзя", () => {
    const handlers = renderEditor({ canSave: false });
    expect((screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText("Изменить сообщение"), { key: "Enter" });
    expect(handlers.onSave).not.toHaveBeenCalled();
  });
});

describe("ответ агента: ветки и переделка", () => {
  it("ошибка отправки правки показана под полем; текст в поле на месте; без ошибки блока нет", () => {
    const { rerender } = render(<TandemMessageEditor value="Привет" canSave error="Ответ ещё идёт" onValueChange={vi.fn()} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toBe("Ответ ещё идёт");
    expect((screen.getByLabelText("Изменить сообщение") as HTMLTextAreaElement).value).toBe("Привет");
    rerender(<TandemMessageEditor value="Привет" canSave onValueChange={vi.fn()} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("в строке под пузырём — переключатель и «Переделать ответ»; во время ответа их нет", () => {
    const onRegenerate = vi.fn();
    const answer = (status: "streaming" | "complete") => (
      <TooltipProvider>
        <TandemAgentMessage status={status} onCopy={vi.fn()} empty={false} branchSwitcher={<span>2/3</span>} onRegenerate={onRegenerate}>
          <p>Текст</p>
        </TandemAgentMessage>
      </TooltipProvider>
    );
    const { rerender } = render(answer("streaming"));
    expect(screen.queryByText("2/3")).toBeNull();
    expect(screen.queryByRole("button", { name: "Переделать ответ" })).toBeNull();
    rerender(answer("complete"));
    expect(screen.getByText("2/3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Переделать ответ" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});

describe("правка сообщения с файлами", () => {
  it("файлы сообщения видны над полем правки; без файлов списка нет", () => {
    const view = { label: "Вложения", items: [{ id: "a", name: "кот.png", kind: "image" as const, url: "/f/a", mediaType: "image/png" }] };
    const { rerender } = render(<TandemMessageEditor value="" canSave attachments={view} onValueChange={vi.fn()} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("list", { name: "Вложения" })).toBeTruthy();
    expect(screen.getByAltText("кот.png")).toBeTruthy();
    rerender(<TandemMessageEditor value="Привет" canSave onValueChange={vi.fn()} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("list")).toBeNull();
  });
});
