import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { McpServerView } from "../server-view";
import type { McpCallRecord, McpServerStatus, McpToolSetting } from "../types";
import { useMcpLabels } from "./mcp-labels";
import type {
  McpAdminScreenProps,
  McpCallRowView,
  McpLoadState,
  McpServerAction,
  McpServerCardView,
  McpServerEditValues,
  McpServerFormValues,
  McpSkin,
} from "./mcp-skin";

type AdminFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface McpAdminOptions {
  /** Адрес админ-API пакета (`basePath` у `createMcpAdminHandler`), по умолчанию `/api/mcp`. */
  url?: string;
  fetch?: AdminFetch;
  /** Сколько последних вызовов показать в журнале. */
  journalLimit?: number;
}

const DEFAULT_URL = "/api/mcp";
const DEFAULT_JOURNAL_LIMIT = 50;

/** Ошибка адреса админа: текст от сервера (уже без секретов) или общий. */
class AdminRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const sortedByCreation = (servers: McpServerView[]) => [...servers].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

/**
 * Экран «Серверы MCP»: читает и меняет серверы через адреса `createMcpAdminHandler`. Отдаёт готовые данные экрана
 * `McpAdminScreen` из скина. Не-админу адреса отвечают 404 — экран в состоянии `not_found`, как будто его нет.
 */
export function useMcpAdmin({ url = DEFAULT_URL, fetch: fetchAdmin = (...args) => globalThis.fetch(...args), journalLimit = DEFAULT_JOURNAL_LIMIT }: McpAdminOptions = {}): McpAdminScreenProps {
  const labels = useMcpLabels();
  const fetchRef = useRef(fetchAdmin);
  fetchRef.current = fetchAdmin;
  const alive = useRef(true);
  const [state, setState] = useState<McpLoadState>("loading");
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [calls, setCalls] = useState<McpCallRecord[]>([]);
  const [busy, setBusy] = useState<Record<string, McpServerAction>>({});
  const [busyTools, setBusyTools] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; busy: boolean; error: string | null } | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const request = useCallback(
    async <T,>(path: string, init?: { method: string; body?: unknown }): Promise<T> => {
      let response: Response;
      try {
        response = await fetchRef.current(`${url}${path}`, {
          ...(init && { method: init.method }),
          ...(init?.body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
        });
      } catch {
        throw new AdminRequestError(labels.failed);
      }
      const answer = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
      if (!response.ok || !answer) throw new AdminRequestError(answer?.error?.message ?? labels.failed, response.status);
      return answer;
    },
    [url, labels.failed],
  );

  const readCalls = useCallback(async () => {
    const answer = await request<{ calls: McpCallRecord[] }>(`/calls?limit=${journalLimit}`);
    if (alive.current) setCalls(answer.calls);
  }, [request, journalLimit]);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [answer] = await Promise.all([request<{ servers: McpServerView[] }>("/servers"), readCalls()]);
      if (!alive.current) return;
      setServers(sortedByCreation(answer.servers));
      setState("ready");
    } catch (error) {
      if (alive.current) setState(error instanceof AdminRequestError && error.status === 404 ? "not_found" : "failed");
    }
  }, [request, readCalls]);

  useEffect(() => {
    void load();
  }, [load]);

  const replaced = useCallback((server: McpServerView) => {
    setServers((current) => sortedByCreation([...current.filter((item) => item.id !== server.id), server]));
  }, []);

  /** Действие с сервером: кнопка занята на время запроса, ошибка — у карточки этого сервера. */
  const act = useCallback(async (id: string, action: McpServerAction, run: () => Promise<void>) => {
    setBusy((current) => ({ ...current, [id]: action }));
    setErrors(({ [id]: _dropped, ...rest }) => rest);
    try {
      await run();
    } catch (error) {
      if (alive.current) setErrors((current) => ({ ...current, [id]: error instanceof Error ? error.message : labels.failed }));
    }
    if (alive.current) setBusy(({ [id]: _done, ...rest }) => rest);
  }, [labels.failed]);

  const setStatus = useCallback(
    (id: string, status: McpServerStatus) =>
      act(id, "status", async () => replaced((await request<{ server: McpServerView }>(`/servers/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } })).server)),
    [act, request, replaced],
  );
  const check = useCallback(
    (id: string) =>
      act(id, "check", async () => replaced((await request<{ server: McpServerView }>(`/servers/${encodeURIComponent(id)}/check`, { method: "POST" })).server)),
    [act, request, replaced],
  );
  const refresh = useCallback(
    (id: string) =>
      act(id, "refresh", async () => replaced((await request<{ server: McpServerView }>(`/servers/${encodeURIComponent(id)}/refresh`, { method: "POST" })).server)),
    [act, request, replaced],
  );
  const remove = useCallback(
    (id: string) =>
      act(id, "remove", async () => {
        await request(`/servers/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!alive.current) return;
        setServers((current) => current.filter((item) => item.id !== id));
        setCalls((current) => current.filter((call) => call.serverId !== id));
      }),
    [act, request],
  );

  const setTool = useCallback(
    async (id: string, toolName: string, setting: Partial<McpToolSetting>) => {
      const key = `${id}\n${toolName}`;
      setBusyTools((current) => new Set(current).add(key));
      setErrors(({ [id]: _dropped, ...rest }) => rest);
      try {
        const answer = await request<{ server: McpServerView }>(`/servers/${encodeURIComponent(id)}/tools/${encodeURIComponent(toolName)}`, { method: "PATCH", body: setting });
        if (alive.current) replaced(answer.server);
      } catch (error) {
        if (alive.current) setErrors((current) => ({ ...current, [id]: error instanceof Error ? error.message : labels.failed }));
      }
      if (!alive.current) return;
      setBusyTools((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    },
    [request, replaced, labels.failed],
  );

  const submit = useCallback(
    async (values: McpServerFormValues) => {
      setFormBusy(true);
      setFormError(null);
      try {
        const headers = Object.fromEntries(values.headers.filter((header) => header.name.trim() !== "").map((header) => [header.name.trim(), header.value]));
        const answer = await request<{ server: McpServerView }>("/servers", {
          method: "POST",
          body: {
            name: values.name.trim(),
            prefix: values.prefix.trim(),
            url: values.url.trim(),
            transport: values.transport,
            headers,
            viaProxy: values.viaProxy,
            timeoutMs: Math.round(values.timeoutSeconds * 1000),
            status: values.status,
          },
        });
        if (!alive.current) return;
        replaced(answer.server);
        setFormOpen(false);
      } catch (error) {
        if (alive.current) setFormError(error instanceof Error ? error.message : labels.failed);
      }
      if (alive.current) setFormBusy(false);
    },
    [request, replaced, labels.failed],
  );

  const saveEdit = useCallback(
    async (id: string, values: McpServerEditValues) => {
      setEditing({ id, busy: true, error: null });
      try {
        const headers = Object.fromEntries(values.headers.filter((header) => header.name.trim() !== "").map((header) => [header.name.trim(), header.value]));
        const answer = await request<{ server: McpServerView }>(`/servers/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: {
            name: values.name.trim(),
            prefix: values.prefix.trim(),
            ...(values.url.trim() !== "" && { url: values.url.trim() }),
            transport: values.transport,
            headers,
            viaProxy: values.viaProxy,
            timeoutMs: Math.round(values.timeoutSeconds * 1000),
          },
        });
        if (!alive.current) return;
        replaced(answer.server);
        setEditing(null);
      } catch (error) {
        if (alive.current) setEditing({ id, busy: false, error: error instanceof Error ? error.message : labels.failed });
      }
    },
    [request, replaced, labels.failed],
  );

  const cards = useMemo(
    () =>
      servers.map(
        (server): McpServerCardView => ({
          id: server.id,
          name: server.name,
          prefix: server.prefix,
          status: server.status,
          transport: server.transport,
          displayUrl: server.displayUrl,
          urlHasHiddenParts: server.urlHasHiddenParts,
          headerNames: server.headerNames,
          viaProxy: server.viaProxy,
          timeoutMs: server.timeoutMs,
          toolsUpdatedAt: server.toolsUpdatedAt,
          lastCheck: server.lastCheck,
          tools: server.tools.map((tool) => ({
            ...tool,
            busy: busyTools.has(`${server.id}\n${tool.name}`),
            onEnabled: (enabled: boolean) => void setTool(server.id, tool.name, { enabled }),
            onNeedsApproval: (needsApproval: boolean) => void setTool(server.id, tool.name, { needsApproval }),
          })),
          busy: busy[server.id] ?? null,
          error: errors[server.id] ?? null,
          onStatus: (status) => void setStatus(server.id, status),
          onCheck: () => void check(server.id),
          onRefresh: () => void refresh(server.id).then(() => readCalls().catch(() => undefined)),
          onRemove: () => void remove(server.id),
          edit: {
            open: editing?.id === server.id,
            busy: editing?.id === server.id && editing.busy,
            error: editing?.id === server.id ? editing.error : null,
            onOpen: () => setEditing({ id: server.id, busy: false, error: null }),
            onCancel: () => setEditing(null),
            onSubmit: (values) => void saveEdit(server.id, values),
          },
        }),
      ),
    [servers, busy, busyTools, errors, editing, setTool, setStatus, check, refresh, remove, readCalls, saveEdit],
  );

  const callRows = useMemo(() => {
    const byId = new Map(servers.map((server) => [server.id, server]));
    return calls.map((call): McpCallRowView => {
      const server = byId.get(call.serverId);
      return {
        id: call.id,
        startedAt: call.startedAt,
        chatId: call.chatId,
        serverName: server?.name ?? call.serverId,
        toolName: server ? `${server.prefix}__${call.toolName}` : call.toolName,
        durationMs: call.durationMs,
        ok: call.ok,
        ...(call.error !== undefined && { error: call.error }),
      };
    });
  }, [calls, servers]);

  return {
    state,
    onRetry: () => void load(),
    servers: cards,
    addForm: {
      open: formOpen,
      busy: formBusy,
      error: formError,
      onOpen: () => {
        setFormError(null);
        setFormOpen(true);
      },
      onCancel: () => setFormOpen(false),
      onSubmit: (values) => void submit(values),
    },
    calls: callRows,
  };
}

export interface McpAdminProps extends McpAdminOptions {
  skin: McpSkin;
}

/** Экран «Серверы MCP»: данные из `useMcpAdmin`, вид — из скина. */
export function McpAdmin({ skin, ...options }: McpAdminProps) {
  return createElement(skin.McpAdminScreen, useMcpAdmin(options));
}
