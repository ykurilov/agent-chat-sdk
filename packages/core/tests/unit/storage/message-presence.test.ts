import { expect, it } from "vitest";
import { createInMemoryChatStorage, hasChatMessages } from "../../../src/index";

it("uses the lightweight method, and supports older app-owned storage implementations", async () => {
  const storage = createInMemoryChatStorage();
  await storage.createChat({ id: "c", ownerId: "u", modelId: "m", providerId: "p" });
  expect(await hasChatMessages(storage, "c")).toBe(false);
  expect(await hasChatMessages({ ...storage, hasMessages: undefined }, "missing")).toBe(false);
  expect(await hasChatMessages({ ...storage, hasMessages: async () => true, listMessageLinks: async () => { throw new Error("must not load links"); } }, "c")).toBe(true);
});
