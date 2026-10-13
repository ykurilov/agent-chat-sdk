// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChatListSkin } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tandemSkin } from "../src";

// Всплывающие меню Radix опираются на замеры, которых в jsdom нет.
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
});

/** Ширина экрана: широкая — список рядом с чатом, узкая — панель. */
function stubScreen(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

const { ChatList, ChatWorkspace } = tandemSkin;

const items = [
  { id: "c2", title: "Про Грецию", active: true },
  { id: "c1", title: "Налоги", active: false },
];

function renderList(props: Partial<ComponentProps<ChatListSkin["ChatList"]>> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onRequestDelete: vi.fn(),
  };
  render(<ChatList status="ready" items={items} creating={false} {...handlers} {...props} />);
  return handlers;
}

/** Меню строки открывается с клавиатуры: в jsdom нет настоящей мыши. */
function openRowMenu(title: string) {
  const trigger = screen.getByRole("button", { name: `Действия с чатом «${title}»` });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("список чатов Тандема", () => {
  it("строки в порядке списка; открытый чат помечен aria-current, остальные нет", () => {
    renderList();
    expect(screen.getByRole("button", { name: "Про Грецию" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Налоги" }).getAttribute("aria-current")).toBeNull();
  });

  it("чат из мессенджера помечен названием мессенджера; веб-чат без пометки", () => {
    renderList({
      items: [
        { id: "tg", title: "Из телеграма", active: false, origin: "telegram" },
        { id: "vk", title: "Из ВК", active: false, origin: "vk" },
        { id: "mx", title: "Из MAX", active: false, origin: "max" },
        { id: "web", title: "Из браузера", active: true },
      ],
    });
    const mark = (id: string) => document.querySelector(`[data-chat-id="${id}"] [data-chat-origin]`)?.textContent;
    expect(mark("tg")).toBe("Telegram");
    expect(mark("vk")).toBe("ВКонтакте");
    expect(mark("mx")).toBe("MAX");
    expect(mark("web")).toBeUndefined();
    expect(screen.getByRole("button", { name: "Из телеграма" })).toBeTruthy();
  });

  it("закрытый чат помечен «Закрыт», причина — подсказкой; открытый чат без пометки", () => {
    renderList({
      items: [
        { id: "done", title: "Заявка", active: false, closed: { code: "form_submitted", message: "Заявка отправлена, чат закрыт" } },
        { id: "open", title: "Вопросы", active: true },
      ],
    });
    const mark = (id: string) => document.querySelector<HTMLElement>(`[data-chat-id="${id}"] [data-chat-closed]`);
    expect(mark("done")?.textContent).toBe("Закрыт");
    expect(mark("done")?.getAttribute("data-chat-closed")).toBe("form_submitted");
    expect(mark("done")?.getAttribute("title")).toBe("Заявка отправлена, чат закрыт");
    expect(mark("open")).toBeNull();
  });

  it("выбор строки и «Новый чат» сообщают слою поведения", () => {
    const { onSelect, onCreate } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Налоги" }));
    expect(onSelect).toHaveBeenCalledWith("c1");
    fireEvent.click(screen.getByRole("button", { name: "Новый чат" }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("пока чат создаётся, «Новый чат» недоступен", () => {
    renderList({ creating: true });
    expect((screen.getByRole("button", { name: "Новый чат" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("загрузка и ошибка: надпись, сообщение и «Повторить»", () => {
    const onRetry = vi.fn();
    renderList({ status: "error", items: [], error: "Список чатов не загрузился", onRetry });
    expect(screen.getByRole("alert").textContent).toBe("Список чатов не загрузился");
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(onRetry).toHaveBeenCalledOnce();
    cleanup();
    renderList({ status: "loading", items: [] });
    expect(screen.getByText("Загружаем чаты…")).toBeTruthy();
  });

  it("меню строки: «Удалить» просит подтверждения, ничего не удаляя", async () => {
    const { onRequestDelete } = renderList();
    openRowMenu("Налоги");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Удалить" }));
    expect(onRequestDelete).toHaveBeenCalledWith("c1");
  });

  it("меню строки: «Переименовать» ставит поле на место названия; Enter сохраняет новое название", async () => {
    const { onRename } = renderList();
    openRowMenu("Налоги");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Переименовать" }));
    const field = (await screen.findByLabelText("Название чата")) as HTMLInputElement;
    expect(field.value).toBe("Налоги");
    fireEvent.change(field, { target: { value: "Налоги 2026" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onRename).toHaveBeenCalledExactlyOnceWith("c1", "Налоги 2026");
    expect(screen.queryByLabelText("Название чата")).toBeNull();
    expect(screen.getByRole("button", { name: "Налоги" })).toBeTruthy();
  });

  it("безымянный чат: в строке надпись «Новый чат», поле переименования пустое, без правки ничего не уходит", async () => {
    const { onRename } = renderList({ items: [{ id: "c9", title: null, active: true }] });
    expect(screen.getAllByText("Новый чат", { selector: "button" })).toHaveLength(2);
    openRowMenu("Новый чат");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Переименовать" }));
    const field = (await screen.findByLabelText("Название чата")) as HTMLInputElement;
    expect(field.value).toBe("");
    fireEvent.blur(field);
    expect(onRename).not.toHaveBeenCalled();
  });

  it("после Enter фокус возвращается на кнопку строки", async () => {
    renderList();
    openRowMenu("Налоги");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Переименовать" }));
    const field = await screen.findByLabelText("Название чата");
    fireEvent.change(field, { target: { value: "Налоги 2026" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Налоги" })));
  });

  it("Escape отменяет переименование; уход из поля сохраняет", async () => {
    const { onRename } = renderList();
    openRowMenu("Налоги");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Переименовать" }));
    const field = await screen.findByLabelText("Название чата");
    fireEvent.change(field, { target: { value: "Не сохранять" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();

    openRowMenu("Про Грецию");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Переименовать" }));
    const second = await screen.findByLabelText("Название чата");
    fireEvent.change(second, { target: { value: "Греция" } });
    fireEvent.blur(second);
    expect(onRename).toHaveBeenCalledExactlyOnceWith("c2", "Греция");
  });

  it("окно подтверждения: название чата, «Удалить» подтверждает, «Отмена» отменяет", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderList({ deleteRequest: { title: "Налоги", pending: false, onConfirm, onCancel } });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Удалить чат?")).toBeTruthy();
    expect(within(dialog).getByText(/«Налоги»/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("Escape в окне подтверждения — отмена; окна нет, пока нет запроса", async () => {
    expect(renderList()).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    const onCancel = vi.fn();
    renderList({ deleteRequest: { title: "Налоги", pending: false, onConfirm: vi.fn(), onCancel } });
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
  });
});

describe("каркас списка чатов Тандема", () => {
  it("узкий экран: Escape в поле переименования отменяет только правку, панель остаётся открытой", async () => {
    stubScreen(false);
    const onListOpenChange = vi.fn();
    render(
      <ChatWorkspace
        list={<ChatList status="ready" items={items} creating={false} onSelect={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onRequestDelete={vi.fn()} />}
        activeTitle="Про Грецию"
        listOpen
        onListOpenChange={onListOpenChange}
      >
        <p>открытый чат</p>
      </ChatWorkspace>,
    );
    const panel = await screen.findByRole("dialog");
    const trigger = within(panel).getByRole("button", { name: "Действия с чатом «Налоги»" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Переименовать" }));
    const field = await screen.findByLabelText("Название чата");
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Название чата")).toBeNull());
    expect(onListOpenChange).not.toHaveBeenCalled();
  });

  const renderWorkspace = (props: Partial<ComponentProps<ChatListSkin["ChatWorkspace"]>> = {}) => {
    const onListOpenChange = vi.fn();
    render(
      <ChatWorkspace
        list={<p>содержимое списка</p>}
        activeTitle="Про Грецию"
        listOpen={false}
        onListOpenChange={onListOpenChange}
        {...props}
      >
        <p>открытый чат</p>
      </ChatWorkspace>,
    );
    return { onListOpenChange };
  };

  it("широкий экран: список и чат рядом, кнопки «Чаты» нет", () => {
    stubScreen(true);
    renderWorkspace();
    expect(screen.getByText("содержимое списка")).toBeTruthy();
    expect(screen.getByText("открытый чат")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Чаты" })).toBeNull();
  });

  it("узкий экран: список спрятан, на виду название чата и кнопка «Чаты»; кнопка просит открыть панель", () => {
    stubScreen(false);
    const { onListOpenChange } = renderWorkspace();
    expect(screen.queryByText("содержимое списка")).toBeNull();
    expect(screen.getByText("Про Грецию")).toBeTruthy();
    expect(screen.getByText("открытый чат")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Чаты" }));
    expect(onListOpenChange).toHaveBeenCalledWith(true);
  });

  it("без списка (право chatList запрещено), широкий экран: только чат, без заголовка «Чаты»", () => {
    stubScreen(true);
    renderWorkspace({ list: undefined });
    expect(screen.getByText("открытый чат")).toBeTruthy();
    expect(screen.queryByText("Чаты")).toBeNull();
    expect(document.querySelector("aside")).toBeNull();
  });

  it("без списка, узкий экран: ни кнопки «Чаты», ни панели, даже если она просится открытой", () => {
    stubScreen(false);
    renderWorkspace({ list: undefined, listOpen: true });
    expect(screen.getByText("открытый чат")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Чаты" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("узкий экран: открытая панель показывает список; закрытие панели просит закрыть", async () => {
    stubScreen(false);
    const { onListOpenChange } = renderWorkspace({ listOpen: true });
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("содержимое списка")).toBeTruthy();
    fireEvent.keyDown(panel, { key: "Escape" });
    await waitFor(() => expect(onListOpenChange).toHaveBeenCalledWith(false));
  });
});
