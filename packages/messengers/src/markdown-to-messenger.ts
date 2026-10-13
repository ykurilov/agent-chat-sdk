import type { MessengerName } from "./messenger-adapter";

/**
 * Предел куска с запасом до предела мессенджера: 4096 → 4000 (Telegram, VK), 4000 → 3900 (MAX).
 * Запас нужен на закрывающие и открывающие теги и на то, что мессенджер считает длину по-своему.
 * При маленьком пределе запас не больше половины: 100 → 100, а не 0.
 */
export function chunkLimitFor(textLimit: number): number {
  const hundreds = Math.floor(textLimit / 100) * 100;
  const limit = hundreds === textLimit ? textLimit - 100 : hundreds;
  return limit >= textLimit / 2 ? limit : textLimit;
}

/** Ответ агента (Markdown) → куски для мессенджера в пределах `textLimit` с запасом. */
export function toMessengerChunks(markdown: string, target: { messenger: MessengerName; textLimit: number; liveDemoNote?: string }): string[] {
  const markup = target.messenger === "vk" ? "plain" : "html";
  const options = target.liveDemoNote === undefined ? {} : { liveDemoNote: target.liveDemoNote };
  return splitMessengerText(markdownToMessenger(markdown, target.messenger, options), chunkLimitFor(target.textLimit), markup);
}

/** Живая демонстрация (docs/live-demos.md): код запускается только на сайте. */
const LIVE_DEMO_FENCE = /^\s*```\s*html-demo(?:\s|$)/i;

/**
 * Markdown → HTML Telegram, HTML MAX или простой текст VK. `liveDemoNote` — фраза вместо блока ```html-demo (пустая —
 * блок убирается); нет — блок идёт кодом, как любой другой.
 */
export function markdownToMessenger(markdown: string, messenger: MessengerName, options: { liveDemoNote?: string } = {}): string {
  const flavor: Flavor = messenger === "vk" ? "plain" : messenger === "telegram" ? "telegram" : "max";
  const blocks: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push(renderParagraph(paragraph, flavor));
    paragraph = [];
  };
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      const demo = options.liveDemoNote !== undefined && LIVE_DEMO_FENCE.test(line);
      for (index++; index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? ""); index++) code.push(lines[index] ?? "");
      const body = code.join("\n");
      if (demo) {
        if (options.liveDemoNote) blocks.push(flavor === "plain" ? options.liveDemoNote : escapeHtml(options.liveDemoNote));
      } else blocks.push(flavor === "plain" ? body : `<pre>${escapeHtml(body)}</pre>`);
    } else if (line.trim() === "") {
      flush();
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks.join("\n\n");
}

type Flavor = "telegram" | "max" | "plain";

function renderParagraph(lines: string[], flavor: Flavor): string {
  const quoted = lines.every((line) => /^\s*>/.test(line));
  if (quoted && flavor === "telegram") {
    return `<blockquote>${lines.map((line) => renderLine(line.replace(/^\s*>\s?/, ""), flavor)).join("\n")}</blockquote>`;
  }
  return lines.map((line) => renderLine(line, flavor)).join("\n");
}

function renderLine(line: string, flavor: Flavor): string {
  const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
  if (heading) return flavor === "plain" ? renderInline(heading[1] ?? "", flavor) : `<b>${renderInline(heading[1] ?? "", flavor)}</b>`;
  const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
  if (bullet) return `${bullet[1]}• ${renderInline(bullet[2] ?? "", flavor)}`;
  return renderInline(line, flavor);
}

/** Строчная разметка: код, ссылки, жирный, курсив, зачёркнутый. Код не трогается. */
function renderInline(text: string, flavor: Flavor): string {
  return text
    .split(/(`[^`]+`)/)
    .map((piece, index) => {
      if (index % 2 === 1) {
        const code = piece.slice(1, -1);
        return flavor === "plain" ? code : `<code>${escapeHtml(code)}</code>`;
      }
      return renderEmphasis(piece, flavor);
    })
    .join("");
}

function renderEmphasis(text: string, flavor: Flavor): string {
  const plain = flavor === "plain";
  const wrap = (tag: string) => (_match: string, inner: string) => (plain ? inner : `<${tag}>${inner}</${tag}>`);
  return (plain ? text : escapeHtml(text))
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) => (plain ? `${label} (${url})` : `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`))
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, wrap("b"))
    .replace(/(?<![\w])__(?=\S)(.+?)(?<=\S)__(?![\w])/g, wrap("b"))
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, wrap("s"))
    .replace(/(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])/g, wrap("i"))
    .replace(/(?<![\w])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\w])/g, wrap("i"));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** HTML куска → тот же текст без разметки: когда мессенджер не принял разметку. Ссылка — «текст (адрес)». */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, (_match, url: string, label: string) => `${label} (${url})`)
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

interface Token {
  text: string;
  kind: "text" | "open" | "close";
  /** Имя тега у `open` и `close`. */
  name?: string;
}

/** Текст → неделимые части: тег, знак `&…;`, один символ (пара суррогатов — один символ). */
function tokenize(text: string, markup: "html" | "plain"): Token[] {
  const tokens: Token[] = [];
  const pattern = markup === "html" ? /<\/?([a-z-]+)[^>]*>|&[#a-z0-9]+;|[\s\S]/giu : /[\s\S]/gu;
  for (const match of text.matchAll(pattern)) {
    const piece = match[0];
    if (markup === "html" && piece.startsWith("<") && match[1]) tokens.push({ text: piece, kind: piece.startsWith("</") ? "close" : "open", name: match[1].toLowerCase() });
    else tokens.push({ text: piece, kind: "text" });
  }
  return tokens;
}

const closing = (stack: Token[]) =>
  stack
    .slice()
    .reverse()
    .map((tag) => `</${tag.name}>`)
    .join("");
const reopening = (stack: Token[]) => stack.map((tag) => tag.text).join("");

interface Cut {
  /** Длина куска до места разреза. */
  length: number;
  /** С какой части продолжать следующий кусок. */
  next: number;
  stack: Token[];
  /** 3 — граница абзаца, 2 — строки, 1 — пробел. */
  rank: number;
}

/**
 * Режет текст на куски не длиннее `limit`: по абзацам, иначе по строкам, иначе по пробелам, иначе по знакам.
 * Открытые теги закрываются в конце куска и открываются заново в начале следующего. Пробел на месте разреза
 * отбрасывается, остальное доходит целиком.
 */
export function splitMessengerText(text: string, limit: number, markup: "html" | "plain"): string[] {
  const tokens = tokenize(text, markup);
  const chunks: string[] = [];
  let start = 0;
  let stack: Token[] = [];
  while (start < tokens.length) {
    while (start < tokens.length && tokens[start]?.kind === "text" && /^\s$/u.test(tokens[start]?.text ?? "")) start++;
    if (start >= tokens.length) break;
    const prefix = reopening(stack);
    let body = prefix;
    let current = stack.slice();
    /** Последнее место разреза каждого ранга. */
    const cuts: Array<Cut | undefined> = [];
    let index = start;
    for (; index < tokens.length; index++) {
      const token = tokens[index] as Token;
      if (token.kind === "text" && /^\s$/u.test(token.text) && body.length > prefix.length) {
        const rank = token.text !== "\n" ? 1 : tokens[index + 1]?.text === "\n" || tokens[index - 1]?.text === "\n" ? 3 : 2;
        cuts[rank] = { length: body.replace(/\s+$/u, "").length, next: index + 1, stack: current.slice(), rank };
      }
      const nextStack = token.kind === "open" ? [...current, token] : token.kind === "close" ? withoutLast(current, token.name) : current;
      if (body.length + token.text.length + closing(nextStack).length > limit && body.length > prefix.length) break;
      body += token.text;
      current = nextStack;
    }
    if (index >= tokens.length) {
      chunks.push(body.replace(/\s+$/u, "") + closing(current));
      break;
    }
    const cut = chooseCut(cuts, limit) ?? { length: body.length, next: index, stack: current, rank: 0 };
    chunks.push(body.slice(0, cut.length) + closing(cut.stack));
    start = cut.next;
    stack = cut.stack;
  }
  return chunks.filter((chunk) => chunk.trim() !== "");
}

/** Граница покрупнее, если кусок до неё не короче половины предела; иначе самая крупная из найденных. */
function chooseCut(cuts: Array<Cut | undefined>, limit: number): Cut | undefined {
  const found = [cuts[3], cuts[2], cuts[1]].filter((cut): cut is Cut => cut !== undefined && cut.length > 0);
  return found.find((cut) => cut.length >= limit / 2) ?? found[0];
}

function withoutLast(stack: Token[], name: string | undefined): Token[] {
  const at = stack.map((tag) => tag.name).lastIndexOf(name);
  return at < 0 ? stack : [...stack.slice(0, at), ...stack.slice(at + 1)];
}
