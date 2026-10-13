import { describe, expect, it } from "vitest";
import { createGate } from "./support/mock-catalog";
import { createTestChat, message } from "./support/test-chat";

const annaQuestion = "Секретный вопрос Анны";

/** Все адреса чата из contracts/http-api.md, кроме создания. */
const chatAddresses = (chatId: string) => [
  { method: "GET", path: `/${chatId}` },
  { method: "POST", path: `/${chatId}/messages`, body: message("boris-1", "Покажи чужой чат") },
  { method: "GET", path: `/${chatId}/stream` },
  { method: "GET", path: `/${chatId}/compactions` },
  { method: "POST", path: `/${chatId}/steer`, body: message("boris-2", "Поправлю чужой чат") },
  { method: "POST", path: `/${chatId}/stop` },
  { method: "POST", path: `/${chatId}/retry` },
];

describe("обработчик чата: чужой чат (FR-024, US5-2)", () => {
  it("пользователь Б на каждом адресе чата А во время ответа — 404 not_found без данных чата А; ответ А не тронут", async () => {
    const gate = createGate();
    const { storage, call, createChat, history } = createTestChat({ gate: gate.wait });
    const chatId = await createChat();
    const annaAnswer = await call("POST", `/${chatId}/messages`, { body: message("anna-1", annaQuestion) });
    expect(annaAnswer.status).toBe(200);

    for (const address of chatAddresses(chatId)) {
      const response = await call(address.method, address.path, { user: "boris", body: address.body });
      const body = await response.text();
      expect({ address: `${address.method} ${address.path}`, status: response.status }).toEqual({
        address: `${address.method} ${address.path}`,
        status: 404,
      });
      expect(JSON.parse(body)).toEqual({ error: { kind: "not_found" } });
      expect(body).not.toContain(chatId);
      expect(body).not.toContain(annaQuestion);
      expect(body).not.toContain("При");
    }

    // «Стоп» Бориса не остановил ответ Анны, его сообщение не попало в её чат.
    gate.open();
    expect(await annaAnswer.text()).toContain('"type":"finish"');
    const { messages } = await history(chatId);
    expect(messages.map((item) => item.id)).toEqual(["anna-1", messages[1]!.id]);
    expect(messages[1]).toMatchObject({ role: "assistant", metadata: { status: "complete" } });
    expect((await storage.listMessages(chatId)).map((stored) => stored.id)).not.toContain("boris-1");
  });

  it("чужой чат не отличить от несуществующего: тот же ответ на каждом адресе", async () => {
    const { call, createChat } = createTestChat();
    const chatId = await createChat();
    await (await call("POST", `/${chatId}/messages`, { body: message("anna-1", annaQuestion) })).text();

    const missingAddresses = chatAddresses("нет-такого");
    for (const [index, foreign] of chatAddresses(chatId).entries()) {
      const missing = missingAddresses[index]!;
      const foreignResponse = await call(foreign.method, foreign.path, { user: "boris", body: foreign.body });
      const missingResponse = await call(missing.method, missing.path, { user: "boris", body: missing.body });
      expect(foreignResponse.status).toBe(missingResponse.status);
      expect(await foreignResponse.text()).toBe(await missingResponse.text());
    }
  });
});
