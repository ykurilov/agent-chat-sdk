// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useChatList } from "../src/chat-list/use-chat-list";
import { fakeChatListServer } from "./support/fake-chat-list-server";

const api = "/api/chat";

function renderList(server: ReturnType<typeof fakeChatListServer>, options: { initialChatId?: string } = {}) {
  return renderHook(() => useChatList({ api, fetch: server.fetch, ...options }));
}

const threeChats = () =>
  fakeChatListServer([
    { id: "c3", title: "Третий" },
    { id: "c2", title: "Второй" },
    { id: "c1", title: "Первый" },
  ]);

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useChatList: загрузка и выбор открытого чата", () => {
  it("грузит список: сначала loading, потом ready; открыт самый недавний", async () => {
    const server = threeChats();
    const { result } = renderList(server);
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.items.map((item) => item.id)).toEqual(["c3", "c2", "c1"]);
    expect(result.current.activeChatId).toBe("c3");
  });

  it("initialChatId главнее всего, даже если его нет в списке", async () => {
    const server = threeChats();
    const { result } = renderList(server, { initialChatId: "нет-такого" });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.activeChatId).toBe("нет-такого");
  });

  it("без initialChatId открывается запомненный чат, если он есть в списке; чужой запомненный игнорируется", async () => {
    localStorage.setItem(`agent-chat:active-chat:${api}`, "c1");
    const first = renderList(threeChats());
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    expect(first.result.current.activeChatId).toBe("c1");
    first.unmount();

    localStorage.setItem(`agent-chat:active-chat:${api}`, "удалённый");
    const second = renderList(threeChats());
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(second.result.current.activeChatId).toBe("c3");
  });

  it("выбор запоминается: следующий заход открывает тот же чат", async () => {
    const server = threeChats();
    const first = renderList(server);
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    act(() => first.result.current.select("c2"));
    expect(first.result.current.activeChatId).toBe("c2");
    first.unmount();
    const second = renderList(server);
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(second.result.current.activeChatId).toBe("c2");
  });

  it("список пуст — создаётся первый чат и открывается", async () => {
    const server = fakeChatListServer();
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.activeChatId).toBe("new-1"));
    expect(result.current.items.map((item) => item.id)).toEqual(["new-1"]);
    expect(server.listRequests("POST")).toHaveLength(1);
  });

  it("список не загрузился — status error, чат не открыт; «повторить» загружает", async () => {
    const server = threeChats();
    server.state.fail.add("list");
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.activeChatId).toBeNull();
    server.state.fail.clear();
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.activeChatId).toBe("c3");
  });

  it("список не загрузился, но чат назван при открытии — он открыт без списка", async () => {
    const server = threeChats();
    server.state.fail.add("list");
    const { result } = renderList(server, { initialChatId: "c1" });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.activeChatId).toBe("c1");
  });

  it("сервер недоступен — тоже error", async () => {
    const server = threeChats();
    server.state.down = true;
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("refresh подтягивает свежие названия и порядок, открытый чат не меняется", async () => {
    const server = threeChats();
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    server.state.chats[2]!.title = "Переименован на сервере";
    server.state.chats.unshift(server.state.chats.pop()!);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.items.map((item) => item.id)).toEqual(["c1", "c3", "c2"]);
    expect(result.current.items[0]?.title).toBe("Переименован на сервере");
    expect(result.current.activeChatId).toBe("c3");
  });

  it("refresh посреди первой загрузки не оставляет status в loading", async () => {
    const server = threeChats();
    const { result } = renderList(server);
    expect(result.current.status).toBe("loading");
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.items.map((item) => item.id)).toEqual(["c3", "c2", "c1"]);
    expect(result.current.activeChatId).toBe("c3");
  });
});

describe("useChatList: новый чат", () => {
  it("создаёт чат, ставит его первым и открывает", async () => {
    const server = threeChats();
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      await result.current.create();
    });
    expect(result.current.activeChatId).toBe("new-1");
    expect(result.current.items.map((item) => item.id)).toEqual(["new-1", "c3", "c2", "c1"]);
    expect(result.current.items[0]?.title).toBeNull();
  });

  it("пустой чат уже есть — «Новый чат» открывает его, а не плодит второй", async () => {
    const server = fakeChatListServer([
      { id: "c2", title: "Второй" },
      { id: "empty", title: null },
    ]);
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      await result.current.create();
    });
    expect(result.current.activeChatId).toBe("empty");
    expect(server.listRequests("POST")).toHaveLength(0);
  });

  it("пустой чат уже открыт — ничего не происходит", async () => {
    const server = fakeChatListServer([{ id: "empty", title: null }]);
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.activeChatId).toBe("empty"));
    await act(async () => {
      await result.current.create();
    });
    expect(result.current.activeChatId).toBe("empty");
    expect(server.listRequests("POST")).toHaveLength(0);
  });

  it("чат без названия, но с сообщениями (старый, только файлы) не считается пустым: создаётся новый", async () => {
    const server = fakeChatListServer([
      { id: "old", title: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" },
    ]);
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.activeChatId).toBe("old"));
    await act(async () => {
      await result.current.create();
    });
    expect(result.current.activeChatId).toBe("new-1");
    expect(result.current.items.map((item) => item.id)).toEqual(["new-1", "old"]);
  });

  it("чат объекта без названия (приветствие, ещё без ответа) не считается пустым: создаётся новый", async () => {
    const server = fakeChatListServer([{ id: "lesson", title: null, subjectKey: "lesson:1" } as never]);
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.activeChatId).toBe("lesson"));
    await act(async () => {
      await result.current.create();
    });
    expect(result.current.activeChatId).toBe("new-1");
  });

  it("пустым считается чат без названия по данным сервера, а не по устаревшему списку", async () => {
    const server = fakeChatListServer([{ id: "c1", title: null }]);
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.activeChatId).toBe("c1"));
    // Пока список не обновился, в нём чат «пустой»; на деле в нём уже написали, и сервер дал название.
    server.state.chats[0]!.title = "Уже с названием";
    await act(async () => {
      await result.current.create();
    });
    expect(result.current.activeChatId).toBe("new-1");
  });

  it("не удалось создать — error create, открытый чат прежний", async () => {
    const server = threeChats();
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    server.state.fail.add("create");
    await act(async () => {
      await result.current.create();
    });
    expect(result.current.error).toBe("create");
    expect(result.current.activeChatId).toBe("c3");
    expect(result.current.creating).toBe(false);
  });
});

describe("useChatList: переименование", () => {
  it("название меняется сразу, сервер подтверждает своим (пробелы схлопнуты)", async () => {
    const server = threeChats();
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      await result.current.rename("c2", "  Отпуск  в   Греции ");
    });
    expect(result.current.items.find((item) => item.id === "c2")?.title).toBe("Отпуск в Греции");
    expect(server.state.chats.find((chat) => chat.id === "c2")?.title).toBe("Отпуск в Греции");
    expect(result.current.error).toBeNull();
  });

  it("пустое или прежнее название — запроса нет", async () => {
    const server = threeChats();
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      await result.current.rename("c2", "   ");
      await result.current.rename("c2", "Второй");
    });
    expect(server.listRequests("PATCH")).toHaveLength(0);
  });

  it("сервер отказал — старое название возвращается, error rename", async () => {
    const server = threeChats();
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    server.state.fail.add("rename");
    await act(async () => {
      await result.current.rename("c2", "Новое");
    });
    expect(result.current.items.find((item) => item.id === "c2")?.title).toBe("Второй");
    expect(result.current.error).toBe("rename");
  });

  it("следующее успешное действие снимает ошибку", async () => {
    const server = threeChats();
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    server.state.fail.add("rename");
    await act(async () => {
      await result.current.rename("c2", "Новое");
    });
    server.state.fail.clear();
    await act(async () => {
      await result.current.rename("c2", "Новое");
    });
    expect(result.current.error).toBeNull();
  });
});

describe("useChatList: удаление", () => {
  it("запрос удаления ничего не удаляет; отмена его снимает", async () => {
    const server = threeChats();
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.requestDelete("c2"));
    expect(result.current.deleteRequest).toEqual({ id: "c2", title: "Второй" });
    act(() => result.current.cancelDelete());
    expect(result.current.deleteRequest).toBeNull();
    expect(server.listRequests("DELETE")).toHaveLength(0);
    expect(server.state.chats).toHaveLength(3);
  });

  it("подтверждение удаляет чат; открыт был другой — он остаётся открытым", async () => {
    const server = threeChats();
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.requestDelete("c2"));
    await act(async () => {
      await result.current.confirmDelete();
    });
    expect(result.current.items.map((item) => item.id)).toEqual(["c3", "c1"]);
    expect(result.current.activeChatId).toBe("c3");
    expect(result.current.deleteRequest).toBeNull();
    expect(server.state.chats.map((chat) => chat.id)).toEqual(["c3", "c1"]);
  });

  it("удалён открытый чат — открывается соседний (следующий по списку, у последнего — предыдущий)", async () => {
    const server = threeChats();
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.select("c2"));
    act(() => result.current.requestDelete("c2"));
    await act(async () => {
      await result.current.confirmDelete();
    });
    expect(result.current.activeChatId).toBe("c1");
    act(() => result.current.requestDelete("c1"));
    await act(async () => {
      await result.current.confirmDelete();
    });
    expect(result.current.activeChatId).toBe("c3");
  });

  it("удалён последний чат — создаётся и открывается новый пустой", async () => {
    const server = fakeChatListServer([{ id: "only", title: "Единственный" }]);
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.activeChatId).toBe("only"));
    act(() => result.current.requestDelete("only"));
    await act(async () => {
      await result.current.confirmDelete();
    });
    expect(result.current.activeChatId).toBe("new-1");
    expect(result.current.items.map((item) => item.id)).toEqual(["new-1"]);
  });

  it("чата на сервере уже нет (404) — это успех: из списка он уходит", async () => {
    const server = threeChats();
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.requestDelete("c2"));
    server.state.chats.splice(1, 1);
    await act(async () => {
      await result.current.confirmDelete();
    });
    expect(result.current.items.map((item) => item.id)).toEqual(["c3", "c1"]);
    expect(result.current.error).toBeNull();
  });

  it("сервер отказал (чат занят, сбой) — чат остаётся, error delete, окно закрыто", async () => {
    const server = threeChats();
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    server.state.busy.add("c2");
    act(() => result.current.requestDelete("c2"));
    await act(async () => {
      await result.current.confirmDelete();
    });
    expect(result.current.items.map((item) => item.id)).toEqual(["c3", "c2", "c1"]);
    expect(result.current.error).toBe("delete");
    expect(result.current.deleteRequest).toBeNull();
  });

  it("удаляемый чат без названия в запросе получает пустое название: подпись подставляет скин", async () => {
    const server = fakeChatListServer([{ id: "empty", title: null }, { id: "c1", title: "Первый" }]);
    const { result } = renderList(server);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.requestDelete("empty"));
    expect(result.current.deleteRequest).toEqual({ id: "empty", title: null });
  });
});

describe("useChatList: сменился человек (ключ запомненного чата)", () => {
  /** Два человека на одном адресе: сервер отвечает тому, кто вошёл на момент запроса; запросы можно придержать. */
  function twoPeople() {
    const people = {
      ivan: fakeChatListServer([{ id: "ivan-1", title: "Чат Ивана" }]),
      maria: fakeChatListServer([{ id: "maria-1", title: "Чат Марии" }]),
    };
    const state = { who: "ivan" as keyof typeof people, hold: null as null | ((method: string) => boolean) };
    const held: Array<() => void> = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const server = people[state.who];
      const method = (init?.method ?? "GET").toUpperCase();
      if (state.hold?.(method)) await new Promise<void>((release) => held.push(release));
      return server.fetch(input, init);
    }) as typeof globalThis.fetch;
    const releaseAll = async () => {
      await act(async () => {
        for (const release of held.splice(0)) release();
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    };
    return { people, state, fetch, releaseAll };
  }

  function renderFor(fetch: typeof globalThis.fetch) {
    return renderHook(({ person }: { person: string }) => useChatList({ api, fetch, rememberKey: `panel:${person}` }), {
      initialProps: { person: "ivan" },
    });
  }

  it("в первом же кадре после смены нет чата и списка прежнего человека", async () => {
    const { fetch, state } = twoPeople();
    const seen: string[] = [];
    const { result, rerender } = renderHook(
      ({ person }: { person: string }) => {
        const list = useChatList({ api, fetch, rememberKey: `panel:${person}` });
        seen.push(`${person}:${list.activeChatId}:${list.items.map((item) => item.id).join(",")}`);
        return list;
      },
      { initialProps: { person: "ivan" } },
    );
    await waitFor(() => expect(result.current.activeChatId).toBe("ivan-1"));
    state.who = "maria";
    seen.length = 0;
    rerender({ person: "maria" });
    expect(seen.filter((frame) => frame.startsWith("maria:") && frame.includes("ivan"))).toEqual([]);
    expect(result.current.activeChatId).toBeNull();
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.activeChatId).toBe("maria-1"));
  });

  it("«Новый чат» прежнего человека, закончившийся после смены, не трогает список и чат нового", async () => {
    const { fetch, state, people, releaseAll } = twoPeople();
    people.ivan.state.chats.push({ id: "ivan-empty", title: null, createdAt: "2026-01-05T00:00:00.000Z", updatedAt: "2026-01-05T00:00:00.000Z" });
    const { result, rerender } = renderFor(fetch);
    await waitFor(() => expect(result.current.activeChatId).toBe("ivan-1"));
    state.hold = (method) => method === "GET";
    let created: Promise<boolean> | undefined;
    act(() => {
      created = result.current.create();
    });
    state.hold = null;
    state.who = "maria";
    rerender({ person: "maria" });
    await waitFor(() => expect(result.current.activeChatId).toBe("maria-1"));
    await releaseAll();
    expect(await created).toBe(false);
    expect(result.current.activeChatId).toBe("maria-1");
    expect(result.current.items.map((item) => item.id)).toEqual(["maria-1"]);
    expect(result.current.creating).toBe(false);
    expect(localStorage.getItem("panel:maria")).toBe("maria-1");
    expect(localStorage.getItem("panel:ivan")).toBe("ivan-1");
  });

  it("переименование прежнего человека, закончившееся после смены, не показывает ошибку и не меняет список нового", async () => {
    const { fetch, state, people, releaseAll } = twoPeople();
    const { result, rerender } = renderFor(fetch);
    await waitFor(() => expect(result.current.activeChatId).toBe("ivan-1"));
    people.ivan.state.fail.add("rename");
    state.hold = (method) => method === "PATCH";
    act(() => void result.current.rename("ivan-1", "Новое название"));
    state.hold = null;
    state.who = "maria";
    rerender({ person: "maria" });
    await waitFor(() => expect(result.current.activeChatId).toBe("maria-1"));
    await releaseAll();
    expect(result.current.error).toBeNull();
    expect(result.current.items).toEqual([expect.objectContaining({ id: "maria-1", title: "Чат Марии" })]);
  });

  it("удаление последнего чата прежнего человека, закончившееся после смены, не создаёт чат и не трогает нового", async () => {
    const { fetch, state, people, releaseAll } = twoPeople();
    const { result, rerender } = renderFor(fetch);
    await waitFor(() => expect(result.current.activeChatId).toBe("ivan-1"));
    act(() => result.current.requestDelete("ivan-1"));
    state.hold = (method) => method === "DELETE";
    act(() => void result.current.confirmDelete());
    state.hold = null;
    state.who = "maria";
    rerender({ person: "maria" });
    await waitFor(() => expect(result.current.activeChatId).toBe("maria-1"));
    await releaseAll();
    expect(people.ivan.listRequests("POST")).toHaveLength(0);
    expect(people.maria.listRequests("POST")).toHaveLength(0);
    expect(result.current.activeChatId).toBe("maria-1");
    expect(result.current.items.map((item) => item.id)).toEqual(["maria-1"]);
    expect(result.current.deleting).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
