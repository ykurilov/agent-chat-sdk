import { describe, expect, it } from "vitest";
import { createPendingBrowserCalls } from "../../../src/agent-run/browser-tools";

describe("ошибка страницы: обрезка не рвёт эмодзи (FR-036)", () => {
  it("эмодзи на границе 1000 знаков не оставляет половинку", async () => {
    const pending = createPendingBrowserCalls();
    const waiting = pending.wait({ chatId: "c", toolCallId: "t1", tabId: "tab", timeoutMs: 30_000, signal: new AbortController().signal });
    pending.answer("c", "t1", { tabId: "tab", error: `${"о".repeat(998)}😀${"я".repeat(50)}` });
    const error = (await waiting.catch((thrown: Error) => thrown)) as Error;
    expect(error.message.length).toBeLessThanOrEqual(1000);
    expect(error.message).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(error.message.endsWith("…")).toBe(true);
  });
});
