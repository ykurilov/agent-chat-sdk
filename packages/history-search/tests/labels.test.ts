import { describe, expect, it } from "vitest";
import * as root from "../src/index";
import { englishHistorySearchTitles, historySearchTitles, withHistorySearchTitles } from "../src/labels";

const labels = {
  toolRunning: (name: string) => `Работает: ${name}`,
  toolDone: (name: string) => `Готово: ${name}`,
  toolError: (name: string) => `Сбой: ${name}`,
  other: "не тронуто",
};

describe("подписи поиска по старой переписке", () => {
  it("называет инструмент по-русски, остальное не меняет", () => {
    const titled = withHistorySearchTitles(labels);
    expect(titled.toolRunning("search_earlier_conversation")).toBe("Работает: Поиск по старой переписке");
    expect(titled.toolDone("web_search")).toBe("Готово: web_search");
    expect(titled.other).toBe("не тронуто");
  });

  it("оба словаря есть и в корне пакета, как в `./labels`", () => {
    expect(root.historySearchTitles).toBe(historySearchTitles);
    expect(root.englishHistorySearchTitles).toBe(englishHistorySearchTitles);
  });

  it("свой словарь названий, например английский", () => {
    expect(withHistorySearchTitles(labels, englishHistorySearchTitles).toolDone("search_earlier_conversation")).toBe("Готово: Searching earlier messages");
  });
});
