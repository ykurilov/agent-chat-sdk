import { createNextRouteHandlers } from "@ykurilov/agent-chat-server/next";
import { mountChat } from "@ykurilov/agent-chat-server/hono";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createVoiceHandler } from "../src/server";

const handler = createVoiceHandler({
  basePath: "/api/voice",
  resolveUser: async () => ({ id: "anna" }),
  apiKey: "main-key",
  fetch: (async () =>
    Response.json({ api_key: "temp:1", expires_at: "2026-09-30T00:00:00.000Z" }, { status: 201 })) as unknown as typeof fetch,
});

describe("обработчик голоса монтируется теми же средствами, что и чат", () => {
  it("в Hono через mountChat", async () => {
    const app = new Hono();
    mountChat(app, handler);

    const response = await app.request("/api/voice/session", { method: "POST" });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { apiKey: string }).apiKey).toBe("temp:1");
  });

  it("в Next.js через createNextRouteHandlers", async () => {
    const { POST } = createNextRouteHandlers(handler);

    const response = await POST(new Request("http://app.test/api/voice/session", { method: "POST" }));

    expect(response.status).toBe(200);
  });
});
