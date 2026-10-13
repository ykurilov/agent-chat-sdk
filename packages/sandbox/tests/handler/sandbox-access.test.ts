import { describe, expect, it, vi } from "vitest";
import { setupSandbox } from "./support/sandbox-setup";

/** Все адреса песочницы: чат, журнал, настройки, правка, память. `{chat}`, `{message}` подставляются. */
const addresses: Array<[string, string, unknown?]> = [
  ["GET", ""],
  ["POST", "", {}],
  ["GET", "/models"],
  ["GET", "/{chat}"],
  ["PATCH", "/{chat}", { title: "x" }],
  ["DELETE", "/{chat}"],
  ["POST", "/{chat}/messages", { message: { id: "m1", role: "user", parts: [{ type: "text", text: "привет" }] } }],
  ["POST", "/{chat}/stop"],
  ["GET", "/{chat}/compactions"],
  ["GET", "/chats/{chat}/journal"],
  ["GET", "/journal/calls/{call}"],
  ["GET", "/journal/blobs/{hash}"],
  ["GET", "/chats/{chat}/settings"],
  ["PUT", "/chats/{chat}/settings", { instructions: "x" }],
  ["POST", "/chats/{chat}/messages/{message}/answer-edit", { text: "x" }],
  ["POST", "/chats/{chat}/reopen"],
  ["GET", "/memory"],
  ["POST", "/memory", { categories: ["О себе"], content: "x" }],
  ["DELETE", "/memory"],
];

/** Песочный чат Анны с одним ходом: id чата, ответа, записи журнала и куска. */
async function annasChat(setup: ReturnType<typeof setupSandbox>) {
  const chatId = await setup.createChat("anna");
  await setup.send(chatId);
  const history = (await (await setup.call("GET", `/${chatId}`)).json()) as { messages: Array<{ id: string; role: string }> };
  const message = history.messages.find((item) => item.role === "assistant")!.id;
  const [entry] = await setup.journal.listForChat(chatId);
  const details = await setup.journal.getCall(entry!.id);
  const hash = details!.kind === "model" ? details!.instructions.hash : "";
  return { chat: chatId, message, call: entry!.id, hash };
}

const fill = (path: string, ids: Record<string, string>) => path.replace(/\{(\w+)\}/g, (_, key: string) => ids[key]!);

describe("песочница: доступ только админу (T031)", () => {
  it("не-админ и человек без входа получают 404 на каждом адресе; тело не упоминает песочницу", async () => {
    const setup = setupSandbox();
    const ids = await annasChat(setup);
    for (const user of ["vera", null]) {
      for (const [method, path, body] of addresses) {
        const response = await setup.call(method, fill(path, ids), { user, body, origin: "http://test.local" });
        const text = await response.text();
        expect(response.status, `${user} ${method} ${path}`).toBe(404);
        expect(text.toLowerCase(), `${method} ${path}`).not.toMatch(/sandbox|песочн/);
      }
    }
  });

  it("isAdmin зовётся на каждом запросе: разжалованный админ получает 404 следующим же запросом", async () => {
    const setup = setupSandbox();
    const chatId = await setup.createChat("anna");
    const before = setup.isAdminCalls.length;
    expect((await setup.call("GET", `/${chatId}`)).status).toBe(200);
    expect(setup.isAdminCalls.length).toBe(before + 1);
    setup.admins.delete("anna");
    expect((await setup.call("GET", `/${chatId}`)).status).toBe(404);
    expect((await setup.call("GET", `/chats/${chatId}/settings`)).status).toBe(404);
  });

  it("resolveUser приложения зовётся один раз на запрос", async () => {
    const setup = setupSandbox();
    const chatId = await setup.createChat("anna");
    const before = setup.resolveUserCalls.length;
    await setup.call("GET", `/${chatId}`);
    expect(setup.resolveUserCalls.length).toBe(before + 1);
  });

  it("запрос, меняющий данные, с чужой страницы → 403 как у чата", async () => {
    const setup = setupSandbox({ chat: { allowedOrigins: ["http://test.local"] } });
    const response = await setup.call("POST", "", { body: {}, origin: "http://evil.example" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { kind: "forbidden_origin" } });
  });

  it("resolveUser приложения отказал в доступе → 404 на каждом адресе, слов приложения нет; isAdmin не зовётся", async () => {
    const setup = setupSandbox({
      chat: { resolveUser: async () => ({ refused: { code: "no_course", message: "Нужен доступ к курсу", status: 401 as const } }) },
    });
    for (const [method, path, body] of addresses) {
      const response = await setup.call(method, path.replace(/\{(\w+)\}/g, "x"), { body, origin: "http://test.local" });
      const text = await response.text();
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(text, `${method} ${path}`).not.toMatch(/no_course|access_refused|курс|sandbox|песочн/i);
    }
    expect(setup.isAdminCalls).toEqual([]);
  });

  it("проверка перед ходом приложения (beforeTurn) на песочные чаты не переходит: ход админа идёт, хук не зовётся", async () => {
    const beforeTurn = vi.fn(() => ({ code: "lesson_closed", message: "Урок закрыт" }));
    const setup = setupSandbox({ chat: { beforeTurn } });
    const chatId = await setup.createChat("anna");
    await setup.send(chatId);
    const history = (await (await setup.call("GET", `/${chatId}`)).json()) as { messages: Array<{ role: string }> };
    expect(history.messages.map((item) => item.role)).toEqual(["user", "assistant"]);
    expect(beforeTurn).not.toHaveBeenCalled();
  });

  it("адрес вне basePath песочницы → 404", async () => {
    const setup = setupSandbox();
    const response = await setup.sandbox.fetch(new Request("http://test.local/api/other", { headers: { "x-user": "anna" } }));
    expect(response.status).toBe(404);
  });

  it("боевой обработчик не открывает песочный чат и не показывает его в списке", async () => {
    const setup = setupSandbox();
    const { chat } = await annasChat(setup);
    expect((await setup.callBattle("GET", `/${chat}`)).status).toBe(404);
    expect((await setup.callBattle("DELETE", `/${chat}`)).status).toBe(404);
    const list = (await (await setup.callBattle("GET", "")).json()) as { chats: Array<{ id: string }> };
    expect(list.chats.map((item) => item.id)).not.toContain(chat);
  });
});

describe("песочница: личные чаты админов (T033)", () => {
  it("второй админ не видит чат первого в списке и не открывает его, журнал, настройки и правку", async () => {
    const setup = setupSandbox();
    const ids = await annasChat(setup);
    const list = (await (await setup.call("GET", "", { user: "boris" })).json()) as { chats: Array<{ id: string }> };
    expect(list.chats).toEqual([]);
    const own = (await (await setup.call("GET", "", { user: "anna" })).json()) as { chats: Array<{ id: string }> };
    expect(own.chats.map((item) => item.id)).toEqual([ids.chat]);

    const foreign: Array<[string, string, unknown?]> = [
      ["GET", "/{chat}"],
      ["PATCH", "/{chat}", { title: "x" }],
      ["POST", "/{chat}/messages", { message: { id: "m2", role: "user", parts: [{ type: "text", text: "привет" }] } }],
      ["GET", "/chats/{chat}/journal"],
      ["GET", "/journal/calls/{call}"],
      ["GET", "/journal/blobs/{hash}"],
      ["GET", "/chats/{chat}/settings"],
      ["PUT", "/chats/{chat}/settings", { instructions: "чужая" }],
      ["POST", "/chats/{chat}/messages/{message}/answer-edit", { text: "чужая правка" }],
      ["DELETE", "/{chat}"],
    ];
    for (const [method, path, body] of foreign) {
      const response = await setup.call(method, fill(path, ids), { user: "boris", body });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    // Чат Анны цел: ни правки, ни настроек от Бориса.
    expect((await setup.call("GET", `/${ids.chat}`)).status).toBe(200);
    expect(await setup.journal.getSettings(ids.chat)).toBeNull();
    expect(await setup.journal.listEditedAnswers(ids.chat)).toEqual([]);
  });

  it("Борис видит запись журнала и кусок своего чата, а не Анниного", async () => {
    const setup = setupSandbox();
    const annas = await annasChat(setup);
    const borisChat = await setup.createChat("boris");
    await setup.send(borisChat, "привет", "boris");
    const [entry] = await setup.journal.listForChat(borisChat);
    expect((await setup.call("GET", `/journal/calls/${entry!.id}`, { user: "boris" })).status).toBe(200);
    expect((await setup.call("GET", `/journal/calls/${annas.call}`, { user: "boris" })).status).toBe(404);
  });
});

describe("песочница: права приложения (chatCapabilities)", () => {
  it("права приложения на песочные чаты не переходят: правка у админа есть, функция не зовётся", async () => {
    const chatCapabilities = vi.fn(() => ({ edit: false, regenerate: false }));
    const setup = setupSandbox({ chat: { chatCapabilities } });
    const chatId = await setup.createChat("anna");
    await setup.send(chatId);
    const history = (await (await setup.call("GET", `/${chatId}`)).json()) as { capabilities: { edit: boolean; regenerate: boolean } };
    expect(history.capabilities).toMatchObject({ edit: true, regenerate: true });
    expect(chatCapabilities).not.toHaveBeenCalled();
  });
});
