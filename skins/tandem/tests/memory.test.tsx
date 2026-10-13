// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AgentMemory, createMemoryApi, russianLabels, ChatLabelsProvider } from "@ykurilov/agent-chat-react";
import type { MemorySkin } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tandemMemorySkin, tandemSkin } from "../src";

// Окно подтверждения опирается на замеры, которых в jsdom нет.
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

afterEach(cleanup);

const { MemoryScreen, MemoryGroup, MemoryNoteRow, MemoryNoteEditor, MemoryConfirm, MemoryMerge } = tandemMemorySkin;

type ScreenProps = ComponentProps<MemorySkin["MemoryScreen"]>;
const counts = { total: 12, limit: 200, shown: 12 };
function renderScreen(props: Partial<ScreenProps> = {}) {
  const handlers = { onAdd: vi.fn(), onClearAll: vi.fn(), onRetry: vi.fn() };
  render(
    <MemoryScreen status="ready" counts={counts} {...handlers} {...props}>
      {props.children ?? <p>записи</p>}
    </MemoryScreen>,
  );
  return handlers;
}

describe("скин памяти Тандема: договор", () => {
  it("шесть компонентов договора 11; чат и список чатов договор памяти не получили", () => {
    expect(Object.keys(tandemMemorySkin).sort()).toEqual(["MemoryConfirm", "MemoryGroup", "MemoryMerge", "MemoryNoteEditor", "MemoryNoteRow", "MemoryScreen"]);
    for (const key of Object.keys(tandemMemorySkin)) expect(key in tandemSkin).toBe(false);
  });
});

describe("экран памяти", () => {
  it("заголовок, счётчик и кнопки; кнопки зовут колбэки", () => {
    const { onAdd, onClearAll } = renderScreen();
    expect(screen.getByRole("heading", { name: "Память" })).toBeTruthy();
    expect(screen.getByText("Записей: 12 из 200")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect(onAdd).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Стереть всю память" }));
    expect(onClearAll).toHaveBeenCalledOnce();
  });

  it("нет обработчика — нет и кнопки", () => {
    renderScreen({ onAdd: undefined, onClearAll: undefined });
    expect(screen.queryByRole("button", { name: "Добавить" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Стереть всю память" })).toBeNull();
  });

  it("подсказка «показано агенту» — только когда показаны не все записи", () => {
    renderScreen({ counts: { total: 57, limit: 200, shown: 40 } });
    expect(screen.getByText(/Показано агенту: 40 из 57/)).toBeTruthy();
    cleanup();
    renderScreen();
    expect(screen.queryByText(/Показано агенту/)).toBeNull();
  });

  it("состояния: загрузка, пусто, памяти нет — своя надпись, записи не рисуются", () => {
    renderScreen({ status: "loading", counts: undefined, onAdd: undefined, onClearAll: undefined, children: null });
    expect(screen.getByText("Загружаем память…")).toBeTruthy();
    cleanup();
    renderScreen({ status: "empty", children: null });
    expect(screen.getByText(/Память пуста/)).toBeTruthy();
    cleanup();
    renderScreen({ status: "unavailable", counts: undefined, onAdd: undefined, onClearAll: undefined, children: null });
    expect(screen.getByText("Память в этом приложении не включена")).toBeTruthy();
    expect(screen.queryByText("Записей: 12 из 200")).toBeNull();
  });

  it("ошибка загрузки: надпись и «Повторить»", () => {
    const { onRetry } = renderScreen({ status: "error", counts: undefined, children: null });
    expect(screen.getByText("Память не загрузилась")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("сообщение о сбое — role=alert; форма новой записи и окно подтверждения встают на свои места", () => {
    renderScreen({ error: "Запись изменилась", newNoteEditor: <p>форма</p>, confirm: <p>окно</p> });
    expect(screen.getByRole("alert").textContent).toContain("Запись изменилась");
    expect(screen.getByText("форма")).toBeTruthy();
    expect(screen.getByText("окно")).toBeTruthy();
  });
});

describe("раздел и запись", () => {
  it("раздел: именованная группа с числом записей; записи внутри", () => {
    render(
      <MemoryGroup name="Работа" depth={0} count={3}>
        <p>внутри</p>
      </MemoryGroup>,
    );
    const group = screen.getByRole("group", { name: "Работа, записей: 3" });
    expect(within(group).getByText("внутри")).toBeTruthy();
    expect(within(group).getByRole("heading", { name: "Работа" })).toBeTruthy();
  });

  it("вложенные разделы: уровень заголовка растёт и не выходит за h6", () => {
    render(
      <MemoryGroup name="Верх" depth={0} count={1}>
        <MemoryGroup name="Низ" depth={1} count={1}>
          <p>x</p>
        </MemoryGroup>
      </MemoryGroup>,
    );
    expect(screen.getByRole("heading", { name: "Верх" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { name: "Низ" }).tagName).toBe("H4");
    cleanup();
    render(<MemoryGroup name="Глубоко" depth={9} count={1}>{null}</MemoryGroup>);
    expect(screen.getByRole("heading", { name: "Глубоко" }).tagName).toBe("H6");
  });

  it("запись: текст, кнопки «Изменить» и «Удалить» с именем записи; без обработчика кнопка неактивна", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<MemoryNoteRow content="Любит чай" onEdit={onEdit} onDelete={onDelete} />);
    expect(screen.getByText("Любит чай")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Изменить запись «Любит чай»" }));
    expect(onEdit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Удалить запись «Любит чай»" }));
    expect(onDelete).toHaveBeenCalledOnce();
    cleanup();
    render(<MemoryNoteRow content="Любит чай" />);
    expect((screen.getByRole("button", { name: "Изменить запись «Любит чай»" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Удалить запись «Любит чай»" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

type EditorProps = ComponentProps<MemorySkin["MemoryNoteEditor"]>;
function renderEditor(props: Partial<EditorProps> = {}) {
  const handlers = { onPathChange: vi.fn(), onContentChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn() };
  render(<MemoryNoteEditor mode="create" path="О себе / Работа" content="Пишет на TypeScript" canSave pending={false} errors={{}} {...handlers} {...props} />);
  return handlers;
}

describe("форма записи", () => {
  it("два поля с подписями и подсказкой про «/»; правка сообщает слою поведения", () => {
    const { onPathChange, onContentChange } = renderEditor();
    const path = screen.getByLabelText("Раздел") as HTMLInputElement;
    const content = screen.getByLabelText("Запись") as HTMLTextAreaElement;
    expect(path.value).toBe("О себе / Работа");
    expect(content.value).toBe("Пишет на TypeScript");
    expect(screen.getByText(/До трёх уровней через «\/»/)).toBeTruthy();
    fireEvent.change(path, { target: { value: "Правила" } });
    expect(onPathChange).toHaveBeenCalledWith("Правила");
    fireEvent.change(content, { target: { value: "Отвечай на ты" } });
    expect(onContentChange).toHaveBeenCalledWith("Отвечай на ты");
  });

  it("заголовок зависит от режима; кнопки «Сохранить» и «Отмена» работают", () => {
    const { onSave, onCancel } = renderEditor({ mode: "edit" });
    expect(screen.getByText("Изменить запись")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(onSave).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onCancel).toHaveBeenCalledOnce();
    cleanup();
    renderEditor({ mode: "create" });
    expect(screen.getByText("Новая запись")).toBeTruthy();
  });

  it("«Сохранить» неактивна без canSave и пока идёт запись", () => {
    renderEditor({ canSave: false });
    expect((screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    renderEditor({ pending: true });
    expect((screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Enter в поле раздела сохраняет; Enter в тексте — перенос строки; Ctrl+Enter в тексте сохраняет; Escape отменяет", () => {
    const { onSave, onCancel } = renderEditor();
    fireEvent.keyDown(screen.getByLabelText("Раздел"), { key: "Enter" });
    expect(onSave).toHaveBeenCalledTimes(1);
    const content = screen.getByLabelText("Запись");
    fireEvent.keyDown(content, { key: "Enter" });
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(content, { key: "Enter", ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(content, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Enter с неактивной «Сохранить» ничего не сохраняет", () => {
    const { onSave } = renderEditor({ canSave: false });
    fireEvent.keyDown(screen.getByLabelText("Раздел"), { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("ошибки полей привязаны к полям (aria-invalid); ошибка формы — role=alert", () => {
    renderEditor({ errors: { path: "Укажите раздел", content: "Напишите текст записи", form: "Такая запись уже есть" } });
    expect(screen.getByLabelText("Раздел").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Запись").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Укажите раздел")).toBeTruthy();
    expect(screen.getByText("Напишите текст записи")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Такая запись уже есть");
  });

  it("без ошибок полей aria-invalid нет", () => {
    renderEditor();
    expect(screen.getByLabelText("Раздел").getAttribute("aria-invalid")).toBeNull();
  });

  it("при открытии фокус в поле раздела", () => {
    renderEditor();
    expect(document.activeElement).toBe(screen.getByLabelText("Раздел"));
  });
});

type ConfirmProps = ComponentProps<MemorySkin["MemoryConfirm"]>;
function renderConfirm(props: Partial<ConfirmProps> & Pick<ConfirmProps, "target">) {
  const handlers = { onConfirm: vi.fn(), onCancel: vi.fn() };
  render(<MemoryConfirm pending={false} {...handlers} {...props} />);
  return handlers;
}

describe("подтверждение", () => {
  it("удаление записи: заголовок, текст записи, «Удалить» подтверждает, «Отмена» отменяет", async () => {
    const { onConfirm, onCancel } = renderConfirm({ target: { kind: "note", content: "Любит чай" } });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Удалить запись?")).toBeTruthy();
    expect(within(dialog).getByText(/«Любит чай»/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("стирание всей памяти: число записей и своя кнопка «Стереть всё»", async () => {
    const { onConfirm } = renderConfirm({ target: { kind: "all", total: 12 } });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Стереть всю память?")).toBeTruthy();
    expect(within(dialog).getByText(/Все записи \(12\)/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Стереть всё" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("Escape — отмена; ошибка под текстом как role=alert; пока идёт запрос, подтверждение занято", async () => {
    const { onCancel } = renderConfirm({ target: { kind: "all", total: 2 }, error: "Не удалось выполнить действие", pending: true });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert").textContent).toBe("Не удалось выполнить действие");
    expect(within(dialog).getByRole("button", { name: "Стереть всё" }).hasAttribute("disabled")).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
  });
});

const mergeGroups = [
  { before: ["Пишет код на TypeScript каждый день", "Пишет код на TypeScript в компании Acme"], after: "Пишет код на TypeScript каждый день в компании Acme" },
  { before: ["Любит зелёный чай", "Пьёт зелёный чай без сахара"], after: "Любит зелёный чай без сахара" },
];
const mergedAt = "2026-09-30T12:05:00.000Z";
const mergedAtText = () => russianLabels.memoryMergeDate(new Date(mergedAt));

describe("блок «Объединено»", () => {
  it("экран: заголовок «Объединено» и карточки — только когда склейки переданы", () => {
    renderScreen({ merges: <p>карточки</p> });
    const block = screen.getByRole("region", { name: "Объединено" });
    expect(within(block).getByText("карточки")).toBeTruthy();
    cleanup();
    renderScreen();
    expect(screen.queryByRole("region", { name: "Объединено" })).toBeNull();
  });

  it("карточка: время слияния, «было» и «стало» для каждой склейки", () => {
    render(<MemoryMerge finishedAt={mergedAt} groups={mergeGroups} revertible onRevert={vi.fn()} />);
    expect(screen.getByText(mergedAtText())).toBeTruthy();
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(2);
    const first = within(groups[0]!);
    expect(first.getByText("Было")).toBeTruthy();
    expect(first.getByText("Пишет код на TypeScript каждый день")).toBeTruthy();
    expect(first.getByText("Пишет код на TypeScript в компании Acme")).toBeTruthy();
    expect(first.getByText("Стало")).toBeTruthy();
    expect(first.getByText("Пишет код на TypeScript каждый день в компании Acme")).toBeTruthy();
    expect(within(groups[1]!).getByText("Любит зелёный чай без сахара")).toBeTruthy();
  });

  it("можно вернуть — кнопка «Вернуть как было» зовёт колбэк; имя кнопки называет слияние", () => {
    const onRevert = vi.fn();
    render(<MemoryMerge finishedAt={mergedAt} groups={mergeGroups} revertible onRevert={onRevert} />);
    fireEvent.click(screen.getByRole("button", { name: `Вернуть как было (${mergedAtText()})` }));
    expect(onRevert).toHaveBeenCalledOnce();
    expect(screen.queryByText(russianLabels.memoryMergeNotRevertible)).toBeNull();
  });

  it("нельзя вернуть (записи менялись) — кнопки нет, есть пояснение", () => {
    render(<MemoryMerge finishedAt={mergedAt} groups={mergeGroups} revertible={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(russianLabels.memoryMergeNotRevertible)).toBeTruthy();
  });

  it("можно вернуть, но идёт другое действие (нет обработчика) — кнопка неактивна", () => {
    render(<MemoryMerge finishedAt={mergedAt} groups={mergeGroups} revertible />);
    expect((screen.getByRole("button", { name: /Вернуть как было/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("узкий экран: длинное слово в «было» и «стало» переносится, кнопка не раздвигает карточку", () => {
    const long = "я".repeat(300);
    const { container } = render(<MemoryMerge finishedAt={mergedAt} groups={[{ before: [long, long + "ы"], after: long }]} revertible onRevert={vi.fn()} />);
    const classes = (element: Element) => element.getAttribute("class") ?? "";
    for (const text of [long, long + "ы"]) expect(classes(screen.getAllByText(text, { selector: "li,p" })[0]!)).toContain("break-words");
    expect(classes(container.firstElementChild!)).toContain("min-w-0");
    expect(classes(screen.getByRole("button", { name: /Вернуть как было/ }).parentElement!)).toContain("flex-wrap");
  });
});

describe("узкий экран: без горизонтальной прокрутки", () => {
  it("длинное слово в записи и в названии раздела переносится; ряды кнопок переносятся на новую строку", () => {
    const long = "я".repeat(300);
    const { container } = render(
      <MemoryScreen status="ready" counts={counts} onAdd={vi.fn()} onClearAll={vi.fn()}>
        <MemoryGroup name={long} depth={0} count={1}>
          <MemoryNoteRow content={long} onEdit={vi.fn()} onDelete={vi.fn()} />
        </MemoryGroup>
      </MemoryScreen>,
    );
    const classes = (element: Element) => element.getAttribute("class") ?? "";
    expect(classes(screen.getByRole("group"))).toContain("min-w-0");
    expect(classes(screen.getByRole("heading", { name: long }))).toContain("break-words");
    expect(classes(screen.getByText(long, { selector: "p" }))).toContain("break-words");
    expect(classes(screen.getByRole("button", { name: "Добавить" }).parentElement!)).toContain("flex-wrap");
    expect(container.querySelector("section")?.getAttribute("class")).toContain("min-w-0");
  });

  it("форма записи: поля тянутся на всю ширину и не имеют своей минимальной ширины", () => {
    renderEditor();
    expect(screen.getByLabelText("Раздел").getAttribute("class")).toContain("w-full");
    expect(screen.getByLabelText("Запись").getAttribute("class")).toContain("w-full");
    expect(screen.getByRole("button", { name: "Сохранить" }).parentElement?.getAttribute("class")).toContain("flex-wrap");
  });
});

describe("AgentMemory со скином Тандема", () => {
  it("рисует записи по разделам и проходит добавление: всё через скин", async () => {
    let notes = [{ id: "a", categories: ["О себе"], content: "Любит чай", version: 1, createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z" }];
    const fetchMemory = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(init.body as string) as { categories: string[]; content: string };
        const created = { id: "b", ...body, version: 1, createdAt: "2026-09-02T10:00:00.000Z", updatedAt: "2026-09-02T10:00:00.000Z" };
        notes = [created, ...notes];
        return Response.json({ note: created }, { status: 201 });
      }
      return Response.json({ notes, counts: { total: notes.length, limit: 200, shown: notes.length } });
    });
    render(
      <ChatLabelsProvider labels={russianLabels}>
        <AgentMemory api={createMemoryApi({ api: "/api/chat", fetch: fetchMemory })} skin={tandemMemorySkin} />
      </ChatLabelsProvider>,
    );
    expect(await screen.findByText("Любит чай")).toBeTruthy();
    expect(screen.getByRole("group", { name: "О себе, записей: 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    fireEvent.change(screen.getByLabelText("Раздел"), { target: { value: "Работа" } });
    fireEvent.change(screen.getByLabelText("Запись"), { target: { value: "Пишет на TypeScript" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Пишет на TypeScript")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Работа, записей: 1" })).toBeTruthy();
    expect(screen.queryByLabelText("Раздел")).toBeNull();
  });

  it("«Вернуть как было» через скин Тандема: записи возвращаются, блок склеек пропадает", async () => {
    const stamp = "2026-09-01T10:00:00.000Z";
    const note = (id: string, content: string) => ({ id, categories: ["Работа"], content, version: 1, createdAt: stamp, updatedAt: stamp });
    let notes = [note("r", "Пишет код на TypeScript в Acme")];
    let merges: unknown[] = [
      { runId: "run-1", finishedAt: mergedAt, revertible: true, groups: [{ result: note("r", "Пишет код на TypeScript в Acme"), originals: [note("o1", "Пишет код на TypeScript"), note("o2", "Работает в Acme")] }] },
    ];
    const fetchMemory = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (init?.method === "POST" && path.endsWith("/merges/run-1/revert")) {
        notes = [note("o1", "Пишет код на TypeScript"), note("o2", "Работает в Acme")];
        merges = [];
        return Response.json({ reverted: "run-1" });
      }
      if (path.endsWith("/memory/merges")) return Response.json({ merges });
      return Response.json({ notes, counts: { total: notes.length, limit: 200, shown: notes.length } });
    });
    render(
      <ChatLabelsProvider labels={russianLabels}>
        <AgentMemory api={createMemoryApi({ api: "/api/chat", fetch: fetchMemory })} skin={tandemMemorySkin} />
      </ChatLabelsProvider>,
    );
    const block = await screen.findByRole("region", { name: "Объединено" });
    expect(within(block).getByText("Работает в Acme")).toBeTruthy();
    fireEvent.click(within(block).getByRole("button", { name: /Вернуть как было/ }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Объединено" })).toBeNull());
    expect(screen.getAllByText("Работает в Acme")).toHaveLength(1);
    expect(screen.queryByText("Пишет код на TypeScript в Acme")).toBeNull();
  });
});
