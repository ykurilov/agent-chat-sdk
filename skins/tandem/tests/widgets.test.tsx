// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WidgetView } from "@ykurilov/agent-chat-react";
import { tandemSkin } from "../src/index";
import { TandemSuggestedReplies } from "../src/widgets/suggested-replies";
import { TandemWidget } from "../src/widgets/widget";

afterEach(cleanup);

const base = { toolCallId: "w1", active: true, pending: false, answeredByMessage: false } as const;
type Of<K extends WidgetView["kind"]> = Extract<WidgetView, { kind: K }>;
const choice = (overrides: Partial<Of<"choice">> = {}): WidgetView => ({
  ...base,
  kind: "choice",
  question: "Куда поедем?",
  options: ["Море", "Горы", "Лес"],
  onChoose: vi.fn(),
  ...overrides,
});
const multi = (overrides: Partial<Of<"multi_choice">> = {}): WidgetView => ({
  ...base,
  kind: "multi_choice",
  question: "Что взять?",
  options: ["Палатку", "Котелок", "Гитару"],
  min: 1,
  max: 2,
  onSubmit: vi.fn(),
  ...overrides,
});
const rating = (overrides: Partial<Of<"rating">> = {}): WidgetView => ({
  ...base,
  kind: "rating",
  question: "Как вам ответ?",
  scale: "stars",
  from: 1,
  to: 5,
  onRate: vi.fn(),
  ...overrides,
});
const form = (overrides: Partial<Of<"form">> = {}): WidgetView => ({
  ...base,
  kind: "form",
  title: "Анкета",
  fields: [
    { name: "name", label: "Имя", kind: "text", required: true },
    { name: "age", label: "Возраст", kind: "number", required: false, min: 18, max: 99 },
    { name: "day", label: "Дата", kind: "date", required: false },
    { name: "plan", label: "Тариф", kind: "select", required: false, options: ["Старт", "Про"] },
    { name: "note", label: "Заметка", kind: "text", required: false, multiline: true },
  ],
  onSubmit: vi.fn(),
  ...overrides,
});

const minHeight = (element: HTMLElement) => Number.parseFloat(element.style.minHeight);

describe("Тандем: выбор одного варианта", () => {
  it("подписанная группа: radiogroup подписан вопросом, подсказка «можно ответить своими словами»", () => {
    render(<TandemWidget {...choice()} />);
    const group = screen.getByRole("radiogroup");
    expect(group.getAttribute("aria-labelledby")).toBeTruthy();
    expect(document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent).toBe("Куда поедем?");
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByText("Выберите вариант или ответьте своими словами")).toBeTruthy();
  });

  it("одно нажатие отвечает; цель не меньше 44 px", () => {
    const onChoose = vi.fn();
    render(<TandemWidget {...choice({ onChoose })} />);
    const option = screen.getByRole("radio", { name: "Горы" });
    expect(minHeight(option)).toBeGreaterThanOrEqual(44);
    fireEvent.click(option);
    expect(onChoose).toHaveBeenCalledWith("Горы");
  });

  it("клавиатура: в группу попадает один вариант, стрелки двигают фокус, Enter и пробел отвечают", () => {
    const onChoose = vi.fn();
    render(<TandemWidget {...choice({ onChoose })} />);
    const [first, second, third] = screen.getAllByRole("radio") as HTMLElement[];
    expect([first, second, third].map((option) => option!.tabIndex)).toEqual([0, -1, -1]);
    first!.focus();
    fireEvent.keyDown(first!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second!, { key: "ArrowUp" });
    fireEvent.keyDown(first!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third!, { key: "Enter" });
    expect(onChoose).toHaveBeenCalledWith("Лес");
    fireEvent.keyDown(third!, { key: " " });
    expect(onChoose).toHaveBeenCalledTimes(2);
  });

  it("отвечен: выбранный отмечен, остальное не нажимается", () => {
    render(<TandemWidget {...choice({ active: false, chosen: "Горы", onChoose: undefined })} />);
    const chosen = screen.getByRole("radio", { name: "Горы" });
    expect(chosen.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Море" }).getAttribute("aria-checked")).toBe("false");
    for (const option of screen.getAllByRole("radio")) expect(option.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Море" }));
    expect(screen.queryByText("Выберите вариант или ответьте своими словами")).toBeNull();
  });

  it("пока ответ уходит, варианты заняты; сбой — причина словами", () => {
    const onChoose = vi.fn();
    render(<TandemWidget {...choice({ onChoose, pending: true, failure: "Ответ не отправился, попробуйте ещё раз" })} />);
    fireEvent.click(screen.getByRole("radio", { name: "Море" }));
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Ответ не отправился, попробуйте ещё раз");
  });

  it("ответ дан сообщением — пометка", () => {
    render(<TandemWidget {...choice({ active: false, answeredByMessage: true, onChoose: undefined })} />);
    expect(screen.getByText("Ответ дан сообщением")).toBeTruthy();
  });

  it("тексты модели — только текстом", () => {
    render(<TandemWidget {...choice({ question: "<b>жирный</b>", options: ["<img src=x onerror=alert(1)>", "**звёзды**"] })} />);
    expect(screen.getByText("<b>жирный</b>")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "<img src=x onerror=alert(1)>" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "**звёзды**" })).toBeTruthy();
    expect(document.querySelector("img, b, strong")).toBeNull();
  });

  it("виджет не забирает фокус из поля ввода", () => {
    const field = document.createElement("textarea");
    document.body.append(field);
    field.focus();
    render(<TandemWidget {...choice()} />);
    expect(document.activeElement).toBe(field);
    field.remove();
  });
});

describe("Тандем: несколько вариантов", () => {
  it("флажки; «Готово» активна только при выборе в пределах min..max; выбор уходит списком", () => {
    const onSubmit = vi.fn();
    render(<TandemWidget {...multi({ onSubmit })} />);
    const done = screen.getByRole("button", { name: "Готово" }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    expect(screen.getByText("Выберите от 1 до 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Гитару" }));
    expect(done.disabled).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Палатку" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Котелок" }));
    expect(done.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Котелок" }));
    fireEvent.click(done);
    expect(onSubmit).toHaveBeenCalledWith(["Палатку", "Гитару"]);
    expect(minHeight(done)).toBeGreaterThanOrEqual(44);
  });

  it("отвечен: выбранное отмечено, ничего не нажимается", () => {
    render(<TandemWidget {...multi({ active: false, chosen: ["Котелок"], onSubmit: undefined })} />);
    expect((screen.getByRole("checkbox", { name: "Котелок" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Палатку" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Готово" })).toBeNull();
  });
});

describe("Тандем: оценка", () => {
  it("звёзды 1–5: подписаны для диктора, одно нажатие отвечает", () => {
    const onRate = vi.fn();
    render(<TandemWidget {...rating({ onRate })} />);
    const stars = within(screen.getByRole("radiogroup")).getAllByRole("radio");
    expect(stars).toHaveLength(5);
    expect(stars[3]!.getAttribute("aria-label")).toBe("Оценка 4 из 5");
    expect(minHeight(stars[0]!)).toBeGreaterThanOrEqual(44);
    fireEvent.click(stars[3]!);
    expect(onRate).toHaveBeenCalledWith(4);
  });

  it("шкала с подписями краёв; стрелки двигают фокус", () => {
    const onRate = vi.fn();
    render(<TandemWidget {...rating({ scale: "range", from: 0, to: 10, fromLabel: "Точно нет", toLabel: "Точно да", onRate })} />);
    const marks = screen.getAllByRole("radio");
    expect(marks).toHaveLength(11);
    expect(screen.getByText("Точно нет")).toBeTruthy();
    expect(screen.getByText("Точно да")).toBeTruthy();
    marks[0]!.focus();
    fireEvent.keyDown(marks[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(marks[1]);
    fireEvent.keyDown(marks[1]!, { key: "Enter" });
    expect(onRate).toHaveBeenCalledWith(1);
  });

  it("отвечено: оценка отмечена", () => {
    render(<TandemWidget {...rating({ active: false, value: 3, onRate: undefined })} />);
    expect(screen.getByRole("radio", { name: "Оценка 3 из 5" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("Тандем: форма", () => {
  it("поля по видам: цифры, дата, список, многострочный текст, пометка обязательного", () => {
    render(<TandemWidget {...form()} />);
    expect(screen.getByRole("group", { name: "Анкета" })).toBeTruthy();
    const name = screen.getByLabelText(/Имя/) as HTMLInputElement;
    expect(name.required).toBe(true);
    expect((screen.getByLabelText("Возраст") as HTMLInputElement).inputMode).toBe("numeric");
    expect((screen.getByLabelText("Дата") as HTMLInputElement).type).toBe("date");
    expect(screen.getByLabelText("Тариф").tagName).toBe("SELECT");
    expect(screen.getByLabelText("Заметка").tagName).toBe("TEXTAREA");
    expect(minHeight(name)).toBeGreaterThanOrEqual(44);
  });

  it("«Отправить» отдаёт введённое; ошибки полей видны и связаны с полем", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<TandemWidget {...form({ onSubmit })} />);
    fireEvent.change(screen.getByLabelText(/Имя/), { target: { value: "Юля" } });
    fireEvent.change(screen.getByLabelText("Возраст"), { target: { value: "17" } });
    fireEvent.change(screen.getByLabelText("Тариф"), { target: { value: "Про" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "Юля", age: "17", plan: "Про" }));
    const view = form({ onSubmit }) as Of<"form">;
    rerender(<TandemWidget {...view} fields={view.fields.map((field) => (field.name === "age" ? { ...field, error: "Допустимо от 18 до 99" } : field))} />);
    const age = screen.getByLabelText("Возраст");
    expect(age.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(age.getAttribute("aria-describedby")!)?.textContent).toBe("Допустимо от 18 до 99");
    expect((screen.getByLabelText(/Имя/) as HTMLInputElement).value).toBe("Юля");
  });

  it("поле в фокусе прокручивается в видимую часть: клавиатура телефона его не прячет", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<TandemWidget {...form()} />);
    fireEvent.focus(screen.getByLabelText("Возраст"));
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("отправлена: введённое видно, поля только для чтения, кнопки нет", () => {
    render(<TandemWidget {...form({ active: false, values: { name: "Юля", age: 30 }, onSubmit: undefined })} />);
    expect((screen.getByLabelText(/Имя/) as HTMLInputElement).value).toBe("Юля");
    expect((screen.getByLabelText("Возраст") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("Возраст") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Отправить" })).toBeNull();
  });
});

describe("Тандем: свой виджет и подсказки", () => {
  it("компонент страницы внутри; без него — вопрос и «Ответьте сообщением»", () => {
    const { rerender } = render(<TandemWidget {...base} kind="custom" name="pick_slot" content={<p>слоты</p>} />);
    expect(screen.getByText("слоты")).toBeTruthy();
    rerender(<TandemWidget {...base} kind="custom" name="pick_slot" question="Когда удобно?" />);
    expect(screen.getByText("Когда удобно?")).toBeTruthy();
    expect(screen.getByText("Ответьте сообщением")).toBeTruthy();
  });

  it("подсказки: кнопки в строку с переносом, не меньше 44 px, нажатие отдаёт текст", () => {
    const onPick = vi.fn();
    render(<TandemSuggestedReplies replies={["Да", "Расскажи подробнее"]} onPick={onPick} disabled={false} />);
    const button = screen.getByRole("button", { name: "Расскажи подробнее" });
    expect(minHeight(button)).toBeGreaterThanOrEqual(44);
    expect(button.parentElement?.className).toContain("flex-wrap");
    fireEvent.click(button);
    expect(onPick).toHaveBeenCalledWith("Расскажи подробнее");
  });

  it("скин Тандем объявляет Widget и SuggestedReplies", () => {
    expect(tandemSkin.Widget).toBe(TandemWidget);
    expect(tandemSkin.SuggestedReplies).toBe(TandemSuggestedReplies);
  });
});
