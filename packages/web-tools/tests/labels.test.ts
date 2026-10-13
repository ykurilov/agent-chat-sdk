import { describe, expect, it } from "vitest";
import { englishWebToolTitles, webToolTitles, withWebToolTitles } from "../src/labels";

const labels = {
  toolRunning: (toolName: string) => `${toolName}: выполняется`,
  toolDone: (toolName: string) => `${toolName}: готово`,
  toolError: (toolName: string) => `${toolName}: ошибка`,
  send: "Отправить",
};

describe("withWebToolTitles", () => {
  const titled = withWebToolTitles(labels);

  it("три веб-инструмента подписаны по-русски, и подпись короткая", () => {
    expect(webToolTitles).toEqual({
      web_search: "Поиск в интернете",
      read_page: "Чтение страницы",
      page_screenshot: "Скриншот страницы",
    });
    for (const name of Object.keys(webToolTitles)) {
      for (const label of [titled.toolRunning(name), titled.toolDone(name), titled.toolError(name)]) {
        expect(label.length).toBeLessThanOrEqual(30);
      }
    }
    expect(titled.toolRunning("web_search")).toBe("Поиск в интернете: выполняется");
    expect(titled.toolDone("read_page")).toBe("Чтение страницы: готово");
    expect(titled.toolError("page_screenshot")).toBe("Скриншот страницы: ошибка");
  });

  it("остальные инструменты и прочие надписи остаются как были", () => {
    expect(titled.toolDone("current_time")).toBe("current_time: готово");
    expect(titled.send).toBe("Отправить");
  });

  it("исходный словарь не меняется", () => {
    expect(labels.toolDone("web_search")).toBe("web_search: готово");
  });

  it("свой словарь названий, например английский", () => {
    expect(withWebToolTitles(labels, englishWebToolTitles).toolDone("web_search")).toBe("Web search: готово");
  });
});
