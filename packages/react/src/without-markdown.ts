/*
 * Текст ответа без разметки Markdown — для экранного диктора, которому «**жирный**» зачитали бы со звёздочками.
 * Остаётся то, что видит читатель: заголовки, жирный, курсив, зачёркнутое и код — их слова; ссылка и картинка — текст
 * или подпись; список и цитата — их строки без значков (номера «1.» остаются: диктору они нужны). Обычный текст
 * не трогаем: выделение — только целыми словами (у пробела, скобки, кавычки, знака препинания), поэтому «5*6*7»,
 * «src/*.ts» и имена из кода вроде «__init__» остаются; цитата — «>» с пробелом и не перед числом («> 100 ₽» — это
 * «больше»); решётки в конце снимаются только у заголовка. Скобки, не похожие на ссылку («[1]»), тоже остаются.
 */

const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*(\x60{3}|~{3})/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;
const QUOTE = /^(\s{0,3}>(?: (?!\d)|$))+/;
/** До открывающего знака выделения — начало, пробел, открывающая скобка или кавычка; после закрывающего — конец,
 * пробел, закрывающая скобка, кавычка или знак препинания. */
const OPEN = String.raw`(?<=^|[\s(\[«"'„“])`;
const CLOSE = String.raw`(?=$|[\s)\]»"'”.,;:!?…])`;
/** Выделение знаком `sign` (`count` раз): внутри у краёв не пробел и не тот же знак. */
const emphasis = (sign: "*" | "_" | "~", count: number, notBefore = "") => {
  const escaped = sign === "*" ? "\\*" : sign;
  const marker = escaped.repeat(count);
  return new RegExp(`${OPEN}${marker}${notBefore}(?=[^\\s${escaped}])(.+?)(?<=[^\\s${escaped}])${marker}${CLOSE}`, "gu");
};
const BOLD = emphasis("*", 2);
/** Двойные подчёркивания вокруг латинского имени — имя из кода («__init__»), а не жирный. */
const BOLD_UNDERSCORE = emphasis("_", 2, "(?![A-Za-z0-9_]+__)");
const STRIKE = emphasis("~", 2);
const ITALIC = emphasis("*", 1);
const ITALIC_UNDERSCORE = emphasis("_", 1);

export function withoutMarkdown(markdown: string): string {
  let inCode = false;
  const lines: string[] = [];
  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) lines.push(line);
    else if (!RULE.test(line)) lines.push(plainLine(line));
  }
  return lines.join("\n");
}

function plainLine(line: string): string {
  return inline(
    line
      .replace(HEADING, "$1")
      .replace(QUOTE, "")
      .replace(/^(\s*)[-*+]\s+(?:\[[ xX]\]\s+)?/, "$1"),
  );
}

function inline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]+)`+/g, "$1")
    .replace(BOLD, "$1")
    .replace(BOLD_UNDERSCORE, "$1")
    .replace(STRIKE, "$1")
    .replace(ITALIC, "$1")
    .replace(ITALIC_UNDERSCORE, "$1");
}
