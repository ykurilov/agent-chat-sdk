import { describe, expect, it } from "vitest";
import { splitMarkdownBlocks } from "../src/markdown-blocks";

describe("splitMarkdownBlocks", () => {
  it("делит текст на блоки верхнего уровня по пустым строкам", () => {
    expect(splitMarkdownBlocks("### Заголовок\n\nАбзац\nвторая строка\n\n| a | b |\n|---|---|\n| 1 | 2 |")).toEqual([
      "### Заголовок",
      "Абзац\nвторая строка",
      "| a | b |\n|---|---|\n| 1 | 2 |",
    ]);
  });

  it("не режет блок кода с пустыми строками внутри", () => {
    const code = "```ts\nconst a = 1;\n\n\nconst b = 2;\n```";
    expect(splitMarkdownBlocks(`До\n\n${code}\n\nПосле`)).toEqual(["До", code, "После"]);
  });

  it("недописанный блок кода — один блок до конца текста", () => {
    expect(splitMarkdownBlocks("До\n\n~~~~\nкод\n\nещё код\n~~~\n\nвсё ещё код")).toEqual([
      "До",
      "~~~~\nкод\n\nещё код\n~~~\n\nвсё ещё код",
    ]);
  });

  it("не отрывает продолжение с отступом от пункта списка", () => {
    const list = "1. Пункт\n\n   Продолжение пункта\n\n       код в пункте\n2. Второй";
    expect(splitMarkdownBlocks(`${list}\n\nАбзац`)).toEqual([list, "Абзац"]);
  });

  it("список с пустыми строками между пунктами остаётся одним списком", () => {
    const list = "- первый\n\n- второй\n\n* третий\n\n10) четвёртый";
    expect(splitMarkdownBlocks(`${list}\n\nАбзац`)).toEqual([list, "Абзац"]);
  });

  it("список после абзаца — отдельный блок", () => {
    expect(splitMarkdownBlocks("Абзац\n\n- пункт")).toEqual(["Абзац", "- пункт"]);
  });

  it("со сносками и ссылками по имени текст не делится: они действуют на весь текст", () => {
    const withFootnote = "Факт[^1]\n\nЕщё абзац\n\n[^1]: Источник";
    const withReference = "См. [доку][d]\n\nЕщё абзац\n\n[d]: https://example.com";
    expect(splitMarkdownBlocks(withFootnote)).toEqual([withFootnote]);
    expect(splitMarkdownBlocks(withReference)).toEqual([withReference]);
  });

  it("пустые строки в начале и в конце не дают пустых блоков", () => {
    expect(splitMarkdownBlocks("\n\nАбзац\n\n\n")).toEqual(["Абзац"]);
    expect(splitMarkdownBlocks("")).toEqual([]);
  });

  it("готовые блоки не меняются, пока дописывается последний", () => {
    const full = "Абзац\n\n| a |\n|---|\n| 1 |\n\n```js\nx()\n```\n\nКонец ответа";
    const finished = splitMarkdownBlocks(full);
    for (let length = 1; length <= full.length; length++) {
      const blocks = splitMarkdownBlocks(full.slice(0, length));
      expect(blocks.slice(0, -1)).toEqual(finished.slice(0, blocks.length - 1));
    }
  });
});
