import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createSecretHider } from "../../src/journal/hide-secrets";
import { BLOB_LIMIT_BYTES, describeSize, prepareBlob, splitModelCall, splitToolCall, unpackBlob } from "../../src/journal/journal-blobs";
import { modelCallEvent, textMessage, toolCallEvent } from "./support/events";

const hider = createSecretHider({ env: {} }).forSettings({});

describe("куски журнала: хеш, сжатие, обрезка", () => {
  it("одинаковое содержимое даёт один хеш, разное — разные", async () => {
    const a = await prepareBlob({ x: 1, text: "привет" }, hider);
    const b = await prepareBlob({ x: 1, text: "привет" }, hider);
    const c = await prepareBlob({ x: 2, text: "привет" }, hider);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("содержимое хранится сжатым и читается обратно", async () => {
    const value = { text: "повтор ".repeat(2000) };
    const row = await prepareBlob(value, hider);
    expect(row.data.byteLength).toBeLessThan(row.bytes / 5);
    expect(JSON.parse(gunzipSync(row.data).toString("utf8"))).toEqual(value);
    expect(await unpackBlob(row)).toEqual({ hash: row.hash, content: value, bytes: row.bytes, truncated: false });
  });

  it("кусок больше 256 КБ обрезается с пометкой", async () => {
    const row = await prepareBlob({ text: "я".repeat(300_000) }, hider);
    expect(row.truncated).toBe(true);
    const blob = await unpackBlob(row);
    expect(blob.truncated).toBe(true);
    expect(typeof blob.content).toBe("string");
    expect(Buffer.byteLength(blob.content as string)).toBeLessThan(BLOB_LIMIT_BYTES + 200);
    expect(blob.content as string).toContain("обрезано");
    // Размер — полного куска, хеш — от полного содержимого: одинаковые длинные куски по-прежнему сливаются.
    expect(blob.bytes).toBeGreaterThan(BLOB_LIMIT_BYTES);
    expect((await prepareBlob({ text: "я".repeat(300_000) }, hider)).hash).toBe(row.hash);
  });

  it("короткий кусок не помечается обрезанным", async () => {
    expect((await prepareBlob("коротко", hider)).truncated).toBe(false);
  });

  it("двоичные данные заменяются описанием", async () => {
    const image = new Uint8Array(1_300_000);
    const blob = await unpackBlob(
      await prepareBlob(
        {
          role: "user",
          content: [
            { type: "file", mediaType: "image/png", data: image },
            { type: "file", mediaType: "image/jpeg", data: Buffer.from(image).toString("base64") },
            { type: "text", text: "data:image/png;base64," + Buffer.from(new Uint8Array(2048)).toString("base64") },
            { type: "file", mediaType: "application/pdf", data: new Uint8Array(500) },
          ],
        },
        hider,
      ),
    );
    const parts = (blob.content as { content: Array<{ data?: string; text?: string }> }).content;
    expect(parts[0]?.data).toBe("картинка, image/png, 1,2 МБ");
    expect(parts[1]?.data).toBe("картинка, image/jpeg, 1,2 МБ");
    expect(parts[2]?.text).toBe("картинка, image/png, 2 КБ");
    expect(parts[3]?.data).toBe("файл, application/pdf, 500 Б");
    expect(blob.bytes).toBeLessThan(1000);
  });

  it("описание размера: байты, килобайты, мегабайты с запятой", () => {
    expect(describeSize(500)).toBe("500 Б");
    expect(describeSize(2048)).toBe("2 КБ");
    expect(describeSize(1_300_000)).toBe("1,2 МБ");
  });

  it("циклы, bigint, даты и ошибки не ломают запись", async () => {
    const loop: Record<string, unknown> = { name: "петля" };
    loop.self = loop;
    const blob = await unpackBlob(await prepareBlob({ loop, big: 10n, at: new Date("2026-10-01T00:00:00.000Z"), failure: new Error("сбой") }, hider));
    const content = blob.content as Record<string, unknown>;
    expect(content.big).toBe("10");
    expect(content.at).toBe("2026-10-01T00:00:00.000Z");
    expect(JSON.stringify(content.failure)).toContain("сбой");
    expect((content.loop as Record<string, unknown>).self).toBe("[цикл]");
  });
});

describe("разбиение события на куски", () => {
  it("обращение: инструкция, каждое сообщение, инструменты, настройки и ответ — отдельные куски", async () => {
    const event = modelCallEvent({
      request: {
        instructions: "Инструкция",
        messages: [textMessage("user", "один"), textMessage("assistant", "два"), textMessage("user", "три")],
        tools: [{ name: "a", inputSchema: {} }],
        settings: { temperature: 0 },
      },
      response: { text: "ответ", reasoning: "думал", toolCalls: [{ toolCallId: "t1", toolName: "a", input: {} }], finishReason: "tool-calls" },
    });
    const { row, blobs } = await splitModelCall(event, hider);
    expect(row.messageHashes).toHaveLength(3);
    expect(new Set([row.instructionsHash, ...row.messageHashes, row.toolsHash, row.settingsHash, row.responseHash]).size).toBe(7);
    expect(blobs.map((blob) => blob.hash).sort()).toEqual([row.instructionsHash, ...row.messageHashes, row.toolsHash, row.settingsHash, row.responseHash].sort());
    expect(row.toolCallIds).toEqual(["t1"]);
    expect(row).toMatchObject({ id: event.callId, chatId: "chat-1", ownerId: "sandbox:admin-1", purpose: "answer", attempt: 1, costUsd: 0.001, status: "complete" });
  });

  it("то же сообщение в другом обращении — тот же хеш", async () => {
    const shared = textMessage("user", "общее");
    const first = await splitModelCall(modelCallEvent({ request: { ...modelCallEvent().request, messages: [shared] } }), hider);
    const second = await splitModelCall(modelCallEvent({ request: { ...modelCallEvent().request, messages: [shared, textMessage("assistant", "новое")] } }), hider);
    expect(second.row.messageHashes[0]).toBe(first.row.messageHashes[0]);
    expect(second.row.instructionsHash).toBe(first.row.instructionsHash);
  });

  it("вызов инструмента: вход и выход — куски; при ошибке выхода нет", async () => {
    const ok = await splitToolCall(toolCallEvent({ input: { q: "а" }, output: { r: 1 } }), hider);
    expect(ok.row.outputHash).not.toBeNull();
    expect(ok.blobs).toHaveLength(2);
    const failed = await splitToolCall(toolCallEvent({ output: undefined, error: "таймаут" }), hider);
    expect(failed.row).toMatchObject({ outputHash: null, error: "таймаут" });
    expect(failed.blobs).toHaveLength(1);
    expect(ok.row.id).not.toBe(failed.row.id);
  });
});
