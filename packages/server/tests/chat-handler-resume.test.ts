import { describe, expect, it } from "vitest";
import { createGate } from "./support/mock-catalog";
import { parseSse, readAll, readUntil } from "./support/sse";
import { createTestChat as setup, message, seedUnfinishedAnswer } from "./support/test-chat";

const textOf = (chunks: Array<Record<string, unknown>>) =>
  chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.delta as string).join("");

describe("обработчик чата: подключение к идущему ответу", () => {
  it("GET stream без хода — 204", async () => {
    const { call, createChat } = setup();
    const chatId = await createChat();
    const response = await call("GET", `/${chatId}/stream`);
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("GET stream во время хода — 200 SSE: все куски с начала хода, дальше живые", async () => {
    const gate = createGate();
    const { call, createChat } = setup({ gate: gate.wait });
    const chatId = await createChat();
    const first = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    const firstReader = first.body!.getReader();
    const firstSeen = await readUntil(firstReader, "При");

    const resumed = await call("GET", `/${chatId}/stream`);
    expect(resumed.status).toBe(200);
    const resumedReader = resumed.body!.getReader();
    const resumedSeen = await readUntil(resumedReader, "При");
    // Начало хода уже в потоке: start с тем же messageId, что у первого подписчика.
    const start = parseSse(resumedSeen)[0];
    expect(start).toMatchObject({ type: "start", messageId: expect.any(String) });
    expect(start?.messageId).toBe(parseSse(firstSeen)[0]?.messageId);

    gate.open();
    const resumedChunks = await readAll(resumedReader, resumedSeen);
    const firstChunks = await readAll(firstReader, firstSeen);
    expect(textOf(resumedChunks)).toBe("Привет!");
    expect(resumedChunks).toEqual(firstChunks);
    expect(resumedChunks.at(-1)).toMatchObject({ type: "finish" });
  });

  it("история во время хода + повтор потока не дают двойного текста", async () => {
    const gate = createGate();
    const { call, createChat } = setup({ gate: gate.wait });
    const chatId = await createChat();
    const first = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    const firstReader = first.body!.getReader();
    await readUntil(firstReader, "При");

    const history = (await (await call("GET", `/${chatId}`)).json()) as {
      running: boolean;
      messages: Array<{ id: string; role: string }>;
    };
    expect(history.running).toBe(true);
    expect(history.messages.map((item) => item.role)).toEqual(["user"]);

    const resumed = await call("GET", `/${chatId}/stream`);
    const resumedReader = resumed.body!.getReader();
    gate.open();
    const chunks = await readAll(resumedReader);
    await readAll(firstReader);
    // Ответ целиком приходит из потока и ровно один раз.
    expect(textOf(chunks)).toBe("Привет!");
    expect(chunks.filter((chunk) => chunk.type === "start")).toHaveLength(1);
    expect(history.messages.some((item) => item.id === chunks[0]?.messageId)).toBe(false);
  });

  it("обрыв повторного потока не останавливает ход", async () => {
    const gate = createGate();
    const { call, createChat, storage } = setup({ gate: gate.wait });
    const chatId = await createChat();
    const first = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    await first.body!.cancel();
    const resumed = await call("GET", `/${chatId}/stream`);
    const reader = resumed.body!.getReader();
    await readUntil(reader, "При");
    await reader.cancel();

    gate.open();
    await expect
      .poll(async () => (await storage.listMessages(chatId)).find((item) => item.role === "assistant")?.status)
      .toBe("complete");
  });

  it("POST stop от второго подписчика останавливает ход для обоих", async () => {
    const gate = createGate();
    const { call, createChat, storage } = setup({ gate: gate.wait });
    const chatId = await createChat();
    const first = await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") });
    const firstReader = first.body!.getReader();
    const firstSeen = await readUntil(firstReader, "При");
    const second = await call("GET", `/${chatId}/stream`);
    const secondReader = second.body!.getReader();
    const secondSeen = await readUntil(secondReader, "При");

    expect((await call("POST", `/${chatId}/stop`)).status).toBe(202);
    const [firstChunks, secondChunks] = await Promise.all([
      readAll(firstReader, firstSeen),
      readAll(secondReader, secondSeen),
    ]);
    for (const chunks of [firstChunks, secondChunks]) {
      expect(chunks).toContainEqual(
        expect.objectContaining({ type: "message-metadata", messageMetadata: expect.objectContaining({ status: "stopped" }) }),
      );
      expect(chunks.at(-1)).toMatchObject({ type: "abort" });
      expect(textOf(chunks)).toBe("При");
    }
    const answer = (await storage.listMessages(chatId)).find((item) => item.role === "assistant");
    expect(answer?.status).toBe("stopped");
    expect((await call("GET", `/${chatId}/stream`)).status).toBe(204);
  });
});

describe("обработчик чата: восстановление после перезапуска", () => {
  it("recoverInterruptedAnswers помечает оборванные ответы interrupted и возвращает их число", async () => {
    const { handler, storage, call, createChat } = setup();
    const chatId = await createChat();
    await seedUnfinishedAnswer(storage, chatId);

    expect(await handler.recoverInterruptedAnswers()).toBe(1);
    const history = (await (await call("GET", `/${chatId}`)).json()) as {
      messages: Array<{ id: string; parts: unknown[]; metadata?: { status?: string } }>;
    };
    const answer = history.messages.find((item) => item.id === "a1");
    expect(answer?.metadata?.status).toBe("interrupted");
    expect(answer?.parts).toEqual([{ type: "text", text: "Начало ответа", state: "streaming" }]);
    expect(await handler.recoverInterruptedAnswers()).toBe(0);
  });
});
