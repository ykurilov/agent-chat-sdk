import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createExternalConversationService, createMemoryConversationStore } from "@ykurilov/agent-chat-core/external";
import { createExternalChatHandler } from "../../src/external";
import { mountChat } from "../../src/hono";
import { createNextRouteHandlers } from "../../src/next";

describe("idle external SSE opening", () => {
  it.each(["fetch", "Hono", "Next.js"])("%s opens before the first poll or heartbeat completes", async (adapter) => {
    const service = createExternalConversationService({ store: createMemoryConversationStore(), resolveExecutor: () => { throw Error("offline"); } });
    await service.ensureConversation({ id: "main", ownerId: "owner", title: "Main", execution: { kind: "external", id: "manager" } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const events = service.events.bind(service);
    let reads = 0;
    vi.spyOn(service, "events").mockImplementation(async (...args) => {
      if (++reads > 1) await gate;
      return events(...args);
    });
    const basePath = "/api/conversations";
    const handler = createExternalChatHandler({ service, basePath, resolveUser: () => ({ id: "owner" }), pollMs: 60_000, heartbeatMs: 60_000 });
    const request = new Request(`https://chat.example.com${basePath}/main/events?after=0`, { headers: { accept: "text/event-stream" } });
    const app = new Hono();
    mountChat(app, { basePath, fetch: handler.fetch });
    const response = await (adapter === "Hono" ? app.fetch(request) : adapter === "Next.js" ? createNextRouteHandlers(handler).GET(request) : handler.fetch(request));
    const reader = response.body!.getReader();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const first = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => { deadline = setTimeout(() => resolve(null), 1000); }),
      ]);
      expect(first, "Opening must not wait for source events or a heartbeat").not.toBeNull();
      expect(new TextDecoder().decode(first!.value)).toBe(": connected\n\n");
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    } finally {
      clearTimeout(deadline);
      release();
      await reader.cancel();
      await service.close();
    }
  });
});
