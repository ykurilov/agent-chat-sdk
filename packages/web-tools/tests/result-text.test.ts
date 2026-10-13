import { describe, expect, it } from "vitest";
import { formatPage, formatSearchResults } from "../src/result-text";

describe("formatSearchResults", () => {
  it("нумерованный список: заголовок ссылкой, ниже выдержка", () => {
    const text = formatSearchResults("версия node", [
      { title: "Node.js Releases", url: "https://nodejs.org/releases", snippet: "Текущая версия 26" },
      { title: "Node.js 26", url: "https://nodejs.org/26", snippet: "Что нового" },
    ]);
    expect(text).toBe(
      [
        "1. [Node.js Releases](https://nodejs.org/releases)",
        "   Текущая версия 26",
        "2. [Node.js 26](https://nodejs.org/26)",
        "   Что нового",
      ].join("\n"),
    );
  });

  it("результат без выдержки — одна строка", () => {
    expect(formatSearchResults("q", [{ title: "A", url: "https://a.example", snippet: "" }])).toBe("1. [A](https://a.example)");
  });

  it("у результата без заголовка заголовком служит адрес", () => {
    expect(formatSearchResults("q", [{ title: "  ", url: "https://a.example", snippet: "" }])).toBe(
      "1. [https://a.example](https://a.example)",
    );
  });

  it("квадратные скобки в заголовке не ломают ссылку", () => {
    expect(formatSearchResults("q", [{ title: "Что [нового] в 26", url: "https://a.example", snippet: "" }])).toBe(
      "1. [Что \\[нового\\] в 26](https://a.example)",
    );
  });

  it("в список попадают только адреса http и https", () => {
    const text = formatSearchResults("q", [
      { title: "Плохая", url: "javascript:alert(1)", snippet: "" },
      { title: "Файл", url: "file:///etc/passwd", snippet: "" },
      { title: "Данные", url: "data:text/html,x", snippet: "" },
      { title: "Хорошая", url: "https://ok.example/a", snippet: "" },
    ]);
    expect(text).toBe("1. [Хорошая](https://ok.example/a)");
  });

  it("если остались только чужие адреса — «ничего не найдено»", () => {
    expect(formatSearchResults("q", [{ title: "Плохая", url: "javascript:alert(1)", snippet: "" }])).toBe("Ничего не найдено по запросу «q».");
  });

  it("скобки в адресе не ломают ссылку", () => {
    expect(formatSearchResults("q", [{ title: "Т", url: "https://a.example/wiki/X_(Y)", snippet: "" }])).toBe(
      "1. [Т](https://a.example/wiki/X_%28Y%29)",
    );
  });

  it("пустой результат — понятная строка с запросом", () => {
    expect(formatSearchResults("редкий запрос", [])).toBe("Ничего не найдено по запросу «редкий запрос».");
  });
});

describe("formatPage", () => {
  const page = { url: "https://example.com/a", title: "Пример", markdown: "Первый абзац.\n\nВторой абзац." };

  it("заголовок, источник и текст", () => {
    expect(formatPage(page, 1000)).toBe("# Пример\nИсточник: https://example.com/a\n\nПервый абзац.\n\nВторой абзац.");
  });

  it("без заголовка страницы заголовком служит адрес", () => {
    expect(formatPage({ ...page, title: "" }, 1000)).toMatch(/^# https:\/\/example\.com\/a\nИсточник:/);
  });

  it("пустая страница — строка об этом, а не пустота", () => {
    expect(formatPage({ ...page, markdown: "  \n " }, 1000)).toBe(
      "# Пример\nИсточник: https://example.com/a\n\nНа странице нет текста.",
    );
  });

  it("длинный текст режется на границе абзаца с пометкой, сколько показано", () => {
    const markdown = ["а".repeat(40), "б".repeat(40), "в".repeat(40)].join("\n\n");
    const text = formatPage({ ...page, markdown }, 100);
    const body = text.split("\n\n").slice(1).join("\n\n");
    expect(body).toContain("а".repeat(40));
    expect(body).toContain("б".repeat(40));
    expect(body).not.toContain("в".repeat(40));
    expect(body).toMatch(/\[Текст обрезан: показано 82 из 124 знаков\]$/);
  });

  it("если абзацев нет — режет по пределу", () => {
    const text = formatPage({ ...page, markdown: "x".repeat(500) }, 100);
    expect(text).toContain("x".repeat(100));
    expect(text).not.toContain("x".repeat(101));
    expect(text).toContain("[Текст обрезан: показано 100 из 500 знаков]");
  });

  it("текст ровно в пределе не режется и не помечается", () => {
    const text = formatPage({ ...page, markdown: "y".repeat(100) }, 100);
    expect(text).not.toContain("обрезан");
  });
});
