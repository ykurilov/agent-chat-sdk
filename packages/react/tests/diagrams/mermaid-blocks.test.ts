import { describe, expect, it } from "vitest";
import { splitMermaidBlocks } from "../../src/diagrams/mermaid-blocks";

const fence = "\x60\x60\x60";

describe("splitMermaidBlocks: блоки ```mermaid в тексте ответа", () => {
  it("текст без схем — один кусок как есть", () => {
    expect(splitMermaidBlocks("Привет\n\n- пункт")).toEqual([{ kind: "markdown", markdown: "Привет\n\n- пункт" }]);
    expect(splitMermaidBlocks(`${fence}js\nlet a\n${fence}`)).toEqual([{ kind: "markdown", markdown: `${fence}js\nlet a\n${fence}` }]);
  });

  it("закрытый блок: исходник без ограждений, текст до и после — отдельными кусками", () => {
    const markdown = `Смотрите:\n${fence}mermaid\ngraph TD\nA-->B\n${fence}\nИтого.`;
    expect(splitMermaidBlocks(markdown)).toEqual([
      { kind: "markdown", markdown: "Смотрите:" },
      { kind: "mermaid", source: "graph TD\nA-->B", closed: true, markdown: `${fence}mermaid\ngraph TD\nA-->B\n${fence}` },
      { kind: "markdown", markdown: "Итого." },
    ]);
  });

  it("незакрытый блок в конце — closed: false", () => {
    expect(splitMermaidBlocks(`Схема:\n\n${fence}mermaid\ngraph TD\nA--`)).toEqual([
      { kind: "markdown", markdown: "Схема:" },
      { kind: "mermaid", source: "graph TD\nA--", closed: false, markdown: `${fence}mermaid\ngraph TD\nA--` },
    ]);
  });

  it("тильды, длинное ограждение, отступ до трёх пробелов, Mermaid с большой буквы и слова после имени", () => {
    const blocks = splitMermaidBlocks(`~~~~Mermaid  title\nA\n~~~\nB\n~~~~\n\n   ${fence}mermaid\nC\n   ${fence}`).filter(
      (segment) => segment.kind === "mermaid",
    );
    expect(blocks.map((block) => [block.source, block.closed])).toEqual([
      ["A\n~~~\nB", true],
      ["C", true],
    ]);
  });

  it("```mermaid внутри другого блока кода и с отступом в 4 пробела — не схема", () => {
    const inside = `${fence}${fence}md\n${fence}mermaid\nA\n${fence}\n${fence}${fence}`;
    expect(splitMermaidBlocks(inside)).toEqual([{ kind: "markdown", markdown: inside }]);
    expect(splitMermaidBlocks(`- пункт\n\n    ${fence}mermaid\n    A\n    ${fence}`)).toHaveLength(1);
  });

  it("несколько схем подряд нумеруются по порядку", () => {
    const blocks = splitMermaidBlocks(`${fence}mermaid\nA\n${fence}\n${fence}mermaid\nB\n${fence}`);
    expect(blocks.map((block) => (block.kind === "mermaid" ? block.source : "-"))).toEqual(["A", "B"]);
  });
});
