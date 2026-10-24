// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { FlowExitCardProps, FlowMigrateDialogProps, FlowRunPanelProps, FlowStateNodeProps } from "@ykurilov/agent-chat-flows/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { oduvanchikFlowEditorSkin } from "../src/flows";
import { tandemFlowEditorSkin } from "@ykurilov/agent-chat-skin-tandem/flows";
import { FlowLabelsProvider, englishFlowLabels } from "@ykurilov/agent-chat-flows/react";

afterEach(cleanup);

const { FlowStateNode, FlowExitCard, FlowRunPanel, FlowJsonDialog, FlowMigrateDialog, FlowCheckPanel } = oduvanchikFlowEditorSkin;

const node = (extra: Partial<FlowStateNodeProps> = {}): FlowStateNodeProps => ({
  stateId: "intro",
  title: "Знакомство",
  goal: "Понять тему курса",
  exits: [
    { exitId: "e1", kind: "judge", text: "Понятна тема", target: "Поиск затыка", issues: { errors: 0, warnings: 0 } },
    { exitId: "e2", kind: "timer", text: "Тишина 3 ч", target: null, issues: { errors: 1, warnings: 0 } },
  ],
  tags: ["продажа"],
  start: true,
  final: false,
  noSideQuestions: false,
  selected: false,
  dimmed: false,
  run: null,
  issues: { errors: 1, warnings: 0 },
  renderInputHandle: () => <span data-testid="in" />,
  renderExitHandle: (exitId) => <span data-testid={`out-${exitId}`} />,
  onSelect: vi.fn(),
  ...extra,
});

describe("скин редактора сценария Одуванчика", () => {
  it("узел: название, цель, условия с ручками, старт, «куда — не выбрано», выбор по щелчку", () => {
    const props = node();
    render(<FlowStateNode {...props} />);
    const card = screen.getByRole("button", { name: "Знакомство" });
    expect(within(card).getByText("Понять тему курса")).toBeTruthy();
    expect(within(card).getByText("Сценарий начинается здесь")).toBeTruthy();
    expect(screen.getByTestId("in")).toBeTruthy();
    expect(screen.getByTestId("out-e1")).toBeTruthy();
    expect(within(card).getByText(/куда — не выбрано/)).toBeTruthy();
    fireEvent.click(card);
    expect(props.onSelect).toHaveBeenCalledOnce();
  });

  it("карточка условия: смена вида отдаёт { type }, цель — из списка", () => {
    const onChange = vi.fn();
    const props: FlowExitCardProps = {
      exitId: "e1",
      when: { type: "judge", text: "Понятна тема" },
      to: null,
      fields: [],
      ops: ["filled"],
      eventNames: { button: [], tool: [], app: [] },
      targets: [{ value: "offer", title: "Предложение" }],
      issues: [],
      canMoveUp: false,
      canMoveDown: true,
      onChange,
      onMoveUp: vi.fn(),
      onMoveDown: vi.fn(),
      onDelete: vi.fn(),
    };
    render(<FlowExitCard {...props} />);
    fireEvent.click(screen.getByRole("radio", { name: /Таймер/ }));
    expect(onChange).toHaveBeenLastCalledWith({ when: { type: "timer" }, to: null });
    fireEvent.change(screen.getByRole("combobox", { name: "Куда" }), { target: { value: "offer" } });
    expect(onChange).toHaveBeenLastCalledWith({ when: props.when, to: "offer" });
    expect((screen.getByRole("button", { name: "Выше" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("карточка условия: событие приложения показано подписью, значение — имя", () => {
    const onChange = vi.fn();
    render(
      <FlowExitCard
        exitId="e1"
        when={{ type: "event", event: "app", name: "paid" }}
        to={null}
        fields={[]}
        ops={["filled"]}
        eventNames={{ button: [], tool: [], app: ["booking_link", "paid"] }}
        eventLabels={{ paid: "Оплачено" }}
        targets={[]}
        issues={[]}
        canMoveUp={false}
        canMoveDown={false}
        onChange={onChange}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Что именно" }) as HTMLSelectElement;
    expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([["", ""], ["booking_link", "booking_link"], ["paid", "Оплачено"]]);
  });

  it("прогон: выбор с целью, несработающий выбор недоступен, «ничего из этого»", () => {
    const choose = vi.fn();
    const props: FlowRunPanelProps = {
      current: { stateId: "intro", title: "Знакомство", goal: "Понять тему" },
      choices: [
        { exitId: "e1", kind: "judge", text: "Понятна тема", target: "Поиск затыка", onChoose: choose },
        { exitId: "e2", kind: "data", text: "Тема = заказ", target: null, onChoose: vi.fn() },
      ],
      onNothing: vi.fn(),
      known: [{ fieldId: "name", name: "Имя", value: null, stale: false, onChange: vi.fn() }],
      nextQuestion: "Имя",
      path: [{ stateId: "intro", title: "Знакомство", via: null }],
      canGoBack: false,
      onBack: vi.fn(),
      onRestart: vi.fn(),
      onFinish: vi.fn(),
    };
    render(<FlowRunPanel {...props} />);
    expect(screen.getByText("Прогон · шаг 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Понятна тема/ }));
    expect(choose).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: /Тема = заказ/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Ничего из этого/ }));
    expect(props.onNothing).toHaveBeenCalledOnce();
    const name = screen.getByRole("textbox", { name: "Имя" });
    fireEvent.change(name, { target: { value: "Анна" } });
    fireEvent.blur(name);
    expect(props.known[0]!.onChange).toHaveBeenCalledWith("Анна");
  });

  it("окно JSON: правленый текст загружается, ошибки видны", () => {
    const onLoad = vi.fn();
    render(<FlowJsonDialog json="{}" errors={["states: нужен список"]} onCopy={vi.fn()} onDownload={vi.fn()} onLoad={onLoad} onClose={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("states: нужен список");
    fireEvent.change(screen.getByRole("textbox", { name: "Граф в формате JSON" }), { target: { value: '{"a":1}' } });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить" }));
    expect(onLoad).toHaveBeenCalledWith('{"a":1}');
  });

  it("перевод чатов: удалённому состоянию выбирается цель, перевод по кнопке", () => {
    const onTargetChange = vi.fn();
    const props: FlowMigrateDialogProps = {
      rows: [{ versionId: "v1", stateId: "old", stateTitle: "Старое", chats: 2, removed: true, target: null, onTargetChange }],
      targets: [{ value: "offer", title: "Предложение" }],
      busy: false,
      failed: false,
      moved: null,
      canMigrate: false,
      onMigrate: vi.fn(),
      onClose: vi.fn(),
    };
    render(<FlowMigrateDialog {...props} />);
    expect(screen.getByText("удалено в новой версии")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Куда" }), { target: { value: "offer" } });
    expect(onTargetChange).toHaveBeenCalledWith("offer");
    expect((screen.getByRole("button", { name: "Перевести" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("проверка: чисто — «Проблем не нашлось», ошибка — переход к месту", () => {
    const onGo = vi.fn();
    const { rerender } = render(<FlowCheckPanel issues={[]} />);
    expect(screen.getByText("Проблем не нашлось.")).toBeTruthy();
    rerender(<FlowCheckPanel issues={[{ level: "error", code: "x", message: "Нет старта", place: {}, onGo }]} />);
    fireEvent.click(screen.getByRole("button", { name: /Нет старта/ }));
    expect(onGo).toHaveBeenCalledOnce();
  });
});

it("unknown common exceptions stay visible and removable",()=>{
 const change=vi.fn();render(<oduvanchikFlowEditorSkin.FlowAnyStatePanel except={["removed_state"]} states={[]} onExceptChange={change} exits={<div/>} onAddExit={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"removed_state"}));expect(change).toHaveBeenCalledWith([]);
});

it("implements every current slot independently and renders published DS controls with Phosphor", () => {
  expect(Object.keys(oduvanchikFlowEditorSkin).sort()).toEqual(Object.keys(tandemFlowEditorSkin).sort());
  for (const slot of Object.keys(tandemFlowEditorSkin) as Array<keyof typeof tandemFlowEditorSkin>) {
    expect(oduvanchikFlowEditorSkin[slot]).not.toBe(tandemFlowEditorSkin[slot]);
  }
  const { container } = render(<FlowStateNode {...node()} />);
  const icons = container.querySelectorAll("svg");
  expect(icons.length).toBeGreaterThan(0);
  for (const icon of icons) expect(icon.getAttribute("viewBox")).toBe("0 0 256 256");
});

it("DS controlled Select keeps numeric condition values and target strings, exposes invalid state", () => {
  const onChange = vi.fn();
  const props: FlowExitCardProps = {
    exitId: "amount", when: { type: "data", field: "amount", op: "gt", value: 3 }, to: null,
    fields: [{ id: "amount", name: "Сумма", type: "number", about: "", options: [] }], ops: ["eq", "gt"],
    targets: [{ value: "next", title: "Следующее" }], eventNames: { button: [], tool: [], app: [] },
    issues: [], canMoveUp: false, canMoveDown: false, onChange,
    onMoveUp() {}, onMoveDown() {}, onDelete() {},
  };
  const { container } = render(<FlowExitCard {...props} />);
  expect(container.querySelector(".yk-input__control--select")).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Куда" }).getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(screen.getByRole("combobox", { name: "Как сравнить" }), { target: { value: "eq" } });
  expect(onChange).toHaveBeenLastCalledWith({ when: { ...props.when, op: "eq" }, to: null });
  fireEvent.change(screen.getByRole("combobox", { name: "Куда" }), { target: { value: "next" } });
  expect(onChange).toHaveBeenLastCalledWith({ when: props.when, to: "next" });
  expect(screen.getByRole("radio", { name: /Данные/ }).classList.contains("yk-segmented__item")).toBe(true);
});

it("extra panels use the application's English labels", () => {
  const Panel = oduvanchikFlowEditorSkin.FlowAnyStatePanel;
  const { container } = render(<FlowLabelsProvider labels={englishFlowLabels}><Panel except={[]} states={[]} exits={<div />} onExceptChange={() => {}} onAddExit={() => {}} /></FlowLabelsProvider>);
  expect(screen.getByRole("region", { name: englishFlowLabels.editor.anyStatePanel.title })).toBeTruthy();
  const add = screen.getByRole("button", { name: englishFlowLabels.editor.conditionKinds.event });
  expect(add.classList.contains("yk-button")).toBe(true);
  expect(container.textContent).not.toContain("Общие переходы");
});
