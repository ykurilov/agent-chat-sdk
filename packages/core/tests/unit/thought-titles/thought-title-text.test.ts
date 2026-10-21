import { describe, expect, it } from "vitest";
import {
  cleanThoughtTitle,
  fitsLanguage,
  languageOfText,
  providerHeadingOf,
  shortThoughtTitle,
} from "../../../src/thought-titles/thought-title-text";

describe("заголовок провайдера в тексте рассуждения", () => {
  it("сводка GPT через OpenRouter: первый жирный заголовок отдельной строкой", () => {
    const text = "**Продумываю правила игры**\n\nНужно решить, сколько ходов...\n\n**Проверяю счёт**\n\nДальше.";
    expect(providerHeadingOf(text)).toBe("Продумываю правила игры");
  });

  it("жирное внутри строки — не заголовок; нет заголовков — нет", () => {
    expect(providerHeadingOf("Тут **важно** не спешить.")).toBeUndefined();
    expect(providerHeadingOf("Просто мысль без заголовка.")).toBeUndefined();
  });
});

describe("язык заголовка", () => {
  it("по последнему сообщению человека: кириллица — русский, иначе английский", () => {
    expect(languageOfText("Сделай игру в крестики-нолики")).toBe("ru");
    expect(languageOfText("Make a tic-tac-toe game")).toBe("en");
    expect(languageOfText("")).toBe("en");
  });

  it("письменность должна совпасть с языком", () => {
    expect(fitsLanguage("Продумываю правила", "ru")).toBe(true);
    expect(fitsLanguage("Planning the rules", "ru")).toBe(false);
    expect(fitsLanguage("Planning the rules", "en")).toBe(true);
    expect(fitsLanguage("Продумываю правила", "en")).toBe(false);
    expect(fitsLanguage("Planification des règles", "fr")).toBe(true);
    // Незнакомый язык — письменность не проверяется.
    expect(fitsLanguage("ルールを考える", "ja")).toBe(true);
  });
});

describe("чистка ответа модели заголовков", () => {
  const settings = { maxLength: 60, language: "ru" };

  it("кавычки, звёздочки, точка на конце и лишние строки снимаются, первая буква — заглавная", () => {
    expect(cleanThoughtTitle("«продумываю правила игры.»\nЕщё строка", settings)).toBe("Продумываю правила игры");
    expect(cleanThoughtTitle("**Заголовок:** Выбираю цвета", settings)).toBe("Выбираю цвета");
  });

  it("больше шести слов, длиннее предела, пусто — нет заголовка", () => {
    expect(cleanThoughtTitle("Думаю над тем как лучше всего сделать правила игры", settings)).toBeUndefined();
    expect(cleanThoughtTitle("Продумываю", { ...settings, maxLength: 5 })).toBeUndefined();
    expect(cleanThoughtTitle("  ", settings)).toBeUndefined();
  });

  it("код, пути и имена инструментов — нет заголовка", () => {
    expect(cleanThoughtTitle("Правлю src/rules.ts", settings)).toBeUndefined();
    expect(cleanThoughtTitle("Вызываю `edit_file`", settings)).toBeUndefined();
    expect(cleanThoughtTitle("Зову read_file снова", settings)).toBeUndefined();
    expect(cleanThoughtTitle("Открываю game-dev", { ...settings, toolNames: ["game-dev"] })).toBeUndefined();
  });

  it("не тот язык — нет заголовка", () => {
    expect(cleanThoughtTitle("Planning the game rules", settings)).toBeUndefined();
  });
});

describe("короткое раздумье", () => {
  it("первое предложение на языке человека", () => {
    expect(shortThoughtTitle("Проверю счёт. Потом отвечу.", { maxLength: 60, language: "ru" })).toBe("Проверю счёт");
  });

  it("первое предложение на другом языке или длинное — нет заголовка", () => {
    expect(shortThoughtTitle("Let me check the score.", { maxLength: 60, language: "ru" })).toBeUndefined();
    expect(shortThoughtTitle("Проверю счёт и все остальные мелочи по очереди. Да.", { maxLength: 20, language: "ru" })).toBeUndefined();
  });
});
