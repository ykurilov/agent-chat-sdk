import { describe, expect, expectTypeOf, it } from "vitest";
import { BUILT_IN_USAGE_SOURCES, createInMemoryChatStorage } from "../src/index";
import type { BuiltInUsageSource, UsageRecord, UsageSource } from "../src/index";

const record = (source: UsageSource): UsageRecord => ({
  id: crypto.randomUUID(),
  ownerId: "anna",
  chatId: "c1",
  messageId: null,
  source,
  modelId: "m",
  providerId: "p",
  inputTokens: 1,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  costUsd: 0.5,
  createdAt: "2026-10-14T00:00:00.000Z",
});

describe("виды расхода: штатные и свои", () => {
  it("штатные виды голоса есть в списке", () => {
    expect(BUILT_IN_USAGE_SOURCES).toContain("voice_input");
    expect(BUILT_IN_USAGE_SOURCES).toContain("voice_polish");
    expectTypeOf<"voice_input">().toMatchTypeOf<BuiltInUsageSource>();
  });

  it("штатный вид вызова инструмента MCP есть в списке", () => {
    expect(BUILT_IN_USAGE_SOURCES).toContain("mcp_tool");
    expectTypeOf<"mcp_tool">().toMatchTypeOf<BuiltInUsageSource>();
  });

  it("свой вид приложения — без приведения типа; пишется, суммируется и отбирается фильтром", async () => {
    const custom: UsageSource = "font_download";
    const storage = createInMemoryChatStorage();
    await storage.insertUsageRecord(record(custom));
    await storage.insertUsageRecord(record("answer"));

    const fonts = await storage.sumUsage({ ownerId: "anna", source: "font_download" });
    const all = await storage.sumUsage({ ownerId: "anna" });

    expect(fonts.reduce((sum, row) => sum + row.costUsd, 0)).toBe(0.5);
    expect(all.reduce((sum, row) => sum + row.costUsd, 0)).toBe(1);
  });
});
