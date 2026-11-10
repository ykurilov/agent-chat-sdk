import { createInMemoryChatStorage, extendCatalog, standardCatalog } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createSpendingLimits } from "../src/create-spending-limits";
import type { SpendingWindowConfig } from "../src/create-spending-limits";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const today = (id: string, limitMessages: number): SpendingWindowConfig => ({ id, scope: "user", kind: "calendar", unit: "day", limitMessages });

function setup(windows: SpendingWindowConfig[]) {
  const storage = createInMemoryChatStorage();
  const limits = createSpendingLimits({ storage, catalog: extendCatalog(standardCatalog, {}), windows, now: () => NOW });
  const usedIn = async (userId: string, windowId: string) =>
    (await limits.status({ userId, chatId: "chat-1" })).windows!.find((window) => window.id === windowId)!.used;
  return { storage, limits, usedIn };
}

describe("ключи состояния окон", () => {
  it("окно «a:b» у «x» и окно «b» у «x:a» считаются отдельно", async () => {
    const { limits, usedIn } = setup([today("a:b", 5), today("b", 5)]);
    await limits.takeMessage!({ userId: "x", chatId: "chat-1" });
    expect(await usedIn("x", "a:b")).toBe(1);
    expect(await usedIn("x:a", "b")).toBe(0);
  });

  it("счёт, записанный до экранирования ключей, читается и продолжается", async () => {
    const { storage, limits, usedIn } = setup([today("day", 5)]);
    const before = { start: "2026-10-07T00:00:00.000Z", carriedUsd: 0, notified: [], messages: 3, count: "c1" };
    await storage.saveSpendingLimitState!("window:user:tg:42:day", JSON.stringify(before), null);
    expect(await usedIn("tg:42", "day")).toBe(3);
    await limits.takeMessage!({ userId: "tg:42", chatId: "chat-1" });
    expect(await usedIn("tg:42", "day")).toBe(4);
  });

  it("имя без «:» и «%» — ключ прежний", async () => {
    const { storage, limits } = setup([today("day", 5)]);
    await limits.takeMessage!({ userId: "anna", chatId: "chat-1" });
    expect(await storage.getSpendingLimitState!("window:user:anna:day")).not.toBeNull();
  });
});
