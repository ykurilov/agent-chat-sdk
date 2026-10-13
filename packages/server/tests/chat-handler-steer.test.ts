import { describe, expect, it } from "vitest";
import { createGate } from "./support/mock-catalog";
import { readAll, readUntil } from "./support/sse";
import { createTestChat as setup, message } from "./support/test-chat";

const steer = (id: string, text: string) => ({ message: { id, role: "user", parts: [{ type: "text", text }] } });

describe("обработчик чата: поправка на лету", () => {
  it("POST steer во время ответа — 202 queued; поправка ждёт в pendingMessages, потом новый ход отвечает на неё", async () => {
    const gate = createGate();
    const { call, createChat } = setup({ gate: gate.wait });
    const chatId = await createChat();
    const first = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    const firstReader = first.body!.getReader();
    const seen = await readUntil(firstReader, "При");

    const accepted = await call("POST", `/${chatId}/steer`, { body: steer("s1", "И покороче") });
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({ status: "queued", messageId: "s1" });

    const during = (await (await call("GET", `/${chatId}`)).json()) as {
      messages: Array<{ id: string }>;
      pendingMessages?: Array<{ id: string }>;
    };
    expect(during.pendingMessages?.map((item) => item.id)).toEqual(["s1"]);
    expect(during.messages.map((item) => item.id)).not.toContain("s1");

    gate.open();
    await readAll(firstReader, seen);
    const next = await call("GET", `/${chatId}/stream`);
    expect(next.status).toBe(200);
    await readAll(next.body!.getReader());

    const after = (await (await call("GET", `/${chatId}`)).json()) as {
      running: boolean;
      messages: Array<{ id: string; role: string }>;
      pendingMessages?: unknown;
    };
    expect(after.running).toBe(false);
    expect(after.pendingMessages).toBeUndefined();
    expect(after.messages.map((item) => item.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(after.messages[2]?.id).toBe("s1");
  });

  it("POST steer без идущего хода — 202 started: поправка начинает обычный ход", async () => {
    const { call, createChat } = setup();
    const chatId = await createChat();
    const response = await call("POST", `/${chatId}/steer`, { body: steer("s1", "Привет") });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "started", messageId: "s1" });
    const stream = await call("GET", `/${chatId}/stream`);
    if (stream.status === 200) await readAll(stream.body!.getReader());
  });

  it("неверное тело — 400 invalid; чужой чат — 404", async () => {
    const { call, createChat } = setup();
    const chatId = await createChat();
    expect((await call("POST", `/${chatId}/steer`, { body: {} })).status).toBe(400);
    expect((await call("POST", `/${chatId}/steer`, { body: { ...steer("s1", "x"), tabId: { bad: true } } })).status).toBe(400);
    expect((await call("POST", `/${chatId}/steer`, { body: steer("s2", "x"), user: "boris" })).status).toBe(404);
  });
});
