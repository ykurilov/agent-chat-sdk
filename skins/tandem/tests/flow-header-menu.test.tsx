// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { FlowHeaderProps } from "@ykurilov/agent-chat-flows/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowLabelsProvider } from "@ykurilov/agent-chat-flows/react";
import { englishFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { tandemFlowEditorSkin } from "../src/flows";

// Шапка доски на телефоне: лишние кнопки уходят в меню «⋯», Прогон и сохранение остаются.

afterEach(cleanup);
const { FlowHeader } = tandemFlowEditorSkin;

const header = (extra: Partial<FlowHeaderProps> = {}): FlowHeaderProps => ({
  name: "Продажа",
  onRename: vi.fn(),
  mode: "edit",
  onModeChange: vi.fn(),
  issues: { errors: 0, warnings: 0 },
  onAddState: vi.fn(),
  onOpenCard: vi.fn(),
  onOpenJson: vi.fn(),
  onSave: vi.fn(),
  saving: false,
  dirty: true,
  onOpenMigrate: vi.fn(),
  onOpenTestChat: vi.fn(),
  fullscreen: { active: false, onToggle: vi.fn() },
  ...extra,
});

describe("меню «⋯» шапки доски", () => {
  it("кнопка есть и доступна по имени; закрыта по умолчанию; Прогон и Сохранить на виду", () => {
    render(<FlowHeader {...header()} compact />);
    const more = screen.getByRole("button", { name: "Ещё действия" });
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: /Прогон/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Сохранить/ })).toBeTruthy();
  });

  it("открывается, показывает скрытые кнопки; выбор пункта вызывает действие и закрывает меню", () => {
    const props = header();
    render(<FlowHeader {...props} compact />);
    fireEvent.click(screen.getByRole("button", { name: "Ещё действия" }));
    const menu = screen.getByRole("menu");
    const names = within(menu).getAllByRole("menuitem").map((item) => item.textContent);
    expect(names).toEqual(["Состояние", "Карточка и заметки", "JSON", "Перевести чаты", "Тестовый чат", "На весь экран"]);
    expect(document.activeElement).toBe(within(menu).getAllByRole("menuitem")[0]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "JSON" }));
    expect(props.onOpenJson).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ещё действия" }));
  });

  it("клавиатура: стрелки и Home/End ходят по кругу, Esc закрывает и возвращает фокус, Tab закрывает", () => {
    render(<FlowHeader {...header()} />);
    const more = screen.getByRole("button", { name: "Ещё действия" });
    more.focus();
    fireEvent.keyDown(more, { key: "ArrowDown" });
    const items = () => screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(items()[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items().at(-1));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(items().at(-1));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(more);
    fireEvent.click(more);
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("клик в сторону закрывает; в прогоне «Состояние» и «Карточка» недоступны; без необязательных кнопок их нет", () => {
    render(<FlowHeader {...header({ mode: "run", onOpenMigrate: undefined, onOpenTestChat: undefined, fullscreen: undefined })} />);
    fireEvent.click(screen.getByRole("button", { name: "Ещё действия" }));
    expect((screen.getByRole("menuitem", { name: "Состояние" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("menuitem", { name: "Карточка и заметки" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("полный экран включён — пункт «Выйти из полного экрана»", () => {
    render(<FlowHeader {...header({ fullscreen: { active: true, onToggle: vi.fn() } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Ещё действия" }));
    expect(screen.getByRole("menuitem", { name: "Выйти из полного экрана" })).toBeTruthy();
  });
});

it("common settings remains a view action in a locked compact header",()=>{
 const onOpenAnyState=vi.fn();render(<FlowHeader {...header({readOnly:true,onOpenAnyState})} compact/>);
 fireEvent.click(screen.getByRole("button",{name:"Ещё действия"}));
 const item=screen.getByRole("menuitem",{name:"Общие переходы"});expect(item.getAttribute("aria-disabled")).not.toBe("true");fireEvent.click(item);expect(onOpenAnyState).toHaveBeenCalledOnce();
});

it("common settings entry uses the supplied language labels",()=>{
 const labels={...englishFlowLabels,editor:{...englishFlowLabels.editor,anyStatePanel:{...englishFlowLabels.editor.anyStatePanel,title:"Global route settings"}}};
 render(<FlowLabelsProvider labels={labels}><FlowHeader {...header({onOpenAnyState:vi.fn()})}/></FlowLabelsProvider>);
 expect(screen.getByRole("button",{name:"Global route settings"})).toBeTruthy();
});
