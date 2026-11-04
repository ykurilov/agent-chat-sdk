import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { describe, expect, it, vi } from "vitest";
import { createTestChat } from "./support/test-chat";

describe("logError: исходная ошибка сервера", () => {
  it.each([
    new Error("база недоступна", { cause: new Error("соединение закрыто") }),
    { code: "db_offline" },
    "ошибка строкой",
  ])("передаёт выброшенное значение без обёртки: %s", async (failure) => {
    const logError = vi.fn();
    const storage = createInMemoryChatStorage();
    const { call } = createTestChat({
      storage: { ...storage, createChat: async () => { throw failure; } },
      logError,
    });
    const response = await call("POST", "");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { kind: "other" } });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("Чат: сбой"), failure);
    expect(logError.mock.calls.at(-1)?.[1]).toBe(failure);
  });

  it("сохраняет обработчик с одним аргументом", async () => {
    const lines: string[] = [];
    const { call } = createTestChat({
      resolveUser: async () => { throw new Error("нет сессии"); },
      logError: (message: string) => { lines.push(message); },
    });
    expect((await call("GET", "/chat")).status).toBe(500);
    expect(lines.join("\n")).toContain("нет сессии");
  });
});
