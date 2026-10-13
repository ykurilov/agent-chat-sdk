import { describe, expect, it } from "vitest";
import { deriveChatTitle, InvalidChatTitleError, normalizeChatTitle } from "../../../src/conversation/chat-title";

describe("название чата по первому сообщению", () => {
  it("короткий текст остаётся как есть", () => {
    expect(deriveChatTitle("Привет, как дела?")).toBe("Привет, как дела?");
  });

  it("переносы строк, табуляции и повторные пробелы схлопываются в один пробел, края срезаются", () => {
    expect(deriveChatTitle("  Первая строка\n\n\tвторая   строка \r\n")).toBe("Первая строка вторая строка");
  });

  it("длиннее 60 знаков — первые 60 и «…»; пробел перед «…» не остаётся", () => {
    const text = "а".repeat(59) + " " + "б".repeat(30);
    const title = deriveChatTitle(text)!;
    expect(title).toBe("а".repeat(59) + "…");
    expect(deriveChatTitle("в".repeat(60))).toBe("в".repeat(60));
    expect(deriveChatTitle("в".repeat(61))).toBe("в".repeat(60) + "…");
  });

  it("не режет суррогатную пару эмодзи пополам", () => {
    const title = deriveChatTitle("🙂".repeat(80))!;
    expect(title).toBe("🙂".repeat(60) + "…");
  });

  it("символ с кодом ноль выбрасывается: Postgres не принимает его в тексте", () => {
    expect(deriveChatTitle("лог:\u0000конец")).toBe("лог:конец");
    expect(deriveChatTitle("\u0000\u0000")).toBeNull();
    expect(normalizeChatTitle("Чат\u0000 один")).toBe("Чат один");
  });

  it("пустой или пробельный текст — null", () => {
    expect(deriveChatTitle("")).toBeNull();
    expect(deriveChatTitle(" \n\t ")).toBeNull();
  });
});

describe("название, заданное человеком", () => {
  it("срезает края и схлопывает пробелы, не обрезая длину", () => {
    expect(normalizeChatTitle("  Отпуск \n в   Греции ")).toBe("Отпуск в Греции");
    expect(normalizeChatTitle("я".repeat(100))).toBe("я".repeat(100));
  });

  it("пустое и длиннее 100 знаков — InvalidChatTitleError", () => {
    expect(() => normalizeChatTitle("   ")).toThrow(InvalidChatTitleError);
    expect(() => normalizeChatTitle("я".repeat(101))).toThrow(InvalidChatTitleError);
    expect(() => normalizeChatTitle(42 as unknown as string)).toThrow(InvalidChatTitleError);
  });
});
