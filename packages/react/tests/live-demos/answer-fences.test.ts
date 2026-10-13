import { describe, expect, it } from "vitest";
import { splitMermaidBlocks } from "../../src/diagrams/mermaid-blocks";
import { splitAnswerFences } from "../../src/live-demos/answer-fences";

const fence = "\x60\x60\x60";
const demo = (source: string) => `${fence}html-demo\n${source}\n${fence}`;
const mermaid = (source: string) => `${fence}mermaid\n${source}\n${fence}`;

describe("splitAnswerFences: схемы и живые демонстрации в тексте ответа (043)", () => {
  it("закрытый блок ```html-demo: исходник без ограждений, текст до и после — отдельными кусками", () => {
    expect(splitAnswerFences(`До:\n${demo("<b>1</b>")}\nПосле.`, { demos: true })).toEqual([
      { kind: "markdown", markdown: "До:" },
      { kind: "demo", source: "<b>1</b>", closed: true, markdown: demo("<b>1</b>") },
      { kind: "markdown", markdown: "После." },
    ]);
  });

  it("незакрытый блок — closed: false; внутри — строки с ``` в начале не закрывают длинное ограждение", () => {
    expect(splitAnswerFences(`${fence}html-demo\n<p>`, { demos: true })).toEqual([{ kind: "demo", source: "<p>", closed: false, markdown: `${fence}html-demo\n<p>` }]);
    const long = `${fence}${fence}html-demo\n<pre>${fence}</pre>\n${fence}${fence}`;
    expect(splitAnswerFences(long, { demos: true })).toEqual([{ kind: "demo", source: `<pre>${fence}</pre>`, closed: true, markdown: long }]);
  });

  it("без demos блок ```html-demo — обычный текст; без diagrams ```mermaid — тоже", () => {
    const markdown = `${demo("<i>x</i>")}\n${mermaid("graph TD")}`;
    expect(splitAnswerFences(markdown, { diagrams: true }).map((segment) => segment.kind)).toEqual(["markdown", "mermaid"]);
    expect(splitAnswerFences(markdown, { demos: true }).map((segment) => segment.kind)).toEqual(["demo", "markdown"]);
    expect(splitAnswerFences(markdown, {})).toEqual([{ kind: "markdown", markdown }]);
  });

  it("```mermaid внутри демонстрации — не схема: номера схем те же, что у splitMermaidBlocks", () => {
    const markdown = `${demo(mermaid("graph TD"))}\n${mermaid("graph LR")}`;
    const both = splitAnswerFences(markdown, { diagrams: true, demos: true });
    expect(both.flatMap((segment) => (segment.kind === "mermaid" ? [segment.source] : []))).toEqual(
      splitMermaidBlocks(markdown).flatMap((segment) => (segment.kind === "mermaid" ? [segment.source] : [])),
    );
  });

  it("```html-demo внутри другого блока кода и с отступом в 4 пробела — не демонстрация; HTML-DEMO с большой буквы — демонстрация", () => {
    const inside = `${fence}${fence}md\n${demo("x")}\n${fence}${fence}`;
    expect(splitAnswerFences(inside, { demos: true })).toEqual([{ kind: "markdown", markdown: inside }]);
    expect(splitAnswerFences(`    ${fence}html-demo\n    x\n    ${fence}`, { demos: true })[0]!.kind).toBe("markdown");
    expect(splitAnswerFences(`${fence}HTML-Demo\nx\n${fence}`, { demos: true })[0]!.kind).toBe("demo");
  });
});
