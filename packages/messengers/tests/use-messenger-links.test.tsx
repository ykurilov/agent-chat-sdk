// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessengerConnect, useMessengerLinks } from "../src/react";
import type { MessengerConnectPanelProps, MessengersSkin } from "../src/react";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

interface LinkRow {
  messenger: "telegram" | "vk" | "max";
  name: string;
  username?: string;
}

/** Поддельный сервер привязок: GET, POST, DELETE /links; каждый адрес можно уронить. */
function fakeLinksServer(messengers: LinkRow["messenger"][], links: LinkRow[] = []) {
  const state = { messengers, links, fail: new Set<string>(), expiresAt: "2099-10-05T12:15:00" };
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ method, url, body });
    if (state.fail.has(method)) return json({ error: "сбой" }, 500);
    if (method === "GET") return json({ messengers: state.messengers, links: state.links });
    if (method === "POST") return json({ url: `https://t.me/bot?start=CODE-${body.messenger}`, code: `CODE-${body.messenger}`, expiresAt: state.expiresAt });
    if (method === "DELETE") {
      const messenger = url.split("/").pop();
      state.links = state.links.filter((link) => link.messenger !== messenger);
      return new Response(null, { status: 204 });
    }
    return json({}, 404);
  });
  return { state, requests, fetch };
}

const renderLinks = (server: ReturnType<typeof fakeLinksServer>, pollMs = 20) =>
  renderHook(() => useMessengerLinks({ url: "/api/messengers", fetch: server.fetch, pollMs }));

const row = (props: MessengerConnectPanelProps, messenger: string) => props.rows.find((item) => item.messenger === messenger)!;

describe("useMessengerLinks", () => {
  it("загрузка: GET {url}/links; строка на каждый мессенджер сервера, привязанные — с именем", async () => {
    const server = fakeLinksServer(["telegram", "vk"], [{ messenger: "vk", name: "Анна", username: "anna" }]);
    const { result } = renderLinks(server);
    expect(result.current.state).toBe("loading");
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(server.requests[0]).toEqual({ method: "GET", url: "/api/messengers/links", body: undefined });
    expect(result.current.rows.map((item) => [item.messenger, item.connected])).toEqual([
      ["telegram", null],
      ["vk", { name: "Анна", username: "anna" }],
    ]);
  });

  it("«Подключить»: POST {messenger}, строка занята до ответа, потом ссылка с кодом и сроком «до 12:15»", async () => {
    const server = fakeLinksServer(["telegram"]);
    const { result } = renderLinks(server, 60_000);
    await waitFor(() => expect(result.current.state).toBe("ready"));
    act(() => row(result.current, "telegram").onConnect());
    expect(row(result.current, "telegram").busy).toBe(true);
    await waitFor(() => expect(row(result.current, "telegram").offer).toBeDefined());
    expect(server.requests[1]).toEqual({ method: "POST", url: "/api/messengers/links", body: { messenger: "telegram" } });
    expect(row(result.current, "telegram").offer).toEqual({ url: "https://t.me/bot?start=CODE-telegram", code: "CODE-telegram", expiresAt: "до 12:15" });
    expect(row(result.current, "telegram").busy).toBe(false);
  });

  it("пока ссылка открыта, список перечитывается; человек нажал «Начать» — ссылка уходит, строка «подключено»", async () => {
    const server = fakeLinksServer(["telegram"]);
    const { result } = renderLinks(server);
    await waitFor(() => expect(result.current.state).toBe("ready"));
    act(() => row(result.current, "telegram").onConnect());
    await waitFor(() => expect(row(result.current, "telegram").offer).toBeDefined());
    server.state.links = [{ messenger: "telegram", name: "Анна" }];
    await waitFor(() => expect(row(result.current, "telegram").connected).toEqual({ name: "Анна" }));
    expect(row(result.current, "telegram").offer).toBeUndefined();
    const reads = server.requests.filter((request) => request.method === "GET").length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(server.requests.filter((request) => request.method === "GET")).toHaveLength(reads);
  });

  it("без открытой ссылки список не перечитывается", async () => {
    const server = fakeLinksServer(["telegram"]);
    const { result } = renderLinks(server);
    await waitFor(() => expect(result.current.state).toBe("ready"));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(server.requests).toHaveLength(1);
  });

  it("«Отвязать»: DELETE {url}/links/{messenger}, строка снова без привязки", async () => {
    const server = fakeLinksServer(["max"], [{ messenger: "max", name: "Пётр" }]);
    const { result } = renderLinks(server);
    await waitFor(() => expect(row(result.current, "max").connected).not.toBeNull());
    act(() => row(result.current, "max").onDisconnect());
    await waitFor(() => expect(row(result.current, "max").connected).toBeNull());
    expect(server.requests.find((request) => request.method === "DELETE")!.url).toBe("/api/messengers/links/max");
    expect(row(result.current, "max").busy).toBe(false);
  });

  it("запрос строки не прошёл — failed у этой строки, кнопка снова доступна; удачный повтор снимает ошибку", async () => {
    const server = fakeLinksServer(["telegram", "vk"]);
    server.state.fail.add("POST");
    const { result } = renderLinks(server, 60_000);
    await waitFor(() => expect(result.current.state).toBe("ready"));
    act(() => row(result.current, "telegram").onConnect());
    await waitFor(() => expect(row(result.current, "telegram").failed).toBe(true));
    expect(row(result.current, "telegram").busy).toBe(false);
    expect(row(result.current, "vk").failed).toBe(false);
    server.state.fail.delete("POST");
    act(() => row(result.current, "telegram").onConnect());
    await waitFor(() => expect(row(result.current, "telegram").offer).toBeDefined());
    expect(row(result.current, "telegram").failed).toBe(false);
  });

  it("список не загрузился — failed; «Повторить» загружает снова", async () => {
    const server = fakeLinksServer(["telegram"]);
    server.state.fail.add("GET");
    const { result } = renderLinks(server);
    await waitFor(() => expect(result.current.state).toBe("failed"));
    server.state.fail.delete("GET");
    act(() => result.current.onRetry());
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.rows).toHaveLength(1);
  });

  it("срок кода вышел — ссылка уходит, можно взять новую", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-05T12:00:00") });
    const server = fakeLinksServer(["telegram"]);
    server.state.expiresAt = "2026-10-05T12:15:00";
    const { result } = renderLinks(server);
    await waitFor(() => expect(result.current.state).toBe("ready"));
    act(() => row(result.current, "telegram").onConnect());
    await waitFor(() => expect(row(result.current, "telegram").offer).toBeDefined());
    vi.setSystemTime(new Date("2026-10-05T12:16:00"));
    await waitFor(() => expect(row(result.current, "telegram").offer).toBeUndefined());
    expect(row(result.current, "telegram").connected).toBeNull();
  });
});

describe("MessengerConnect", () => {
  it("рисует только панель скина с готовыми строками", async () => {
    const server = fakeLinksServer(["telegram"], [{ messenger: "telegram", name: "Анна" }]);
    const skin: MessengersSkin = {
      MessengerConnectPanel: ({ state, rows }) => (
        <p data-testid="panel">
          {state}:{rows.map((item) => `${item.messenger}=${item.connected?.name ?? "-"}`).join(",")}
        </p>
      ),
    };
    render(<MessengerConnect skin={skin} url="/api/messengers" fetch={server.fetch} />);
    await waitFor(() => expect(screen.getByTestId("panel").textContent).toBe("ready:telegram=Анна"));
  });
});
