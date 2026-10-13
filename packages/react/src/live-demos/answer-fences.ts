/** Кусок текста ответа: обычная разметка, схема ```mermaid или живая демонстрация ```html-demo. */
export type AnswerSegment =
  | { kind: "markdown"; markdown: string }
  /** `source` — текст блока без ограждений; `closed` — блок закрыт; `markdown` — блок целиком, как в тексте. */
  | { kind: "mermaid" | "demo"; source: string; closed: boolean; markdown: string };

/** Какие блоки выделять: схемы (`diagrams`) и живые демонстрации (`demos`). Остальные остаются разметкой. */
export interface AnswerFenceKinds {
  diagrams?: boolean;
  demos?: boolean;
}

/** Язык блока живой демонстрации. */
export const LIVE_DEMO_LANGUAGE = "html-demo";

// \x60 — обратная кавычка: блок кода открывают три и больше «`» или «~» с отступом не больше трёх пробелов.
const FENCE_OPENING = /^( {0,3})(\x60{3,}|~{3,})(.*)$/;

function closesFence(line: string, fence: string): boolean {
  const trimmed = line.trim();
  const indent = line.length - line.trimStart().length;
  return indent <= 3 && trimmed.length >= fence.length && trimmed === fence[0]!.repeat(trimmed.length);
}

/** Строка без пустых строк по краям; отступ первой строки не трогается (код с отступом). */
const withoutBlankEdges = (text: string) => text.replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, "");

function specialKind(language: string | undefined, kinds: AnswerFenceKinds): "mermaid" | "demo" | null {
  if (language === "mermaid" && kinds.diagrams) return "mermaid";
  if (language === LIVE_DEMO_LANGUAGE && kinds.demos) return "demo";
  return null;
}

/**
 * Делит Markdown на обычные куски и блоки ```mermaid и ```html-demo верхнего уровня (по правилам ограждений CommonMark):
 * блок внутри другого блока кода и блок с отступом в четыре пробела — обычный код. Номер блока — его порядок среди
 * кусков того же вида; им скин зовёт `renderDiagram`/`renderDemo`, и слой поведения считает так же.
 */
export function splitAnswerFences(markdown: string, kinds: AnswerFenceKinds): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let plain: string[] = [];
  let otherFence: string | null = null;
  let block: { kind: "mermaid" | "demo"; fence: string; indent: number; lines: string[]; source: string[] } | null = null;

  const flushPlain = () => {
    const text = withoutBlankEdges(plain.join("\n"));
    if (text.trim()) segments.push({ kind: "markdown", markdown: text });
    plain = [];
  };
  const finishBlock = (closed: boolean) => {
    if (!block) return;
    segments.push({ kind: block.kind, source: block.source.join("\n"), closed, markdown: block.lines.join("\n") });
    block = null;
  };

  for (const line of markdown.split("\n")) {
    if (block) {
      block.lines.push(line);
      if (closesFence(line, block.fence)) finishBlock(true);
      else block.source.push(line.replace(new RegExp(`^ {0,${block.indent}}`), ""));
      continue;
    }
    if (otherFence) {
      plain.push(line);
      if (closesFence(line, otherFence)) otherFence = null;
      continue;
    }
    const opening = FENCE_OPENING.exec(line);
    if (!opening) {
      plain.push(line);
      continue;
    }
    const [, indent = "", fence = "", info = ""] = opening;
    const kind = specialKind(info.trim().split(/\s+/)[0]?.toLowerCase(), kinds);
    if (kind && !(fence.startsWith("\x60") && info.includes("\x60"))) {
      flushPlain();
      block = { kind, fence, indent: indent.length, lines: [line], source: [] };
    } else {
      otherFence = fence;
      plain.push(line);
    }
  }
  finishBlock(false);
  flushPlain();
  return segments;
}
