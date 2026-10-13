import { splitAnswerFences } from "../live-demos/answer-fences";

/** Кусок текста ответа: обычная разметка или блок ```mermaid. */
export type MarkdownSegment =
  | { kind: "markdown"; markdown: string }
  /** `source` — текст схемы без ограждений; `closed` — блок закрыт; `markdown` — блок целиком, как в тексте. */
  | { kind: "mermaid"; source: string; closed: boolean; markdown: string };

/**
 * Делит Markdown на обычные куски и блоки ```mermaid верхнего уровня (по правилам ограждений CommonMark): блок внутри
 * другого блока кода и блок с отступом в четыре пробела — не схема. Номер схемы — её порядок среди кусков `mermaid`;
 * им скин зовёт `renderDiagram(source, blockIndex)`, и слой поведения считает так же.
 */
export function splitMermaidBlocks(markdown: string): MarkdownSegment[] {
  return splitAnswerFences(markdown, { diagrams: true }) as MarkdownSegment[];
}
