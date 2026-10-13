import { describe, expect, it, vi } from "vitest";
import { createSandboxClient, SandboxRequestError } from "../../src/react/sandbox-client";

function fakeFetch(respond: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return respond(url, init);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

describe("клиент песочницы", () => {
  it("журнал хода и всего чата", async () => {
    const server = fakeFetch(() => Response.json({ entries: [{ kind: "tool", id: "t1" }] }));
    const client = createSandboxClient({ basePath: "/api/sandbox/", fetch: server.fetch });
    expect(await client.journal("c 1")).toEqual([{ kind: "tool", id: "t1" }]);
    await client.journal("c1", "m1");
    expect(server.calls.map((call) => call.url)).toEqual(["/api/sandbox/chats/c%201/journal", "/api/sandbox/chats/c1/journal?messageId=m1"]);
  });

  it("одно обращение и кусок", async () => {
    const server = fakeFetch((url) => Response.json(url.includes("blobs") ? { hash: "h", content: 1 } : { kind: "tool" }));
    const client = createSandboxClient({ fetch: server.fetch });
    expect(await client.call("k1")).toEqual({ kind: "tool" });
    expect(await client.blob("h")).toEqual({ hash: "h", content: 1 });
    expect(server.calls.map((call) => call.url)).toEqual(["/api/sandbox/journal/calls/k1", "/api/sandbox/journal/blobs/h"]);
  });

  it("настройки: GET и PUT", async () => {
    const settings = { instructions: "x", appInstructions: "боевая", updatedAt: null };
    const server = fakeFetch(() => Response.json(settings));
    const client = createSandboxClient({ fetch: server.fetch });
    expect(await client.settings("c1")).toEqual(settings);
    await client.saveSettings("c1", null);
    expect(server.calls[1]).toEqual({ url: "/api/sandbox/chats/c1/settings", method: "PUT", body: { instructions: null } });
  });

  it("правка ответа и отметки правок из истории", async () => {
    const server = fakeFetch((url) =>
      url.endsWith("answer-edit")
        ? Response.json({ messageId: "a2", mark: { textEdited: true, editedToolCallIds: [] } })
        : Response.json({ messages: [], answerEdits: { a2: { textEdited: true, editedToolCallIds: [] } } }),
    );
    const client = createSandboxClient({ fetch: server.fetch });
    const saved = await client.editAnswer("c1", "a1", { text: "Новый", toolOutputs: { k: { ok: 1 } } });
    expect(saved.messageId).toBe("a2");
    expect(server.calls[0]).toEqual({
      url: "/api/sandbox/chats/c1/messages/a1/answer-edit",
      method: "POST",
      body: { text: "Новый", toolOutputs: { k: { ok: 1 } } },
    });
    expect(await client.answerEdits("c1")).toEqual(new Map([["a2", { textEdited: true, editedToolCallIds: [] }]]));
    expect(server.calls[1]?.url).toBe("/api/sandbox/c1");
  });

  it("история без отметок — пустой список", async () => {
    const client = createSandboxClient({ fetch: fakeFetch(() => Response.json({ messages: [] })).fetch });
    expect(await client.answerEdits("c1")).toEqual(new Map());
  });

  it("отказ сервера — ошибка с кодом ответа и видом ошибки", async () => {
    const client = createSandboxClient({ fetch: fakeFetch(() => Response.json({ error: { kind: "answer_busy" } }, { status: 409 })).fetch });
    const error = await client.editAnswer("c1", "a1", { text: "x" }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SandboxRequestError);
    expect(error).toMatchObject({ status: 409, kind: "answer_busy" });
  });

  it("сбой сети и тело без вида ошибки", async () => {
    const offline = createSandboxClient({ fetch: (() => Promise.reject(new TypeError("offline"))) as typeof fetch });
    await expect(offline.settings("c1")).rejects.toBeInstanceOf(TypeError);
    const broken = createSandboxClient({ fetch: fakeFetch(() => new Response("oops", { status: 500 })).fetch });
    await expect(broken.settings("c1")).rejects.toMatchObject({ status: 500, kind: null });
  });
});
