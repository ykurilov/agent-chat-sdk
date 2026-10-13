import { vi } from "vitest";
import { fakeChatServer } from "./fake-chat-server";

export interface FakeListedChat {
  id: string;
  title: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Мессенджер, из которого создан чат. */
  origin?: string;
  /** Закрытие чата: список отдаёт его в строке (`closed`); нет — чат открыт. */
  closed?: { code: string; message: string };
}

export type ListEndpoint = "list" | "create" | "rename" | "delete";

/**
 * Подменённый `fetch` сервера со списком чатов: `GET {base}`, `POST {base}`, `PATCH` и `DELETE {base}/{id}`.
 * Остальные адреса чата (история, модели…) отдаёт обычный подменённый сервер чата, но только для чатов из списка:
 * чужого чата нет — 404. `state.fail` — адреса, отвечающие 500; `state.down` — сервер не отвечает;
 * `state.busy` — id чатов, которые нельзя удалить (409); `state.refuseCreate` — отказ приложения на создание чата.
 */
export function fakeChatListServer(initial: FakeListedChat[] = []) {
  const inner = fakeChatServer();
  const state = {
    down: false,
    chats: initial.map((chat, index) => ({
      createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      updatedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      ...chat,
    })) as Array<Required<Omit<FakeListedChat, "origin" | "closed">> & Pick<FakeListedChat, "origin" | "closed">>,
    fail: new Set<ListEndpoint>(),
    busy: new Set<string>(),
    created: 0,
    /** Тело и код отказа приложения на `POST {base}` (создание чата); `null` — создание проходит. */
    refuseCreate: null as null | { status: number; body: unknown },
  };
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://test.local");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { title?: string }) : undefined;
    const [, , , chatId, action] = url.pathname.split("/");
    requests.push({ method, path: url.pathname, body });
    if (state.down) throw new TypeError("Failed to fetch");
    const respond = (endpoint: ListEndpoint, make: () => Response) =>
      state.fail.has(endpoint) ? Response.json({ error: { kind: "other" } }, { status: 500 }) : make();
    const notFound = () => Response.json({ error: { kind: "not_found" } }, { status: 404 });
    if (chatId === undefined) {
      if (method === "GET") return respond("list", () => Response.json({ chats: state.chats }));
      return respond("create", () => {
        if (state.refuseCreate) return Response.json(state.refuseCreate.body, { status: state.refuseCreate.status });
        state.created += 1;
        const now = new Date().toISOString();
        const chat = { id: `new-${state.created}`, title: null, createdAt: now, updatedAt: now };
        state.chats.unshift(chat);
        return Response.json({ id: chat.id }, { status: 201 });
      });
    }
    const chat = state.chats.find((item) => item.id === chatId);
    if (action === undefined && method === "PATCH") {
      return respond("rename", () => {
        if (!chat) return notFound();
        if (typeof body?.title !== "string" || body.title.trim() === "") {
          return Response.json({ error: { kind: "invalid" } }, { status: 400 });
        }
        chat.title = body.title.trim().replace(/\s+/g, " ");
        return Response.json({ id: chat.id, title: chat.title });
      });
    }
    if (action === undefined && method === "DELETE") {
      return respond("delete", () => {
        if (!chat) return notFound();
        if (state.busy.has(chat.id)) return Response.json({ error: { kind: "busy" } }, { status: 409 });
        state.chats.splice(state.chats.indexOf(chat), 1);
        return new Response(null, { status: 204 });
      });
    }
    if (!chat && chatId !== "models") return notFound();
    return inner.fetch(input, init);
  });
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    state,
    requests,
    /** Запросы списка: не история и не модели. */
    listRequests: (method: string) => requests.filter((request) => request.method === method && request.path.split("/").length <= 4),
    chatServer: inner,
  };
}
