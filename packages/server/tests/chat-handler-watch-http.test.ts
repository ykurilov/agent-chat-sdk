import type { AddressInfo } from "node:net";
import { serve as serveV2 } from "@hono/node-server";
import { serve as serveV1 } from "@hono/node-server-v1";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { Hono } from "hono";
import { afterEach, expect, it } from "vitest";
import { createChatServer } from "../src/chat-handler";
import { mountChat } from "../src/hono";
import { mockCatalog, mockEnv, mockModelId } from "./support/mock-catalog";

const servers: Array<{ close(callback?: () => void): unknown }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startServer(serve: typeof serveV2) {
  const { handler } = createChatServer({
    basePath: "/api/chat",
    resolveUser: async () => ({ id: "anna" }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    catalog: mockCatalog(),
    storage: createInMemoryChatStorage(),
    agent: { instructions: "Ты помощник." },
    env: mockEnv,
  });
  const app = new Hono();
  mountChat(app, handler);
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chat`;
}

it.each([
  ["@hono/node-server 1.x", serveV1 as unknown as typeof serveV2],
  ["@hono/node-server 2.x", serveV2],
])("watch на настоящем %s отдаёт x-agent-chat-history-match: 1 при совпавшей версии и 0 при несовпавшей", async (_, serve) => {
  const base = await startServer(serve);
  const created = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const { id } = (await created.json()) as { id: string };
  const history = await fetch(`${base}/${id}`);
  const version = history.headers.get("x-agent-chat-history-version")!;
  expect(version).toMatch(/^[a-f0-9]{64}$/);

  const same = await fetch(`${base}/${id}/watch?historyVersion=${version}`);
  expect(same.headers.get("x-agent-chat-history-match")).toBe("1");
  await same.body!.cancel();

  const other = await fetch(`${base}/${id}/watch?historyVersion=${"a".repeat(64)}`);
  expect(other.headers.get("x-agent-chat-history-match")).toBe("0");
  await other.body!.cancel();
});
