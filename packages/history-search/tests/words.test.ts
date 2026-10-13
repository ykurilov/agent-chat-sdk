import { describe, expect, it } from "vitest";
import { findWord as findWordIn, normalizeText, queryWords } from "../src/words";

describe("слова запроса", () => {
  it("регистр и «ё» не важны, повторы убираются", () => {
    expect(queryWords("Ёлка ЕЛКА елка")).toEqual(["елка"]);
  });

  it("окончания длинных слов подрезаются: от 7 букв — на 2, 5–6 — на 1, короче не трогаются", () => {
    expect(queryWords("документа")).toEqual(["докумен"]);
    expect(queryWords("документы")).toEqual(["докумен"]);
    expect(queryWords("документ")).toEqual(["докуме"]);
    expect(queryWords("отчёты")).toEqual(["отчет"]);
    expect(queryWords("путь файл")).toEqual(["путь", "файл"]);
  });

  it("адреса, версии и имена файлов остаются целыми", () => {
    expect(queryWords("сервер 10.0.0.5 и report_v2.pdf")).toEqual(["серве", "10.0.0.5", "report_v2.pdf"]);
  });

  it("однобуквенные слова отбрасываются, если есть другие", () => {
    expect(queryWords("а сервер")).toEqual(["серве"]);
    expect(queryWords("а")).toEqual(["а"]);
  });

  it("пустой запрос — нет слов", () => {
    expect(queryWords("  ,;  ")).toEqual([]);
  });
});

/** Слово ищется в уже нормализованном тексте: вызывающий нормализует сообщение один раз, а не под каждое слово. */
const findWord = (text: string, word: string) => findWordIn(normalizeText(text), word);

describe("поиск слова в тексте", () => {
  it("находит по началу слова текста и говорит, где нашёл", () => {
    const text = "В Документах лежит Отчёт за март";
    expect(findWord(text, "докумен")).toBe(2);
    expect(findWord(text, "отчет")).toBe(text.indexOf("Отчёт"));
  });

  it("место верно и после буквы, которая в нижнем регистре длиннее: «İ» не сдвигает найденное", () => {
    const text = "İİİ İstanbul: Отчёт за март";
    expect(normalizeText(text)).toHaveLength(text.length);
    expect(findWord(text, "отчет")).toBe(text.indexOf("Отчёт"));
  });

  it("любая форма слова запроса находит любую форму слова в тексте", () => {
    for (const asked of ["документ", "документа", "документов"]) {
      for (const written of ["документ", "документа", "документами"]) {
        expect(findWord(written, queryWords(asked)[0]!)).toBe(0);
      }
    }
  });

  it("часть слова внутри другого слова не считается", () => {
    expect(findWord("подокументировано", "докумен")).toBe(-1);
  });

  it("не найдено — минус один", () => {
    expect(findWord("сервер запущен", "порт")).toBe(-1);
  });

  it("точки и подчёркивания в запросе не ломают поиск", () => {
    expect(findWord("адрес 10.0.0.5, порт 80", "10.0.0.5")).toBe(6);
  });
});
