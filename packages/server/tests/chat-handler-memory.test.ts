import { describe, expect, it, vi } from "vitest";
import type { ChatMemory } from "../src/chat-handler";
import { fakeMemory } from "./support/fake-memory";
import { createTestChat, message } from "./support/test-chat";

const note = (content: string, categories = ["О себе"]) => ({ categories, content });

function memoryChat(options: Parameters<typeof fakeMemory>[0] = {}) {
  const fake = fakeMemory(options);
  const chat = createTestChat({ memory: fake.memory });
  const create = async (user: string, input: { categories: string[]; content: string }) => {
    const response = await chat.call("POST", "/memory", { user, body: input });
    return ((await response.json()) as { note: { id: string; version: number } }).note;
  };
  return { ...fake, ...chat, create };
}

describe("адреса /memory: чтение и счётчики", () => {
  it("GET /memory — записи человека и счётчики total, limit, shown", async () => {
    const { call, create } = memoryChat({ limit: 5, shown: 1 });
    await create("anna", note("Пишет на TypeScript"));
    await create("anna", note("Живёт на Бали", ["О себе", "Место"]));

    const response = await call("GET", "/memory");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      notes: [
        expect.objectContaining({ content: "Пишет на TypeScript", categories: ["О себе"], version: 1 }),
        expect.objectContaining({ content: "Живёт на Бали", categories: ["О себе", "Место"], version: 1 }),
      ],
      counts: { total: 2, limit: 5, shown: 1 },
    });
  });

  it("пустая память — пустой список и нули в счётчике", async () => {
    const { call } = memoryChat();
    const response = await call("GET", "/memory");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notes: [], counts: { total: 0, limit: 3, shown: 0 } });
  });

  it("без входа — 401, в память не ходили", async () => {
    const { call, memory } = memoryChat();
    expect((await call("GET", "/memory", { user: null })).status).toBe(401);
    expect(memory.list).not.toHaveBeenCalled();
  });

  it("память человека определяется resolveUser: Борис не видит записей Анны", async () => {
    const { call, create } = memoryChat();
    await create("anna", note("Секрет Анны"));
    const borisView = await (await call("GET", "/memory", { user: "boris" })).text();
    expect(JSON.parse(borisView)).toEqual({ notes: [], counts: { total: 0, limit: 3, shown: 0 } });
    expect(borisView).not.toContain("Секрет Анны");
  });
});

describe("адреса /memory: создание, правка, удаление", () => {
  it("POST /memory — 201 и запись; PATCH — новая версия; DELETE?version — 204", async () => {
    const { call, memory } = memoryChat();
    const created = await call("POST", "/memory", { body: note("Пишет на TypeScript") });
    expect(created.status).toBe(201);
    const { note: first } = (await created.json()) as { note: { id: string; version: number } };
    expect(first).toMatchObject({ categories: ["О себе"], content: "Пишет на TypeScript", version: 1 });
    expect(memory.create).toHaveBeenCalledWith("anna", note("Пишет на TypeScript"));

    const patched = await call("PATCH", `/memory/${first.id}`, { body: { ...note("Пишет на Rust", ["Работа"]), version: 1 } });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toEqual({ note: expect.objectContaining({ id: first.id, content: "Пишет на Rust", categories: ["Работа"], version: 2 }) });

    const removed = await call("DELETE", `/memory/${first.id}?version=2`);
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe("");
    expect(await (await call("GET", "/memory")).json()).toMatchObject({ notes: [] });
  });

  it("DELETE /memory — стирает всю память человека, 200 { deleted: N }; чужую не трогает", async () => {
    const { call, create } = memoryChat({ limit: 5 });
    await create("anna", note("Раз"));
    await create("anna", note("Два"));
    await create("boris", note("Запись Бориса"));

    const cleared = await call("DELETE", "/memory");
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ deleted: 2 });
    expect(await (await call("GET", "/memory")).json()).toMatchObject({ notes: [], counts: { total: 0 } });
    expect(await (await call("GET", "/memory", { user: "boris" })).json()).toMatchObject({ counts: { total: 1 } });
  });

  it("стирание пустой памяти — 200 { deleted: 0 }", async () => {
    const { call } = memoryChat();
    const cleared = await call("DELETE", "/memory");
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ deleted: 0 });
  });

  it("лишние поля в теле (id, version, ownerId) при создании не доходят до памяти", async () => {
    const { call, memory } = memoryChat();
    await call("POST", "/memory", { body: { ...note("Текст"), id: "мой-id", version: 9, ownerId: "boris" } });
    expect(memory.create).toHaveBeenCalledWith("anna", note("Текст"));
  });

  it("при правке в память доходят только разделы и текст; версия — отдельно", async () => {
    const { call, memory, create } = memoryChat();
    const { id } = await create("anna", note("Старый текст"));
    await call("PATCH", `/memory/${id}`, { body: { ...note("Новый текст"), version: 1, ownerId: "boris", id: "чужой" } });
    expect(memory.update).toHaveBeenCalledWith("anna", id, 1, note("Новый текст"));
  });
});

describe("адреса /memory: в ответах нет служебных полей", () => {
  it("ни в одном ответе нет ownerId и служебного ключа хранилища", async () => {
    const { call, create } = memoryChat();
    const { id } = await create("anna", note("Текст"));
    const bodies = [
      await (await call("GET", "/memory")).text(),
      await (await call("POST", "/memory", { body: note("Другой") })).text(),
      await (await call("PATCH", `/memory/${id}`, { body: { ...note("Правка"), version: 1 } })).text(),
    ];
    for (const body of bodies) {
      expect(body).not.toContain("ownerId");
      expect(body).not.toContain("internalKey");
      expect(body).not.toContain("секрет-хранилища");
    }
    expect(Object.keys(JSON.parse(bodies[1]!).note).sort()).toEqual(["categories", "content", "createdAt", "id", "updatedAt", "version"]);
  });

  it("в ответе с ошибкой только { error: { kind } }, без подсказок для агента", async () => {
    const { call } = memoryChat();
    const response = await call("PATCH", "/memory/нет-такой", { body: { ...note("Текст"), version: 1 } });
    expect(await response.json()).toEqual({ error: { kind: "not_found" } });
  });
});

describe("адреса /memory: чужая запись и отсутствие памяти", () => {
  it("правка и удаление чужой записи — 404 not_found, запись Анны цела", async () => {
    const { call, create } = memoryChat();
    const { id } = await create("anna", note("Секрет Анны"));

    const patched = await call("PATCH", `/memory/${id}`, { user: "boris", body: { ...note("Взломано"), version: 1 } });
    expect(patched.status).toBe(404);
    expect(await patched.json()).toEqual({ error: { kind: "not_found" } });
    const removed = await call("DELETE", `/memory/${id}?version=1`, { user: "boris" });
    expect(removed.status).toBe(404);
    expect(await removed.json()).toEqual({ error: { kind: "not_found" } });

    expect(await (await call("GET", "/memory")).json()).toMatchObject({ notes: [{ id, content: "Секрет Анны", version: 1 }] });
  });

  it("чужая запись неотличима от несуществующей", async () => {
    const { call, create } = memoryChat();
    const { id } = await create("anna", note("Секрет Анны"));
    const foreign = await call("PATCH", `/memory/${id}`, { user: "boris", body: { ...note("Текст"), version: 1 } });
    const missing = await call("PATCH", "/memory/нет-такой", { user: "boris", body: { ...note("Текст"), version: 1 } });
    expect(foreign.status).toBe(missing.status);
    expect(await foreign.text()).toBe(await missing.text());
  });

  it("без memory в опциях все адреса /memory — 404 not_found, в том числе при включённом списке чатов", async () => {
    for (const chatList of [false, true]) {
      const { call } = createTestChat({ chatList });
      for (const [method, path, body] of [
        ["GET", "/memory", undefined],
        ["POST", "/memory", note("Текст")],
        ["PATCH", "/memory/n1", { ...note("Текст"), version: 1 }],
        ["DELETE", "/memory/n1?version=1", undefined],
        ["DELETE", "/memory", undefined],
      ] as const) {
        const response = await call(method, path, { body });
        expect({ method, path, chatList, status: response.status }).toEqual({ method, path, chatList, status: 404 });
        expect(await response.json()).toEqual({ error: { kind: "not_found" } });
      }
    }
  });

  it("лишние сегменты пути и неизвестные методы — 404", async () => {
    const { call } = memoryChat();
    expect((await call("GET", "/memory/n1")).status).toBe(404);
    expect((await call("PUT", "/memory")).status).toBe(404);
    expect((await call("POST", "/memory/n1")).status).toBe(404);
    expect((await call("PATCH", "/memory")).status).toBe(404);
    expect((await call("GET", "/memory/n1/x")).status).toBe(404);
  });
});

describe("адреса /memory: ошибки", () => {
  it("конфликт версий при правке и при удалении — 409 stale_version; запись не изменена", async () => {
    const { call, create } = memoryChat();
    const { id } = await create("anna", note("Исходный текст"));
    await call("PATCH", `/memory/${id}`, { body: { ...note("Правка из другой вкладки"), version: 1 } });

    const patched = await call("PATCH", `/memory/${id}`, { body: { ...note("Моя правка"), version: 1 } });
    expect(patched.status).toBe(409);
    expect(await patched.json()).toEqual({ error: { kind: "stale_version" } });
    const removed = await call("DELETE", `/memory/${id}?version=1`);
    expect(removed.status).toBe(409);
    expect(await removed.json()).toEqual({ error: { kind: "stale_version" } });

    expect(await (await call("GET", "/memory")).json()).toMatchObject({ notes: [{ id, content: "Правка из другой вкладки", version: 2 }] });
  });

  it("предел записей — 409 limit_reached", async () => {
    const { call, create } = memoryChat({ limit: 2 });
    await create("anna", note("Раз"));
    await create("anna", note("Два"));
    const response = await call("POST", "/memory", { body: note("Три") });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { kind: "limit_reached" } });
    expect(await (await call("GET", "/memory")).json()).toMatchObject({ counts: { total: 2 } });
  });

  it("дубль при создании и при правке — 409 duplicate", async () => {
    const { call, create } = memoryChat();
    await create("anna", note("Пишет на TypeScript"));
    const other = await create("anna", note("Живёт на Бали"));

    const created = await call("POST", "/memory", { body: note("Пишет на TypeScript") });
    expect(created.status).toBe(409);
    expect(await created.json()).toEqual({ error: { kind: "duplicate" } });
    const patched = await call("PATCH", `/memory/${other.id}`, { body: { ...note("Пишет на TypeScript"), version: 1 } });
    expect(patched.status).toBe(409);
    expect(await patched.json()).toEqual({ error: { kind: "duplicate" } });
  });

  it("неверная форма — 400 invalid: пустой текст, нет разделов, тело не объект, битый JSON", async () => {
    const { call, memory } = memoryChat();
    for (const body of [note(""), { categories: [], content: "Текст" }, { content: "Текст" }, null, "строка", [1]]) {
      const response = await call("POST", "/memory", { body });
      expect({ body, status: response.status }).toEqual({ body, status: 400 });
      expect(await response.json()).toEqual({ error: { kind: "invalid" } });
    }
    const broken = await memory.list("anna");
    expect(broken.counts.total).toBe(0);

    const raw = await createTestChat({ memory: fakeMemory().memory }).handler.fetch(
      new Request("http://test.local/api/chat/memory", { method: "POST", headers: { "x-user": "anna", "content-type": "application/json" }, body: "{не json" }),
    );
    expect(raw.status).toBe(400);
    expect(await raw.json()).toEqual({ error: { kind: "invalid" } });
  });

  it("правка: неверная форма — 400; версия не число, не целая или не задана — 400; в память не ходили", async () => {
    const { call, memory, create } = memoryChat();
    const { id } = await create("anna", note("Текст"));
    for (const body of [
      { ...note(""), version: 1 },
      note("Новый текст"),
      { ...note("Новый текст"), version: "1" },
      { ...note("Новый текст"), version: 1.5 },
      { ...note("Новый текст"), version: 0 },
      null,
    ]) {
      const response = await call("PATCH", `/memory/${id}`, { body });
      expect({ body, status: response.status }).toEqual({ body, status: 400 });
      expect(await response.json()).toEqual({ error: { kind: "invalid" } });
    }
    expect(memory.update).not.toHaveBeenCalledWith("anna", id, expect.anything(), expect.objectContaining({ content: "Новый текст" }));
  });

  it("удаление: версия не задана, не число или не целая — 400 invalid", async () => {
    const { call, memory, create } = memoryChat();
    const { id } = await create("anna", note("Текст"));
    for (const query of ["", "?version=", "?version=abc", "?version=1.5", "?version=0", "?version=-1"]) {
      const response = await call("DELETE", `/memory/${id}${query}`);
      expect({ query, status: response.status }).toEqual({ query, status: 400 });
      expect(await response.json()).toEqual({ error: { kind: "invalid" } });
    }
    expect(memory.remove).not.toHaveBeenCalled();
  });

  it("сбой хранилища — 500 other и запись в журнал, без подробностей в ответе", async () => {
    const { memory } = fakeMemory();
    const failing: ChatMemory = { ...memory, list: vi.fn(async () => { throw new Error("база: пароль=hunter2"); }) };
    const logError = vi.fn();
    const { call } = createTestChat({ memory: failing, logError });
    const response = await call("GET", "/memory");
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: { kind: "other" } });
    expect(body).not.toContain("hunter2");
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

describe("options.memory: передача ядру", () => {
  it("память попадает в ядро: на ходе спрашивается блок памяти этого человека и чата", async () => {
    const { memory } = fakeMemory();
    const { call, createChat } = createTestChat({ memory });
    const chatId = await createChat();
    const answer = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect(answer.status).toBe(200);
    await answer.text();
    expect(memory.snapshot).toHaveBeenCalledWith({ userId: "anna", chatId });
  });
});
