// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatLabelsProvider, russianLabels } from "../src/labels";
import { AgentMemory } from "../src/memory/agent-memory";
import { createMemoryApi } from "../src/memory/memory-client";
import { fakeMemoryServer, note } from "./support/fake-memory-server";
import type { FakeMerge, FakeNote } from "./support/fake-memory-server";
import { stubMemorySkin } from "./support/stub-memory-skin";

afterEach(cleanup);

function renderMemory(server: ReturnType<typeof fakeMemoryServer>, labels = russianLabels) {
  const api = createMemoryApi({ api: "/api/chat", fetch: server.fetch });
  return render(
    <ChatLabelsProvider labels={labels}>
      <AgentMemory api={api} skin={stubMemorySkin} />
    </ChatLabelsProvider>,
  );
}

const screenStatus = () => screen.getByTestId("memory").getAttribute("data-status");
const loaded = async () => waitFor(() => expect(screenStatus()).not.toBe("loading"));
const group = (name: string, depth?: number) =>
  [...document.querySelectorAll<HTMLElement>("[data-group]")].find(
    (element) => element.dataset.group === name && (depth === undefined || element.dataset.depth === String(depth)),
  );
const noteRow = (content: string) => document.querySelector<HTMLElement>(`[data-note="${content}"]`);
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const editor = () => screen.getByTestId("note-editor");
const fill = (label: string, value: string) => fireEvent.change(within(editor()).getByLabelText(label), { target: { value } });

const sample = (): FakeNote[] => [
  note("a", ["О себе"], "Любит чай"),
  note("b", ["О себе", "Работа"], "Пишет на TypeScript"),
  note("c", ["Правила"], "Отвечай на ты"),
];

describe("AgentMemory: состояния", () => {
  it("идёт загрузка — loading, потом ready", async () => {
    renderMemory(fakeMemoryServer(sample()));
    expect(screenStatus()).toBe("loading");
    await loaded();
    expect(screenStatus()).toBe("ready");
  });

  it("записей нет — empty с надписью; «Стереть всю память» недоступна, «Добавить» есть", async () => {
    renderMemory(fakeMemoryServer());
    await loaded();
    expect(screenStatus()).toBe("empty");
    expect(screen.getByText(russianLabels.memoryEmpty)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Стереть всю память" })).toBeNull();
    expect(screen.getByRole("button", { name: "Добавить" })).toBeTruthy();
  });

  it("сервер ответил 404 — unavailable; ни «Добавить», ни «Стереть»", async () => {
    const server = fakeMemoryServer(sample());
    server.state.off = true;
    renderMemory(server);
    await loaded();
    expect(screenStatus()).toBe("unavailable");
    expect(screen.queryByRole("button", { name: "Добавить" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Стереть всю память" })).toBeNull();
  });

  it("сбой загрузки — error и «Повторить»; повтор загружает", async () => {
    const server = fakeMemoryServer(sample());
    server.state.fail.add("list");
    renderMemory(server);
    await loaded();
    expect(screenStatus()).toBe("error");
    server.state.fail.clear();
    click("Повторить");
    await waitFor(() => expect(screenStatus()).toBe("ready"));
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
  });
});

describe("AgentMemory: дерево записей", () => {
  it("записи разложены по разделам: вложенный раздел внутри верхнего, счёт включает вложенные", async () => {
    renderMemory(fakeMemoryServer(sample()));
    await loaded();
    const about = group("О себе", 0)!;
    expect(about.dataset.count).toBe("2");
    expect(within(about).getByText("Любит чай")).toBeTruthy();
    const work = group("Работа", 1)!;
    expect(about.contains(work)).toBe(true);
    expect(within(work).getByText("Пишет на TypeScript")).toBeTruthy();
    expect(group("Правила", 0)!.dataset.count).toBe("1");
  });

  it("разделы по алфавиту; разделы с разным регистром сливаются в один", async () => {
    const server = fakeMemoryServer([note("1", ["Юг"], "а"), note("2", ["Работа"], "б"), note("3", ["работа"], "в"), note("4", ["Авто"], "г")]);
    renderMemory(server);
    await loaded();
    const names = [...document.querySelectorAll<HTMLElement>('[data-depth="0"]')].map((element) => element.dataset.group);
    expect(names).toEqual(["Авто", "Работа", "Юг"]);
    expect(group("Работа", 0)!.dataset.count).toBe("2");
  });

  it("счётчик и подсказка «показано агенту»: подсказка только когда показаны не все", async () => {
    const server = fakeMemoryServer(sample());
    server.state.shown = 2;
    renderMemory(server);
    await loaded();
    expect(screen.getByTestId("count").textContent).toBe("Записей: 3 из 200");
    expect(screen.getByTestId("hint").textContent).toContain("Показано агенту: 2 из 3");
    cleanup();
    renderMemory(fakeMemoryServer(sample()));
    await loaded();
    expect(screen.queryByTestId("hint")).toBeNull();
  });

  it("свой словарь: надписи экрана берутся из ChatLabels", async () => {
    renderMemory(fakeMemoryServer(), { ...russianLabels, memoryAdd: "Внести", memoryHeading: "Что я помню" });
    await loaded();
    expect(screen.getByRole("button", { name: "Внести" })).toBeTruthy();
    expect(screen.getByText("Что я помню")).toBeTruthy();
  });
});

describe("AgentMemory: добавление", () => {
  it("«Добавить» открывает пустую форму; сохранение отправляет разделы через «/» и закрывает форму", async () => {
    const server = fakeMemoryServer(sample());
    renderMemory(server);
    await loaded();
    click("Добавить");
    expect(editor().getAttribute("data-mode")).toBe("create");
    expect((within(editor()).getByLabelText("Раздел") as HTMLInputElement).value).toBe("");
    fill("Раздел", " Работа / Инструменты ");
    fill("Запись", "Любит  pnpm");
    fireEvent.click(within(editor()).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(screen.queryByTestId("note-editor")).toBeNull());
    expect(server.requestsOf("POST")[0]?.body).toEqual({ categories: ["Работа", "Инструменты"], content: "Любит pnpm" });
    expect(within(group("Инструменты", 1)!).getByText("Любит pnpm")).toBeTruthy();
  });

  it("пока форма пуста, сохранить нельзя; «Отмена» закрывает без запроса", async () => {
    const server = fakeMemoryServer();
    renderMemory(server);
    await loaded();
    click("Добавить");
    expect((within(editor()).getByRole("button", { name: "Сохранить" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(editor()).getByRole("button", { name: "Отмена" }));
    expect(screen.queryByTestId("note-editor")).toBeNull();
    // Только загрузка: список записей и склейки.
    expect(server.requests.map((request) => `${request.method} ${request.path}`)).toEqual(["GET /api/chat/memory", "GET /api/chat/memory/merges"]);
  });

  it("форма открыта — кнопки «Добавить» нет", async () => {
    renderMemory(fakeMemoryServer());
    await loaded();
    click("Добавить");
    expect(screen.queryByRole("button", { name: "Добавить" })).toBeNull();
  });

  it.each([
    ["четыре уровня раздела", "А / Б / В / Г", "x", "path", "Не больше трёх уровней раздела"],
    ["слишком длинное название раздела", "а".repeat(61), "x", "path", "Название раздела не длиннее 60 знаков"],
    ["один слэш без названий", " / ", "x", "path", "Укажите раздел"],
    ["слишком длинный текст", "А", "я".repeat(501), "content", "Запись не длиннее 500 знаков"],
  ])("проверка до отправки: %s — ошибка у поля, запроса нет", async (_name, path, content, field, message) => {
    const server = fakeMemoryServer();
    renderMemory(server);
    await loaded();
    click("Добавить");
    fill("Раздел", path);
    fill("Запись", content);
    fireEvent.click(within(editor()).getByRole("button", { name: "Сохранить" }));
    expect(within(editor()).getByRole("alert").textContent).toBe(message);
    expect(within(editor()).getByRole("alert").getAttribute("data-field")).toBe(field);
    expect(server.requestsOf("POST")).toHaveLength(0);
    // Правка поля снимает ошибку.
    fill("Запись", "короче");
    expect(within(editor()).queryByRole("alert")).toBeNull();
  });

  it("отказ сервера (дубль): форма остаётся с тем, что ввёл человек, под ней причина", async () => {
    const server = fakeMemoryServer(sample());
    renderMemory(server);
    await loaded();
    click("Добавить");
    fill("Раздел", "О себе");
    fill("Запись", "Любит чай");
    fireEvent.click(within(editor()).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(within(editor()).getByRole("alert").textContent).toBe("Такая запись уже есть"));
    expect(within(editor()).getByRole("alert").getAttribute("data-field")).toBe("form");
    expect((within(editor()).getByLabelText("Запись") as HTMLTextAreaElement).value).toBe("Любит чай");
  });
});

describe("AgentMemory: правка", () => {
  it("форма правки заполнена записью; сохранение уходит с версией записи, запись на месте с новым текстом", async () => {
    const server = fakeMemoryServer([note("b", ["О себе", "Работа"], "Пишет на TypeScript", 3)]);
    renderMemory(server);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Изменить запись «Пишет на TypeScript»" }));
    expect(editor().getAttribute("data-mode")).toBe("edit");
    expect((within(editor()).getByLabelText("Раздел") as HTMLInputElement).value).toBe("О себе / Работа");
    expect((within(editor()).getByLabelText("Запись") as HTMLTextAreaElement).value).toBe("Пишет на TypeScript");
    fill("Запись", "Пишет на TypeScript и Go");
    fireEvent.click(within(editor()).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(screen.queryByTestId("note-editor")).toBeNull());
    expect(server.requestsOf("PATCH")[0]?.body).toEqual({ categories: ["О себе", "Работа"], content: "Пишет на TypeScript и Go", version: 3 });
    expect(noteRow("Пишет на TypeScript и Go")).toBeTruthy();
  });

  it("«Отмена» возвращает запись без запроса", async () => {
    const server = fakeMemoryServer(sample());
    renderMemory(server);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Изменить запись «Любит чай»" }));
    fill("Запись", "Совсем другое");
    fireEvent.click(within(editor()).getByRole("button", { name: "Отмена" }));
    expect(screen.queryByTestId("note-editor")).toBeNull();
    expect(noteRow("Любит чай")).toBeTruthy();
    expect(server.requestsOf("PATCH")).toHaveLength(0);
  });

  it("конфликт версий: форма открыта, текст человека цел, сказано про обновлённый список; повторное сохранение проходит", async () => {
    const server = fakeMemoryServer([note("a", ["О себе"], "Любит чай", 1)]);
    renderMemory(server);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Изменить запись «Любит чай»" }));
    fill("Запись", "Любит кофе");
    server.editElsewhere("a", "Любит зелёный чай");
    fireEvent.click(within(editor()).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(within(editor()).getByRole("alert").textContent).toBe(russianLabels.memoryErrors.stale_version));
    expect((within(editor()).getByLabelText("Запись") as HTMLTextAreaElement).value).toBe("Любит кофе");
    fireEvent.click(within(editor()).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(screen.queryByTestId("note-editor")).toBeNull());
    expect(noteRow("Любит кофе")).toBeTruthy();
    expect(server.requestsOf("PATCH")[1]?.body).toMatchObject({ version: 2 });
  });

  it("запись удалили в другом месте: форма закрывается, на экране сообщение", async () => {
    const server = fakeMemoryServer(sample());
    renderMemory(server);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Изменить запись «Любит чай»" }));
    server.removeElsewhere("a");
    fill("Запись", "Любит кофе");
    fireEvent.click(within(editor()).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(screen.queryByTestId("note-editor")).toBeNull());
    expect(screen.getByRole("alert").textContent).toBe(russianLabels.memoryErrors.not_found);
    expect(noteRow("Любит чай")).toBeNull();
    // Сообщение уходит со следующим действием человека.
    click("Добавить");
    expect(screen.queryByText(russianLabels.memoryErrors.not_found)).toBeNull();
  });
});

describe("AgentMemory: удаление и стирание", () => {
  it("удаление просит подтверждения с текстом записи; «Отмена» ничего не отправляет", async () => {
    const server = fakeMemoryServer(sample());
    renderMemory(server);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Удалить запись «Любит чай»" }));
    expect(screen.getByTestId("memory-confirm").getAttribute("data-kind")).toBe("note");
    expect(screen.getByTestId("memory-confirm").textContent).toContain("Любит чай");
    fireEvent.click(within(screen.getByTestId("memory-confirm")).getByRole("button", { name: "Отмена" }));
    expect(screen.queryByTestId("memory-confirm")).toBeNull();
    expect(server.requestsOf("DELETE")).toHaveLength(0);
  });

  it("подтверждение удаляет запись: версия уходит, записи нет, окно закрыто", async () => {
    const server = fakeMemoryServer([note("a", ["О себе"], "Любит чай", 2), note("c", ["Правила"], "Отвечай на ты")]);
    renderMemory(server);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Удалить запись «Любит чай»" }));
    fireEvent.click(within(screen.getByTestId("memory-confirm")).getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(screen.queryByTestId("memory-confirm")).toBeNull());
    expect(server.requestsOf("DELETE")[0]).toMatchObject({ path: "/api/chat/memory/a", search: "?version=2" });
    expect(noteRow("Любит чай")).toBeNull();
    expect(group("О себе")).toBeUndefined();
  });

  it("сбой удаления: окно остаётся, в нём причина, можно повторить", async () => {
    const server = fakeMemoryServer(sample());
    renderMemory(server);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Удалить запись «Любит чай»" }));
    server.state.fail.add("delete");
    fireEvent.click(within(screen.getByTestId("memory-confirm")).getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(within(screen.getByTestId("memory-confirm")).getByRole("alert").textContent).toBe(russianLabels.memoryErrors.other));
    server.state.fail.clear();
    fireEvent.click(within(screen.getByTestId("memory-confirm")).getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(screen.queryByTestId("memory-confirm")).toBeNull());
    expect(noteRow("Любит чай")).toBeNull();
  });

  it("запись изменили в другом месте: окно закрывается, список обновлён, на экране сообщение", async () => {
    const server = fakeMemoryServer([note("a", ["О себе"], "Любит чай", 1)]);
    renderMemory(server);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Удалить запись «Любит чай»" }));
    server.editElsewhere("a", "Любит кофе");
    fireEvent.click(within(screen.getByTestId("memory-confirm")).getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(screen.queryByTestId("memory-confirm")).toBeNull());
    expect(screen.getByRole("alert").textContent).toBe(russianLabels.memoryErrors.stale_version);
    expect(noteRow("Любит кофе")).toBeTruthy();
  });

  it("«Стереть всю память» просит подтверждения с числом записей; подтверждение стирает всё, экран empty", async () => {
    const server = fakeMemoryServer(sample());
    renderMemory(server);
    await loaded();
    click("Стереть всю память");
    expect(screen.getByTestId("memory-confirm").getAttribute("data-kind")).toBe("all");
    expect(screen.getByTestId("memory-confirm").textContent).toContain("(3)");
    expect(server.requestsOf("DELETE")).toHaveLength(0);
    fireEvent.click(within(screen.getByTestId("memory-confirm")).getByRole("button", { name: "Стереть всё" }));
    await waitFor(() => expect(screenStatus()).toBe("empty"));
    expect(screen.queryByTestId("memory-confirm")).toBeNull();
    expect(server.requestsOf("DELETE")[0]).toMatchObject({ path: "/api/chat/memory" });
    expect(server.state.notes).toEqual([]);
  });

  it("пока идёт действие с окном подтверждения, кнопка подтверждения занята (pending)", async () => {
    const server = fakeMemoryServer(sample());
    renderMemory(server);
    await loaded();
    click("Стереть всю память");
    const confirm = within(screen.getByTestId("memory-confirm"));
    const button = confirm.getByRole("button", { name: "Стереть всё" }) as HTMLButtonElement;
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    await waitFor(() => expect(screenStatus()).toBe("empty"));
  });
});

const tsNote = (id: string, content: string) => note(id, ["Работа"], content);
const mergeOf = (runId: string, revertible = true): FakeMerge => ({
  runId,
  finishedAt: "2026-09-30T12:00:00.000Z",
  revertible,
  groups: [{ result: tsNote("r", "Пишет на TypeScript в Acme"), originals: [tsNote("o1", "Пишет на TypeScript"), tsNote("o2", "Работает в Acme")] }],
});
const mergedServer = (revertible = true) => fakeMemoryServer([note("a", ["О себе"], "Любит чай"), tsNote("r", "Пишет на TypeScript в Acme")], [mergeOf("run-1", revertible)]);

describe("AgentMemory: «Объединено»", () => {
  it("блок склеек: «было» — оригиналы, «стало» — результат, кнопка «Вернуть как было»", async () => {
    renderMemory(mergedServer());
    await loaded();
    const block = await screen.findByTestId("merges");
    expect(within(block).getByRole("heading", { name: "Объединено" })).toBeTruthy();
    const card = within(block).getByText("Пишет на TypeScript в Acme").closest("[data-merge-group]") as HTMLElement;
    expect(within(card).getByText("Было")).toBeTruthy();
    expect(within(card).getByText("Пишет на TypeScript")).toBeTruthy();
    expect(within(card).getByText("Работает в Acme")).toBeTruthy();
    expect(within(card).getByText("Стало")).toBeTruthy();
    expect(block.querySelector("article")?.getAttribute("data-merge-at")).toBe("2026-09-30T12:00:00.000Z");
    expect(within(block).getByRole("button", { name: "Вернуть как было" })).toBeTruthy();
  });

  it("слияние нельзя вернуть (результат менялся) — кнопки нет, есть пояснение", async () => {
    renderMemory(mergedServer(false));
    const block = await screen.findByTestId("merges");
    expect(within(block).queryByRole("button", { name: "Вернуть как было" })).toBeNull();
    expect(within(block).getByText(russianLabels.memoryMergeNotRevertible)).toBeTruthy();
  });

  it("склеек нет — блока нет", async () => {
    renderMemory(fakeMemoryServer(sample()));
    await loaded();
    expect(screen.queryByTestId("merges")).toBeNull();
  });

  it("«Вернуть как было»: список записей обновился, блок склеек пропал", async () => {
    const server = mergedServer();
    renderMemory(server);
    await screen.findByTestId("merges");
    click("Вернуть как было");
    await waitFor(() => expect(screen.queryByTestId("merges")).toBeNull());
    expect(noteRow("Пишет на TypeScript")).toBeTruthy();
    expect(noteRow("Работает в Acme")).toBeTruthy();
    expect(noteRow("Пишет на TypeScript в Acme")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("сервер ответил conflict — сообщение на экране, список обновлён, записи не тронуты", async () => {
    const server = mergedServer();
    renderMemory(server);
    await screen.findByTestId("merges");
    server.state.merges[0]!.revertible = false;
    click("Вернуть как было");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(russianLabels.memoryErrors.conflict));
    expect(noteRow("Пишет на TypeScript в Acme")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Вернуть как было" })).toBeNull());
  });

  it.each([
    ["limit_reached", "memoryRevertErrors"],
    ["duplicate", "memoryRevertErrors"],
  ] as const)("сервер отказал вернуть (%s) — понятная надпись про возврат, записи и склейка на месте", async (kind, group) => {
    const server = mergedServer();
    server.state.revertRefusal = kind;
    renderMemory(server);
    await screen.findByTestId("merges");
    click("Вернуть как было");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(russianLabels[group][kind]));
    expect(noteRow("Пишет на TypeScript в Acme")).toBeTruthy();
    expect(screen.getByTestId("merges")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Вернуть как было" })).toBeTruthy();
  });

  it("старый сервер без склеек — экран как раньше, без блока и без сообщений", async () => {
    const server = mergedServer();
    server.state.noMerges = true;
    renderMemory(server);
    await loaded();
    expect(screenStatus()).toBe("ready");
    expect(screen.queryByTestId("merges")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
