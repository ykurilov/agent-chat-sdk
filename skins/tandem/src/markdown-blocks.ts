import { splitAnswerFences } from "@ykurilov/agent-chat-react";

/*
 * Ответ агента дописывается кусками по несколько слов. Если каждый раз разбирать и рисовать
 * весь текст заново, длинный ответ тормозит всё сильнее. Поэтому текст делится на блоки
 * верхнего уровня: готовые блоки не меняются и не перерисовываются, растёт только последний.
 */

// \x60 — обратная кавычка: блок кода открывают три и больше «`» или «~».
const fenceOpening = /^ {0,3}(\x60{3,}|~{3,})/;
const listItem = /^ {0,3}([-+*]|\d{1,9}[.)])( |$)/;
// Сноски и ссылки по имени действуют на весь текст: такой текст не делится.
const definition = /^ {0,3}\[[^\]]+\]:/m;

/** Делит Markdown на блоки верхнего уровня, не разрывая код, списки и продолжения с отступом. */
export function splitMarkdownBlocks(markdown: string): string[] {
  if (definition.test(markdown)) return markdown.trim() ? [markdown.trim()] : [];

  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let afterBlankLine = false;

  const finishBlock = () => {
    const text = current.join("\n").trim();
    if (text) blocks.push(text);
    current = [];
  };

  for (const line of markdown.split("\n")) {
    if (fence) {
      current.push(line);
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    if (line.trim() === "") {
      afterBlankLine = current.length > 0;
      current.push(line);
      continue;
    }
    if (afterBlankLine && startsNewBlock(line, current)) finishBlock();
    afterBlankLine = false;
    current.push(line);
    fence = fenceOpening.exec(line)?.[1] ?? null;
  }
  finishBlock();
  return blocks;
}

function startsNewBlock(line: string, current: string[]): boolean {
  // Строка с отступом после пустой — продолжение пункта списка или код с отступом.
  if (/^\s/.test(line)) return false;
  const blockStart = current.find((text) => text.trim() !== "") ?? "";
  return !(listItem.test(line) && listItem.test(blockStart));
}

function closesFence(line: string, fence: string): boolean {
  const trimmed = line.trim();
  const indent = line.length - line.trimStart().length;
  return indent <= 3 && trimmed.length >= fence.length && trimmed === fence[0]!.repeat(trimmed.length);
}

/**
 * Блок текста ответа: кусок разметки, схема ```mermaid или живая демонстрация ```html-demo (`index` — номер среди блоков
 * того же вида в тексте).
 */
export type AnswerBlock =
  | { kind: "markdown"; markdown: string }
  | { kind: "diagram"; source: string; markdown: string; index: number }
  | { kind: "demo"; source: string; markdown: string; index: number };

/**
 * Блоки текста ответа. Без схем и демонстраций — как `splitMarkdownBlocks`. С ними блоки ```mermaid и ```html-demo
 * верхнего уровня выделяются отдельно и нумеруются по порядку, тем же разбором, что у слоя поведения (`splitAnswerFences`).
 */
export function splitAnswerBlocks(markdown: string, kinds: { diagrams: boolean; demos?: boolean }): AnswerBlock[] {
  const asMarkdown = (text: string): AnswerBlock[] => splitMarkdownBlocks(text).map((block) => ({ kind: "markdown", markdown: block }));
  if (!kinds.diagrams && !kinds.demos) return asMarkdown(markdown);
  const next = { diagram: 0, demo: 0 };
  return splitAnswerFences(markdown, kinds).flatMap((segment): AnswerBlock[] => {
    if (segment.kind === "markdown") return asMarkdown(segment.markdown);
    const kind = segment.kind === "mermaid" ? "diagram" : "demo";
    return [{ kind, source: segment.source, markdown: segment.markdown, index: next[kind]++ }];
  });
}
