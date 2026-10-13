import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createGate, mockModelId } from "./support/mock-catalog";
import { parseSse, readAll, readUntil } from "./support/sse";
import { createTestChat as setup, message } from "./support/test-chat";

describe("обработчик чата", () => {
  it("resolveUser вернул null — 401", async () => {
    const { call } = setup();
    expect((await call("POST", "", { user: null })).status).toBe(401);
    expect((await call("GET", "/любой", { user: null })).status).toBe(401);
  });

  it("битая кодировка в адресе — 404 not_found, а не брошенное исключение", async () => {
    const { call } = setup();
    const response = await call("GET", "/%E0");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { kind: "not_found" } });
  });

  it("POST {base} — 201 { id }", async () => {
    const { call } = setup();
    const response = await call("POST", "");
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: expect.any(String) });
  });

  it("POST messages — SSE: первый кусок start с messageId и моделью; GET — история без идущего ответа", async () => {
    const gate = createGate();
    const { call, createChat } = setup({ gate: gate.wait });
    const chatId = await createChat();

    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await readUntil(reader, "При");

    const during = await call("GET", `/${chatId}`);
    expect(during.status).toBe(200);
    const history = (await during.json()) as { chat: { id: string }; messages: Array<{ id: string }>; running: boolean };
    expect(history.chat.id).toBe(chatId);
    expect(history.running).toBe(true);
    expect(history.messages.map((item) => item.id)).toEqual(["u1"]);

    gate.open();
    expect((await readAll(reader)).at(-1)).toMatchObject({ type: "finish" });

    const after = (await (await call("GET", `/${chatId}`)).json()) as {
      running: boolean;
      messages: Array<{ role: string; metadata?: { status?: string } }>;
    };
    expect(after.running).toBe(false);
    expect(after.messages.map((item) => item.role)).toEqual(["user", "assistant"]);
    expect(after.messages[1]?.metadata?.status).toBe("complete");
  });

  it("первый кусок потока — start с messageId и metadata модели", async () => {
    const { call, createChat } = setup();
    const chatId = await createChat();
    const chunks = parseSse(await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text());
    expect(chunks[0]).toMatchObject({
      type: "start",
      messageId: expect.any(String),
      messageMetadata: { modelId: mockModelId, providerId: "mock" },
    });
  });

  it("нет ключа провайдера — ошибка invalid_key в потоке, а в журнале сервера имя переменной", async () => {
    const logged: string[] = [];
    const { call, createChat } = setup({ env: { SOME_OTHER_KEY: "чужое-значение" }, logError: (text) => logged.push(text) });
    const chatId = await createChat();

    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });

    expect(response.status).toBe(200);
    const chunks = parseSse(await response.text());
    expect(chunks[0]).toMatchObject({ type: "start", messageId: expect.any(String) });
    expect(chunks.filter((chunk) => chunk.type === "error")).toEqual([{ type: "error", errorText: "invalid_key" }]);
    const history = (await (await call("GET", `/${chatId}`)).json()) as {
      messages: Array<{ role: string; metadata?: { status?: string; error?: { kind: string } } }>;
    };
    expect(history.messages.at(-1)?.metadata).toMatchObject({ status: "error", error: { kind: "invalid_key" } });
    expect(logged.join("\n")).toContain("MOCK_API_KEY");
    expect(logged.join("\n")).not.toContain("чужое-значение");
  });

  it("непредвиденный сбой — 500 other, и сбой записан в журнал сервера", async () => {
    const logged: string[] = [];
    const storage = createInMemoryChatStorage();
    const { call } = setup({
      storage: {
        ...storage,
        createChat: async () => {
          throw new Error("база недоступна");
        },
      },
      logError: (text) => logged.push(text),
    });

    const response = await call("POST", "");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { kind: "other" } });
    expect(logged.join("\n")).toContain("база недоступна");
  });

  it("пустой текст — 400 invalid", async () => {
    const { call, createChat } = setup();
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "   ") });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { kind: "invalid" } });
  });

  it("вторая отправка и повтор того же id во время хода — 409 busy; повтор id после хода — 409 invalid", async () => {
    const gate = createGate();
    const { call, createChat } = setup({ gate: gate.wait });
    const chatId = await createChat();
    const first = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });

    const second = await call("POST", `/${chatId}/messages`, { body: message("u2", "Ещё") });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: { kind: "busy" } });
    const repeated = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect(repeated.status).toBe(409);
    expect(await repeated.json()).toEqual({ error: { kind: "busy" } });

    gate.open();
    await first.text();
    const afterTurn = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    expect(afterTurn.status).toBe(409);
    expect(await afterTurn.json()).toEqual({ error: { kind: "invalid" } });
  });

  it("POST stop — 202 во время хода, ответ становится stopped; без хода — 204", async () => {
    const gate = createGate();
    const { call, createChat, storage } = setup({ gate: gate.wait });
    const chatId = await createChat();
    expect((await call("POST", `/${chatId}/stop`)).status).toBe(204);

    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    const reader = response.body!.getReader();
    await readUntil(reader, "При");
    expect((await call("POST", `/${chatId}/stop`)).status).toBe(202);
    await readAll(reader);
    const answer = (await storage.listMessages(chatId)).find((item) => item.role === "assistant");
    expect(answer?.status).toBe("stopped");
  });

  it("flush без срока дописывает идущий ответ и закрывает его как «Стоп», не дожидаясь конца хода", async () => {
    const gate = createGate();
    const { call, createChat, handler, storage } = setup({ gate: gate.wait });
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    const reader = response.body!.getReader();
    await readUntil(reader, "При");

    await handler.flush();

    const answer = (await storage.listMessages(chatId)).find((item) => item.role === "assistant");
    expect(answer?.status).toBe("stopped");
    expect(answer?.parts.find((part) => part.type === "text")).toMatchObject({ text: "При" });
    gate.open();
    await readAll(reader);
  });

  it("обрыв соединения клиента не останавливает ход", async () => {
    const gate = createGate();
    const { call, createChat, storage } = setup({ gate: gate.wait });
    const chatId = await createChat();
    const connection = new AbortController();
    const response = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет"), signal: connection.signal });
    const reader = response.body!.getReader();
    await readUntil(reader, "При");
    connection.abort();
    await reader.cancel();

    gate.open();
    await expect
      .poll(async () => (await storage.listMessages(chatId)).find((item) => item.role === "assistant")?.status)
      .toBe("complete");
    const answer = (await storage.listMessages(chatId)).find((item) => item.role === "assistant");
    expect(answer?.parts.find((part) => part.type === "text")).toMatchObject({ text: "Привет!" });
  });
});

