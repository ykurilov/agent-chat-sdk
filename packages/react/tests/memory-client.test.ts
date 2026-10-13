import { describe, expect, it } from "vitest";
import { createMemoryApi, MemoryRequestError } from "../src/memory/memory-client";
import { fakeMemoryServer, note } from "./support/fake-memory-server";

const api = "/api/chat";

function clientFor(server: ReturnType<typeof fakeMemoryServer>, base = api) {
  return createMemoryApi({ api: base, fetch: server.fetch });
}

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as MemoryRequestError;
  }
  throw new Error("ожидали отказ");
};

describe("клиент адресов памяти", () => {
  it("список: GET {api}/memory, записи и счётчики как в ответе; косая черта в конце адреса не мешает", async () => {
    const server = fakeMemoryServer([note("a", ["О себе"], "Любит чай")]);
    server.state.shown = 1;
    const result = await clientFor(server, "/api/chat/").list();
    expect(result.notes.map((item) => item.id)).toEqual(["a"]);
    expect(result.counts).toEqual({ total: 1, limit: 200, shown: 1 });
    expect(server.requests).toEqual([{ method: "GET", path: "/api/chat/memory", search: "", body: undefined }]);
  });

  it("создание: POST с разделами и текстом, возвращает запись", async () => {
    const server = fakeMemoryServer();
    const created = await clientFor(server).create({ categories: ["О себе", "Работа"], content: "Пишет на TypeScript" });
    expect(created).toMatchObject({ categories: ["О себе", "Работа"], content: "Пишет на TypeScript", version: 1 });
    expect(server.requests[0]).toMatchObject({ method: "POST", path: "/api/chat/memory", body: { categories: ["О себе", "Работа"], content: "Пишет на TypeScript" } });
  });

  it("правка: PATCH по id, версия уходит в теле; id с особыми знаками кодируется", async () => {
    const server = fakeMemoryServer([note("a/b", ["Правила"], "Отвечай на ты", 3)]);
    const updated = await clientFor(server).update("a/b", 3, { categories: ["Правила"], content: "Отвечай на «вы»" });
    expect(updated.version).toBe(4);
    expect(server.requests[0]).toMatchObject({ method: "PATCH", path: "/api/chat/memory/a%2Fb", body: { categories: ["Правила"], content: "Отвечай на «вы»", version: 3 } });
  });

  it("удаление: DELETE с версией в адресе; стирание всего — DELETE без id, число удалённых", async () => {
    const server = fakeMemoryServer([note("a", ["X"], "1"), note("b", ["X"], "2")]);
    const memory = clientFor(server);
    await memory.remove("a", 1);
    expect(server.requests[0]).toMatchObject({ method: "DELETE", path: "/api/chat/memory/a", search: "?version=1" });
    expect(await memory.clear()).toBe(1);
    expect(server.requests[1]).toMatchObject({ method: "DELETE", path: "/api/chat/memory", search: "" });
  });

  it("отказ сервера: статус и kind из тела; тело без kind — kind не выдумывается", async () => {
    const server = fakeMemoryServer([note("a", ["X"], "1", 2)]);
    const memory = clientFor(server);
    const stale = await rejection(memory.remove("a", 1));
    expect(stale).toBeInstanceOf(MemoryRequestError);
    expect(stale).toMatchObject({ status: 409, kind: "stale_version" });
    server.state.off = true;
    const off = await rejection(memory.list());
    expect(off).toMatchObject({ status: 404 });
    expect(off.kind).toBeUndefined();
  });

  it("сеть недоступна — отказ обычной ошибкой fetch, не MemoryRequestError", async () => {
    const server = fakeMemoryServer();
    server.state.down = true;
    const error = await rejection(clientFor(server).list());
    expect(error).not.toBeInstanceOf(MemoryRequestError);
  });
});

describe("клиент адресов склейки повторов", () => {
  const merge = (revertible = true) => ({
    runId: "run/1",
    finishedAt: "2026-09-30T12:00:00.000Z",
    revertible,
    groups: [{ result: note("r", ["О себе"], "Пишет на TypeScript в Acme"), originals: [note("o1", ["О себе"], "Пишет на TypeScript"), note("o2", ["О себе"], "Работает в Acme")] }],
  });

  it("список: GET {api}/memory/merges, склейки как в ответе", async () => {
    const server = fakeMemoryServer([], [merge()]);
    const merges = await clientFor(server).listMerges();
    expect(merges).toEqual([merge()]);
    expect(server.requests).toEqual([{ method: "GET", path: "/api/chat/memory/merges", search: "", body: undefined }]);
  });

  it("вернуть как было: POST по номеру запуска, номер с особыми знаками кодируется", async () => {
    const server = fakeMemoryServer([], [merge()]);
    await clientFor(server).revertMerge("run/1");
    expect(server.requests[0]).toMatchObject({ method: "POST", path: "/api/chat/memory/merges/run%2F1/revert" });
    expect(server.state.notes.map((item) => item.id).sort()).toEqual(["o1", "o2"]);
  });

  it("отказы: 409 conflict, 404 not_found, 404 без тела, 500", async () => {
    const server = fakeMemoryServer([], [merge(false)]);
    const memory = clientFor(server);
    expect(await rejection(memory.revertMerge("run/1"))).toMatchObject({ status: 409, kind: "conflict" });
    expect(await rejection(memory.revertMerge("нет"))).toMatchObject({ status: 404, kind: "not_found" });
    for (const kind of ["limit_reached", "duplicate"] as const) {
      server.state.merges = [merge(true)];
      server.state.revertRefusal = kind;
      expect(await rejection(memory.revertMerge("run/1"))).toMatchObject({ status: 409, kind });
    }
    server.state.revertRefusal = undefined;
    server.state.noMerges = true;
    expect(await rejection(memory.listMerges())).toMatchObject({ status: 404, kind: undefined });
    server.state.noMerges = false;
    server.state.fail.add("merges");
    expect(await rejection(memory.listMerges())).toMatchObject({ status: 500 });
  });
});
