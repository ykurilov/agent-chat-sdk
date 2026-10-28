import { createInMemoryChatStorage, SpendingLimitReachedError, standardCatalog } from "@ykurilov/agent-chat-core";
import { createSpendingLimits } from "@ykurilov/agent-chat-limits";
import { createDeepSeekWebTools } from "@ykurilov/agent-chat-web-tools";
import { expect, it, vi } from "vitest";

it("DeepSeek response expenses enter the existing spending limit; an empty search does not", async () => {
  const storage = createInMemoryChatStorage();
  const now = new Date("2030-01-01T12:00:00Z");
  const limits = createSpendingLimits({ storage, catalog: standardCatalog, now: () => now, budget: () => ({ user: 0.0005 }) });
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ results: [] }))
    .mockResolvedValueOnce(Response.json({ title: "Page", content: "Text" }));
  const tools = createDeepSeekWebTools({ apiKey: "test-only-key", fetch: request, spending: { storage, now: () => now.getTime() } })({
    profile: { acceptsImages: false }, providerId: "deepseek", ownerId: "a", chatId: "chat-a",
  });
  const call = { toolCallId: "call", messages: [], context: undefined };
  await limits.assertWithinLimit({ userId: "a", chatId: "chat-a" });
  await tools.web_search!.execute!({ query: "q" }, call);
  await limits.assertWithinLimit({ userId: "a", chatId: "chat-a" });
  await tools.read_page!.execute!({ url: "https://example.com" }, call);
  await expect(limits.assertWithinLimit({ userId: "a", chatId: "chat-a" })).rejects.toBeInstanceOf(SpendingLimitReachedError);
  await expect(limits.assertWithinLimit({ userId: "other", chatId: "other-chat" })).resolves.toBeUndefined();
});
