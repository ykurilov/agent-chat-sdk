// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpAdminHandler } from "../src/index";
import { McpAdmin, useMcpAdmin } from "../src/react";
import type { McpAdminScreenProps, McpServerFormValues, McpSkin } from "../src/react";
import { setupMcp } from "./support/setup";

afterEach(cleanup);

const TOKEN = "tok-SECRET-91b2";
const URL_KEY = "url-key-7f3a9c";

/** Хук ходит в настоящие адреса админа поверх поддельного сервера MCP; кто спрашивает — задаёт тест. */
async function setupScreen(user: string | null = "boss") {
  const setup = await setupMcp();
  const handler = createMcpAdminHandler({ mcp: setup.mcp, resolveUser: async () => (user ? { id: user } : null) });
  const fetch = (url: string, init?: RequestInit) => handler.fetch(new Request(`https://app.example.com${url}`, { ...init, headers: { ...init?.headers, origin: "https://app.example.com" } }));
  return { ...setup, fetch };
}

const form = (overrides: Partial<McpServerFormValues> = {}): McpServerFormValues => ({
  name: "DeepWiki",
  prefix: "deepwiki",
  url: `https://mcp.example.com/mcp?key=${URL_KEY}`,
  transport: "http",
  headers: [{ name: "Authorization", value: `Bearer ${TOKEN}` }, { name: " ", value: "" }],
  viaProxy: false,
  timeoutSeconds: 15,
  status: "everyone",
  ...overrides,
});

const secretsIn = (props: McpAdminScreenProps) => JSON.stringify(props).match(new RegExp(`${TOKEN}|${URL_KEY}`));

describe("useMcpAdmin", () => {
  it("добавить сервер из формы → карточка без секретов, инструменты выключены; переключить, проверить, удалить", async () => {
    const { fetch } = await setupScreen();
    const { result } = renderHook(() => useMcpAdmin({ fetch }));
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.servers).toEqual([]);

    act(() => result.current.addForm.onOpen());
    expect(result.current.addForm.open).toBe(true);
    act(() => result.current.addForm.onSubmit(form()));
    expect(result.current.addForm.busy).toBe(true);
    await waitFor(() => expect(result.current.addForm.open).toBe(false));

    const card = result.current.servers[0]!;
    expect(card).toMatchObject({ name: "DeepWiki", displayUrl: "https://mcp.example.com/mcp", urlHasHiddenParts: true, headerNames: ["Authorization"], status: "everyone" });
    expect(card.tools.map((tool) => [tool.modelName, tool.enabled])).toEqual([
      ["deepwiki__ask_question", false],
      ["deepwiki__delete_repo", false],
    ]);
    expect(secretsIn(result.current)).toBeNull();

    act(() => card.tools[0]!.onEnabled(true));
    await waitFor(() => expect(result.current.servers[0]!.tools[0]!.enabled).toBe(true));
    act(() => result.current.servers[0]!.tools[0]!.onNeedsApproval(true));
    await waitFor(() => expect(result.current.servers[0]!.tools[0]!.needsApproval).toBe(true));

    act(() => result.current.servers[0]!.onStatus("admins"));
    expect(result.current.servers[0]!.busy).toBe("status");
    await waitFor(() => expect(result.current.servers[0]!.status).toBe("admins"));

    act(() => result.current.servers[0]!.onCheck());
    await waitFor(() => expect(result.current.servers[0]!.lastCheck).toMatchObject({ ok: true, toolCount: 2, matchesSnapshot: true }));

    act(() => result.current.servers[0]!.onRemove());
    await waitFor(() => expect(result.current.servers).toEqual([]));
  });

  it("ошибка сервера — текстом у формы и у карточки, без секретов", async () => {
    const { fetch, fake } = await setupScreen();
    const { result } = renderHook(() => useMcpAdmin({ fetch }));
    await waitFor(() => expect(result.current.state).toBe("ready"));

    act(() => result.current.addForm.onSubmit(form({ prefix: "Плохой" })));
    await waitFor(() => expect(result.current.addForm.error).toMatch(/рефикс/));
    expect(result.current.addForm.open).toBe(false);

    act(() => result.current.addForm.onSubmit(form()));
    await waitFor(() => expect(result.current.servers).toHaveLength(1));
    fake.down = true;
    act(() => result.current.servers[0]!.onRefresh());
    await waitFor(() => expect(result.current.servers[0]!.error).toMatch(/недоступен/));
    expect(result.current.servers[0]!.busy).toBeNull();
    expect(secretsIn(result.current)).toBeNull();
  });

  it("правка: пустой адрес — прежний; заголовок без замены хранит значение, заменённый — новое, очищенный удалён", async () => {
    const { fetch, fake } = await setupScreen();
    const { result } = renderHook(() => useMcpAdmin({ fetch }));
    await waitFor(() => expect(result.current.state).toBe("ready"));
    act(() => result.current.addForm.onSubmit(form({ headers: [{ name: "Authorization", value: `Bearer ${TOKEN}` }, { name: "X-Team", value: "old-team" }] })));
    await waitFor(() => expect(result.current.servers).toHaveLength(1));
    expect(result.current.servers[0]).toMatchObject({ timeoutMs: 15_000, edit: { open: false } });

    act(() => result.current.servers[0]!.edit.onOpen());
    expect(result.current.servers[0]!.edit.open).toBe(true);
    act(() =>
      result.current.servers[0]!.edit.onSubmit({
        name: "Вики",
        prefix: "deepwiki",
        url: " ",
        transport: "http",
        headers: [{ name: "Authorization", value: null }, { name: "X-Region", value: "eu" }, { name: "", value: "" }],
        viaProxy: false,
        timeoutSeconds: 20,
      }),
    );
    expect(result.current.servers[0]!.edit.busy).toBe(true);
    await waitFor(() => expect(result.current.servers[0]!.edit.open).toBe(false));
    expect(result.current.servers[0]).toMatchObject({ name: "Вики", headerNames: ["Authorization", "X-Region"], timeoutMs: 20_000, urlHasHiddenParts: true });
    expect(secretsIn(result.current)).toBeNull();

    act(() => result.current.servers[0]!.onCheck());
    await waitFor(() => expect(result.current.servers[0]!.lastCheck?.ok).toBe(true));
    const seen = fake.requests.at(-1)!;
    expect(seen.url).toContain(`key=${URL_KEY}`);
    expect(seen.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, "x-region": "eu" });
    expect(seen.headers["x-team"]).toBeUndefined();
  });

  it("правка с ошибкой: форма открыта, текст сервера у формы", async () => {
    const { fetch } = await setupScreen();
    const { result } = renderHook(() => useMcpAdmin({ fetch }));
    await waitFor(() => expect(result.current.state).toBe("ready"));
    act(() => result.current.addForm.onSubmit(form()));
    await waitFor(() => expect(result.current.servers).toHaveLength(1));
    act(() => result.current.servers[0]!.edit.onOpen());
    act(() => result.current.servers[0]!.edit.onSubmit({ name: "Вики", prefix: "Плохой", url: "", transport: "http", headers: [], viaProxy: false, timeoutSeconds: 15 }));
    await waitFor(() => expect(result.current.servers[0]!.edit.error).toMatch(/рефикс/));
    expect(result.current.servers[0]!.edit).toMatchObject({ open: true, busy: false });
    act(() => result.current.servers[0]!.edit.onCancel());
    expect(result.current.servers[0]!.edit).toMatchObject({ open: false, error: null });
  });

  it("журнал: строки с именем сервера и полным именем инструмента", async () => {
    const { fetch, store } = await setupScreen();
    const { result } = renderHook(() => useMcpAdmin({ fetch }));
    await waitFor(() => expect(result.current.state).toBe("ready"));
    act(() => result.current.addForm.onSubmit(form()));
    await waitFor(() => expect(result.current.servers).toHaveLength(1));
    const serverId = result.current.servers[0]!.id;
    await store.recordCall({ id: "c1", serverId, toolName: "ask_question", ownerId: "anna", chatId: "chat-9", startedAt: "2026-10-15T10:00:00.000Z", durationMs: 1500, ok: false, error: "срок вышел" });

    const again = renderHook(() => useMcpAdmin({ fetch }));
    await waitFor(() => expect(again.result.current.calls).toHaveLength(1));
    expect(again.result.current.calls[0]).toEqual({ id: "c1", startedAt: "2026-10-15T10:00:00.000Z", chatId: "chat-9", serverName: "DeepWiki", toolName: "deepwiki__ask_question", durationMs: 1500, ok: false, error: "срок вышел" });
  });

  it("не-админ: адреса отвечают 404 — экрана нет; сбой сети — «не загрузилось»", async () => {
    const { fetch } = await setupScreen("anna");
    const { result } = renderHook(() => useMcpAdmin({ fetch }));
    await waitFor(() => expect(result.current.state).toBe("not_found"));

    const broken = renderHook(() => useMcpAdmin({ fetch: () => Promise.reject(new TypeError("fetch failed")) }));
    await waitFor(() => expect(broken.result.current.state).toBe("failed"));
  });

  it("McpAdmin рисует экран скина с данными хука", async () => {
    const { fetch } = await setupScreen();
    const skin: McpSkin = { McpAdminScreen: (props) => <p>{`${props.state}:${props.servers.length}`}</p> };
    render(<McpAdmin skin={skin} fetch={fetch} />);
    expect(await screen.findByText("ready:0")).toBeTruthy();
  });
});
