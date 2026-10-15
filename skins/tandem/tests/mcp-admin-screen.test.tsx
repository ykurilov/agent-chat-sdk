// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { McpAddFormView, McpAdminScreenProps, McpEditFormView, McpServerCardView, McpToolRowView } from "@ykurilov/agent-chat-mcp/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tandemMcpSkin } from "../src/mcp";

afterEach(cleanup);

// Переключатель Radix меряет себя; в jsdom мерить нечего.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { McpAdminScreen } = tandemMcpSkin;

const toolOf = (name: string, extra: Partial<McpToolRowView> = {}): McpToolRowView => ({
  name,
  modelName: `wiki__${name}`,
  readOnly: false,
  enabled: false,
  needsApproval: true,
  busy: false,
  onEnabled: vi.fn(),
  onNeedsApproval: vi.fn(),
  ...extra,
});

const editOf = (extra: Partial<McpEditFormView> = {}): McpEditFormView => ({ open: false, busy: false, error: null, onOpen: vi.fn(), onCancel: vi.fn(), onSubmit: vi.fn(), ...extra });

const serverOf = (extra: Partial<McpServerCardView> = {}): McpServerCardView => ({
  id: "s1",
  name: "DeepWiki",
  prefix: "wiki",
  status: "admins",
  transport: "http",
  displayUrl: "https://mcp.example.com/mcp",
  urlHasHiddenParts: true,
  headerNames: ["Authorization"],
  viaProxy: false,
  timeoutMs: 20_000,
  toolsUpdatedAt: "2026-10-15T10:00:00.000Z",
  lastCheck: null,
  tools: [],
  busy: null,
  error: null,
  onStatus: vi.fn(),
  onCheck: vi.fn(),
  onRefresh: vi.fn(),
  onRemove: vi.fn(),
  edit: editOf(),
  ...extra,
});

const formOf = (extra: Partial<McpAddFormView> = {}): McpAddFormView => ({ open: false, busy: false, error: null, onOpen: vi.fn(), onCancel: vi.fn(), onSubmit: vi.fn(), ...extra });

const renderScreen = (props: Partial<McpAdminScreenProps> = {}) =>
  render(<McpAdminScreen state="ready" onRetry={vi.fn()} servers={[]} addForm={formOf()} calls={[]} {...props} />);

describe("экран серверов MCP в Тандеме", () => {
  it("карточка: адрес без параметров, «параметры скрыты», заголовок «задан»; статус и кнопки зовут действия", () => {
    const server = serverOf();
    renderScreen({ servers: [server] });
    const card = within(screen.getByRole("group", { name: "DeepWiki" }));
    expect(card.getByText(/https:\/\/mcp\.example\.com\/mcp/).textContent).toContain("параметры скрыты");
    expect(card.getByText("Authorization: задан")).toBeTruthy();
    fireEvent.click(card.getByRole("radio", { name: "Все" }));
    expect(server.onStatus).toHaveBeenCalledWith("everyone");
    fireEvent.click(card.getByRole("button", { name: "Проверить связь" }));
    fireEvent.click(card.getByRole("button", { name: "Обновить список" }));
    expect(server.onCheck).toHaveBeenCalledOnce();
    expect(server.onRefresh).toHaveBeenCalledOnce();
  });

  it("инструменты: переключатели зовут действия; с проблемой — причина вместо переключателей", () => {
    const ask = toolOf("ask", { readOnly: true, needsApproval: false });
    renderScreen({ servers: [serverOf({ tools: [ask, toolOf("huge", { problem: "schema_too_large" })] })] });
    const askRow = within(screen.getByRole("group", { name: "wiki__ask" }));
    expect(askRow.getByText("только чтение")).toBeTruthy();
    fireEvent.click(askRow.getByRole("switch", { name: "Включён" }));
    expect(ask.onEnabled).toHaveBeenCalledWith(true);
    fireEvent.click(askRow.getByRole("switch", { name: "Спрашивать подтверждение" }));
    expect(ask.onNeedsApproval).toHaveBeenCalledWith(true);
    const hugeRow = within(screen.getByRole("group", { name: "wiki__huge" }));
    expect(hugeRow.getByText(/Схема слишком большая/)).toBeTruthy();
    expect(hugeRow.queryByRole("switch")).toBeNull();
  });

  it("удаление — только после подтверждения", () => {
    const server = serverOf();
    renderScreen({ servers: [server] });
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    expect(server.onRemove).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Удалить" }));
    expect(server.onRemove).toHaveBeenCalledOnce();
  });

  it("форма: введённые поля уходят в onSubmit; ошибка сервера видна", () => {
    const form = formOf({ open: true, error: "Префикс занят." });
    renderScreen({ addForm: form });
    fireEvent.change(screen.getByRole("textbox", { name: /Название/ }), { target: { value: "Wiki" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Префикс/ }), { target: { value: "wiki" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Адрес/ }), { target: { value: "https://mcp.example.com/mcp" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Имя заголовка" }), { target: { value: "Authorization" } });
    fireEvent.change(screen.getByLabelText("Значение"), { target: { value: "Bearer x" } });
    fireEvent.click(screen.getByRole("radio", { name: "SSE (старый)" }));
    expect(screen.getByText("Префикс занят.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Подключить" }));
    expect(form.onSubmit).toHaveBeenCalledWith({
      name: "Wiki",
      prefix: "wiki",
      url: "https://mcp.example.com/mcp",
      transport: "sse",
      headers: [{ name: "Authorization", value: "Bearer x" }],
      viaProxy: false,
      timeoutSeconds: 30,
      status: "admins",
    });
  });

  it("правка: поля заполнены с карточки; секрет «задан» — заменить или очистить, старого значения нет; адрес пустой — прежний", () => {
    const closed = serverOf();
    renderScreen({ servers: [closed] });
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    expect(closed.edit.onOpen).toHaveBeenCalledOnce();
    cleanup();

    const server = serverOf({ headerNames: ["Authorization", "X-Team"], edit: editOf({ open: true, error: "Префикс занят." }) });
    renderScreen({ servers: [server] });
    const form = within(screen.getByRole("form", { name: "Изменить сервер" }));
    expect((form.getByRole("textbox", { name: /Название/ }) as HTMLInputElement).value).toBe("DeepWiki");
    const url = form.getByRole("textbox", { name: /Адрес/ }) as HTMLInputElement;
    expect(url.value).toBe("");
    expect(url.placeholder).toBe("https://mcp.example.com/mcp");
    expect(form.getByText("Префикс занят.")).toBeTruthy();

    const auth = within(form.getByRole("group", { name: "Authorization" }));
    expect(auth.getByText("Authorization: задан")).toBeTruthy();
    expect(auth.queryByLabelText("Значение")).toBeNull();
    fireEvent.click(auth.getByRole("button", { name: "Заменить" }));
    const value = auth.getByLabelText("Значение") as HTMLInputElement;
    expect(value.value).toBe("");
    expect(value.type).toBe("password");
    fireEvent.change(value, { target: { value: "Bearer new" } });
    fireEvent.click(within(form.getByRole("group", { name: "X-Team" })).getByRole("button", { name: "Очистить" }));
    expect(form.queryByRole("group", { name: "X-Team" })).toBeNull();
    fireEvent.change(form.getByRole("textbox", { name: /Название/ }), { target: { value: "Вики" } });

    fireEvent.click(form.getByRole("button", { name: "Сохранить" }));
    expect(server.edit.onSubmit).toHaveBeenCalledWith({
      name: "Вики",
      prefix: "wiki",
      url: "",
      transport: "http",
      headers: [{ name: "Authorization", value: "Bearer new" }],
      viaProxy: false,
      timeoutSeconds: 20,
    });
    fireEvent.click(form.getByRole("button", { name: "Отмена" }));
    expect(server.edit.onCancel).toHaveBeenCalledOnce();
  });

  it("правка: заголовок без замены уходит как null; новый — с именем и значением", () => {
    const server = serverOf({ edit: editOf({ open: true }) });
    renderScreen({ servers: [server] });
    const form = within(screen.getByRole("form", { name: "Изменить сервер" }));
    fireEvent.click(form.getByRole("button", { name: "Добавить заголовок" }));
    fireEvent.change(form.getByRole("textbox", { name: "Имя заголовка" }), { target: { value: "X-Region" } });
    fireEvent.change(form.getByLabelText("Значение"), { target: { value: "eu" } });
    fireEvent.click(form.getByRole("button", { name: "Сохранить" }));
    expect(server.edit.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ headers: [{ name: "Authorization", value: null }, { name: "X-Region", value: "eu" }] }),
    );
  });

  it("журнал: инструмент, длительность и ошибка; пусто — надпись", () => {
    renderScreen({
      calls: [{ id: "c1", startedAt: "2026-10-15T10:00:00.000Z", chatId: "chat-9", serverName: "DeepWiki", toolName: "wiki__ask", durationMs: 1500, ok: false, error: "срок вышел" }],
    });
    const journal = within(screen.getByRole("region", { name: "Журнал вызовов" }));
    expect(journal.getByText("wiki__ask")).toBeTruthy();
    expect(journal.getByText("1.5 с")).toBeTruthy();
    expect(journal.getByText("срок вышел")).toBeTruthy();
    cleanup();
    renderScreen();
    expect(screen.getByText("Вызовов пока не было.")).toBeTruthy();
  });

  it("не загрузилось — предупреждение с «Повторить»", () => {
    const onRetry = vi.fn();
    renderScreen({ state: "failed", onRetry });
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(onRetry).toHaveBeenCalledOnce();
    cleanup();
    renderScreen({ state: "not_found" });
    expect(screen.getByText("Страница не найдена.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Серверы MCP" })).toBeNull();
  });
});
