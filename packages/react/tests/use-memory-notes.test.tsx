// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryApi } from "../src/memory/memory-client";
import { useMemoryNotes } from "../src/memory/use-memory-notes";
import { fakeMemoryServer, note } from "./support/fake-memory-server";
import type { FakeMerge, FakeNote } from "./support/fake-memory-server";

afterEach(cleanup);

function renderNotes(server: ReturnType<typeof fakeMemoryServer>) {
  const api = createMemoryApi({ api: "/api/chat", fetch: server.fetch });
  return renderHook(() => useMemoryNotes(api));
}

const ready = async (server: ReturnType<typeof fakeMemoryServer>) => {
  const hook = renderNotes(server);
  await waitFor(() => expect(hook.result.current.state).not.toBe("loading"));
  return hook;
};

const two = (): FakeNote[] => [note("a", ["О себе"], "Любит чай"), note("b", ["Правила"], "Отвечай на ты")];
const input = { categories: ["О себе", "Работа"], content: "Пишет на TypeScript" };
const ids = (hook: Awaited<ReturnType<typeof ready>>) => hook.result.current.notes.map((item) => item.id);

describe("useMemoryNotes: загрузка", () => {
  it("сначала loading, потом ready с записями и счётчиками", async () => {
    const server = fakeMemoryServer(two());
    server.state.shown = 1;
    const { result } = renderNotes(server);
    expect(result.current.state).toBe("loading");
    expect(result.current.notes).toEqual([]);
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.notes.map((item) => item.id).sort()).toEqual(["a", "b"]);
    expect(result.current.counts).toEqual({ total: 2, limit: 200, shown: 1 });
    expect(result.current.error).toBeNull();
  });

  it("записей нет — empty, счётчики на месте", async () => {
    const { result } = await ready(fakeMemoryServer());
    expect(result.current.state).toBe("empty");
    expect(result.current.notes).toEqual([]);
    expect(result.current.counts).toEqual({ total: 0, limit: 200, shown: 0 });
  });

  it("404 на списке (память в приложении не включена) — unavailable, не error", async () => {
    const server = fakeMemoryServer(two());
    server.state.off = true;
    const { result } = await ready(server);
    expect(result.current.state).toBe("unavailable");
  });

  it("сбой сервера и обрыв связи — error; reload() грузит заново и выводит из ошибки", async () => {
    const server = fakeMemoryServer(two());
    server.state.fail.add("list");
    const hook = await ready(server);
    expect(hook.result.current.state).toBe("error");
    server.state.fail.clear();
    act(() => hook.result.current.reload());
    await waitFor(() => expect(hook.result.current.state).toBe("ready"));
    expect(hook.result.current.notes).toHaveLength(2);

    const offline = fakeMemoryServer(two());
    offline.state.down = true;
    const second = await ready(offline);
    expect(second.result.current.state).toBe("error");
  });
});

describe("useMemoryNotes: добавление", () => {
  it("успех: запись в списке первой, состояние ready, счётчик растёт", async () => {
    const server = fakeMemoryServer(two());
    const hook = await ready(server);
    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current.add(input);
    });
    expect(outcome).toEqual({ ok: true });
    expect(hook.result.current.notes[0]).toMatchObject({ content: "Пишет на TypeScript", version: 1 });
    await waitFor(() => expect(hook.result.current.counts?.total).toBe(3));
  });

  it("первая запись выводит из empty в ready", async () => {
    const hook = await ready(fakeMemoryServer());
    await act(async () => {
      await hook.result.current.add(input);
    });
    expect(hook.result.current.state).toBe("ready");
  });

  it.each([
    ["дубль", "duplicate"],
    ["предел записей", "limit_reached"],
  ])("%s: отказ с kind %s, список не меняется", async (_name, kind) => {
    const server = fakeMemoryServer(two());
    if (kind === "limit_reached") server.state.limit = 2;
    const hook = await ready(server);
    const duplicate = { categories: ["О себе"], content: "Любит чай" };
    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current.add(kind === "duplicate" ? duplicate : input);
    });
    expect(outcome).toEqual({ ok: false, failure: kind });
    expect(hook.result.current.error).toBe(kind);
    expect(ids(hook).sort()).toEqual(["a", "b"]);
  });

  it("сервер не принял форму — failure invalid; обрыв связи — other", async () => {
    const server = fakeMemoryServer();
    const hook = await ready(server);
    let invalid: unknown;
    await act(async () => {
      invalid = await hook.result.current.add({ categories: [], content: "x" });
    });
    expect(invalid).toEqual({ ok: false, failure: "invalid" });
    server.state.down = true;
    let down: unknown;
    await act(async () => {
      down = await hook.result.current.add(input);
    });
    expect(down).toEqual({ ok: false, failure: "other" });
  });

  it("следующее действие сбрасывает прежнюю ошибку", async () => {
    const hook = await ready(fakeMemoryServer(two()));
    await act(async () => {
      await hook.result.current.add({ categories: [], content: "x" });
    });
    expect(hook.result.current.error).toBe("invalid");
    await act(async () => {
      await hook.result.current.add(input);
    });
    expect(hook.result.current.error).toBeNull();
  });
});

describe("useMemoryNotes: правка", () => {
  it("успех: текст и версия обновились в списке; ушла версия, которую человек видел", async () => {
    const server = fakeMemoryServer([note("a", ["О себе"], "Любит чай", 4)]);
    const hook = await ready(server);
    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current.edit("a", { categories: ["О себе"], content: "Любит кофе" });
    });
    expect(outcome).toEqual({ ok: true });
    expect(hook.result.current.notes[0]).toMatchObject({ content: "Любит кофе", version: 5 });
    expect(server.requestsOf("PATCH")[0]?.body).toMatchObject({ version: 4 });
  });

  it("конфликт версий: отказ stale_version, список перезагружен (видно чужую правку), поля вызывающего целы; повтор проходит", async () => {
    const server = fakeMemoryServer([note("a", ["О себе"], "Любит чай", 1)]);
    const hook = await ready(server);
    server.editElsewhere("a", "Любит зелёный чай");
    const mine = { categories: ["О себе"], content: "Любит кофе" };
    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current.edit("a", mine);
    });
    expect(outcome).toEqual({ ok: false, failure: "stale_version" });
    expect(hook.result.current.error).toBe("stale_version");
    expect(hook.result.current.notes[0]).toMatchObject({ content: "Любит зелёный чай", version: 2 });
    expect(hook.result.current.state).toBe("ready");
    // Вызывающий держит свой черновик: тот же ввод уходит снова, уже с обновлённой версией.
    await act(async () => {
      outcome = await hook.result.current.edit("a", mine);
    });
    expect(outcome).toEqual({ ok: true });
    expect(hook.result.current.notes[0]).toMatchObject({ content: "Любит кофе", version: 3 });
    expect(hook.result.current.error).toBeNull();
  });

  it("записи уже нет: not_found, список перезагружен без неё", async () => {
    const server = fakeMemoryServer(two());
    const hook = await ready(server);
    server.removeElsewhere("a");
    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current.edit("a", { categories: ["О себе"], content: "Другое" });
    });
    expect(outcome).toEqual({ ok: false, failure: "not_found" });
    expect(ids(hook)).toEqual(["b"]);
  });

  it("дубль другой записи — duplicate; запись в списке прежняя", async () => {
    const hook = await ready(fakeMemoryServer(two()));
    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current.edit("a", { categories: ["Правила"], content: "Отвечай на ты" });
    });
    expect(outcome).toEqual({ ok: false, failure: "duplicate" });
    expect(hook.result.current.notes.find((item) => item.id === "a")?.content).toBe("Любит чай");
  });
});

describe("useMemoryNotes: удаление и стирание", () => {
  it("удаление: записи нет в списке; последняя — empty; ушла версия из списка", async () => {
    const server = fakeMemoryServer([note("a", ["X"], "1", 2), note("b", ["X"], "2")]);
    const hook = await ready(server);
    await act(async () => {
      expect(await hook.result.current.remove("a")).toEqual({ ok: true });
    });
    expect(server.requestsOf("DELETE")[0]).toMatchObject({ path: "/api/chat/memory/a", search: "?version=2" });
    expect(ids(hook)).toEqual(["b"]);
    await act(async () => {
      await hook.result.current.remove("b");
    });
    expect(hook.result.current.state).toBe("empty");
  });

  it("запись уже удалена в другом месте (404) — тоже успех: человек хотел, чтобы её не было", async () => {
    const server = fakeMemoryServer(two());
    const hook = await ready(server);
    server.removeElsewhere("a");
    await act(async () => {
      expect(await hook.result.current.remove("a")).toEqual({ ok: true });
    });
    expect(ids(hook)).toEqual(["b"]);
  });

  it("удаление устаревшей версии: stale_version, запись осталась, список перезагружен", async () => {
    const server = fakeMemoryServer([note("a", ["X"], "1", 1)]);
    const hook = await ready(server);
    server.editElsewhere("a", "новый текст");
    await act(async () => {
      expect(await hook.result.current.remove("a")).toEqual({ ok: false, failure: "stale_version" });
    });
    expect(hook.result.current.notes[0]).toMatchObject({ content: "новый текст", version: 2 });
  });

  it("стирание всей памяти: список пуст, состояние empty, счётчик 0", async () => {
    const server = fakeMemoryServer(two());
    const hook = await ready(server);
    await act(async () => {
      expect(await hook.result.current.clear()).toEqual({ ok: true });
    });
    expect(hook.result.current.state).toBe("empty");
    expect(hook.result.current.notes).toEqual([]);
    expect(hook.result.current.counts?.total).toBe(0);
  });

  it("стирание не прошло — список прежний, failure other", async () => {
    const server = fakeMemoryServer(two());
    const hook = await ready(server);
    server.state.fail.add("clear");
    await act(async () => {
      expect(await hook.result.current.clear()).toEqual({ ok: false, failure: "other" });
    });
    expect(hook.result.current.notes).toHaveLength(2);
    expect(hook.result.current.error).toBe("other");
  });

  it("действие над памятью, которой нет (404 без kind), — failure unavailable", async () => {
    const server = fakeMemoryServer();
    const hook = await ready(server);
    server.state.off = true;
    await act(async () => {
      expect(await hook.result.current.add(input)).toEqual({ ok: false, failure: "unavailable" });
    });
  });
});

const tsNote = (id: string, content: string) => note(id, ["Работа"], content);
const merge = (runId: string, revertible = true): FakeMerge => ({
  runId,
  finishedAt: "2026-09-30T12:00:00.000Z",
  revertible,
  groups: [{ result: tsNote("r", "Пишет на TypeScript в Acme"), originals: [tsNote("o1", "Пишет на TypeScript"), tsNote("o2", "Работает в Acme")] }],
});
const withMerge = (revertible = true) => fakeMemoryServer([note("a", ["О себе"], "Любит чай"), tsNote("r", "Пишет на TypeScript в Acme")], [merge("run-1", revertible)]);

describe("useMemoryNotes: склейка повторов", () => {
  it("склейки приходят вместе со списком записей", async () => {
    const hook = await ready(withMerge());
    await waitFor(() => expect(hook.result.current.merges.map((item) => item.runId)).toEqual(["run-1"]));
    expect(hook.result.current.merges[0]).toMatchObject({ revertible: true, groups: [{ result: { id: "r" }, originals: [{ id: "o1" }, { id: "o2" }] }] });
  });

  it("склеек нет — пустой список; сервер без адреса склеек (404) или сбой склеек не ломают список записей", async () => {
    const plain = await ready(fakeMemoryServer(two()));
    expect(plain.result.current.merges).toEqual([]);
    for (const breakIt of [(server: ReturnType<typeof withMerge>) => (server.state.noMerges = true), (server: ReturnType<typeof withMerge>) => server.state.fail.add("merges")]) {
      const server = withMerge();
      breakIt(server);
      const hook = await ready(server);
      expect(hook.result.current.state).toBe("ready");
      expect(hook.result.current.notes).toHaveLength(2);
      expect(hook.result.current.merges).toEqual([]);
    }
  });

  it("«Вернуть как было»: оригиналы вернулись в список, результата нет, склейка исчезла", async () => {
    const server = withMerge();
    const hook = await ready(server);
    await act(async () => {
      expect(await hook.result.current.revertMerge("run-1")).toEqual({ ok: true });
    });
    await waitFor(() => expect(hook.result.current.merges).toEqual([]));
    expect(ids(hook).sort()).toEqual(["a", "o1", "o2"]);
    expect(hook.result.current.counts?.total).toBe(3);
    expect(hook.result.current.error).toBeNull();
    expect(server.requestsOf("POST")).toEqual([expect.objectContaining({ path: "/api/chat/memory/merges/run-1/revert" })]);
  });

  it("результат менялся (409 conflict): failure conflict, записи не тронуты, список и склейки перезагружены", async () => {
    const server = withMerge(false);
    const hook = await ready(server);
    const listsBefore = server.requestsOf("GET").length;
    await act(async () => {
      expect(await hook.result.current.revertMerge("run-1")).toEqual({ ok: false, failure: "conflict" });
    });
    expect(hook.result.current.error).toBe("conflict");
    expect(ids(hook).sort()).toEqual(["a", "r"]);
    await waitFor(() => expect(server.requestsOf("GET").length).toBeGreaterThan(listsBefore));
  });

  it.each(["limit_reached", "duplicate"] as const)("возврат отклонён (409 %s): failure с этим кодом, записи не тронуты, склейка на месте", async (kind) => {
    const server = withMerge();
    server.state.revertRefusal = kind;
    const hook = await ready(server);
    await act(async () => {
      expect(await hook.result.current.revertMerge("run-1")).toEqual({ ok: false, failure: kind });
    });
    expect(hook.result.current.error).toBe(kind);
    expect(ids(hook).sort()).toEqual(["a", "r"]);
    expect(hook.result.current.merges).toHaveLength(1);
  });

  it("запуска нет (404 not_found) — failure not_found; сбой сервера — other", async () => {
    const server = withMerge();
    const hook = await ready(server);
    await act(async () => {
      expect(await hook.result.current.revertMerge("нет-такого")).toEqual({ ok: false, failure: "not_found" });
    });
    server.state.fail.add("revert");
    await act(async () => {
      expect(await hook.result.current.revertMerge("run-1")).toEqual({ ok: false, failure: "other" });
    });
    expect(hook.result.current.error).toBe("other");
  });

  it("правка результата склейки обновляет и склейки: слияние уже нельзя вернуть", async () => {
    const server = withMerge();
    const hook = await ready(server);
    await act(async () => {
      server.state.merges[0]!.revertible = false;
      await hook.result.current.edit("a", { categories: ["О себе"], content: "Любит кофе" });
    });
    await waitFor(() => expect(hook.result.current.merges[0]?.revertible).toBe(false));
  });
});
