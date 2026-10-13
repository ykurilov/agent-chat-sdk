/*
 * Теги голоса: в голосовом режиме модель ставит в ответ теги ElevenLabs в квадратных скобках — «[laughs]»,
 * «[whispers]», «[warm, quiet voice]». Голос их отыгрывает, а на экране, в копии, в сводках и поиске их быть не должно.
 * Копия правила в экране (`@ykurilov/agent-chat-react`) совпадает с этой: ядро браузеру не нужно, экран ядра не знает.
 * Согласие копий держит тест в пакете voice-dialog.
 *
 * Тег — латинские буквы, пробелы, запятые и дефисы между ними (строчные, либо слово с заглавной буквы:
 * «[Laughs]»), от 3 до 40 знаков, не больше шести слов; допустим и закрывающий «[/whispers]». Вплотную к слову тег тоже
 * тег («ну[sighs]»): голос так его и отыгрывает. Курсив и жирный вокруг тега («*[laughs]*») уходят вместе с ним.
 * Всё остальное — обычные скобки и остаётся: «[1]», «[x]», «[ ]», «[TODO]», «[смеётся]», «[sic]»,
 * ссылки Markdown «[текст](адрес)» и «[текст][ссылка]», определения ссылок «[ссылка]: адрес», строчный код и блоки кода.
 *
 * Правило применяется там, где человек видит ответ голосового хода: в тексте голосового ответа теги слышны, но не видны.
 * В ответах текстового режима и в сводках сжатия оно не применяется: там скобки — обычный текст.
 */

export interface VoiceTagOptions {
  /** Недописанный тег в конце текста («[laug») тоже вырезается: так в потоке ответа тег не мелькает на экране. */
  partialTail?: boolean;
}

/** Тег, найденный в тексте: `at` — место в тексте без тегов, где он стоял. */
export interface VoiceTagMatch {
  at: number;
  name: string;
}

export interface SplitVoiceTags {
  /** Текст без тегов: рядом стоявший пробел убран, остальное не изменено. */
  plain: string;
  tags: VoiceTagMatch[];
}

const MIN_LETTERS = 3;
const MAX_LENGTH = 40;
const MAX_WORDS = 6;
/** Латинские слова в скобках, которые тегами голоса не бывают. */
const NOT_TAGS = new Set(["sic", "ibid", "note", "todo", "edit", "link"]);

const CANDIDATE = /\[(\/?[A-Za-z ,-]{1,40})\]/g;
const PARTIAL_TAIL = /\[\/?[A-Za-z ,-]{0,40}$/;
const HORIZONTAL_SPACE = new Set([" ", "\t"]);
/** Знаки курсива, жирного и зачёркивания: тег в них уходит вместе со знаками. */
const EMPHASIS = new Set(["*", "_", "~"]);

interface Span {
  start: number;
  end: number;
  /** `null` — недописанный тег. */
  name: string | null;
}

function isTagBody(body: string): boolean {
  const name = body.startsWith("/") ? body.slice(1) : body;
  if (name.length > MAX_LENGTH || name !== name.trim() || !/^[A-Za-z]+(?:[ ,-]+[A-Za-z]+)*$/.test(name)) return false;
  if (name.replace(/[^A-Za-z]/g, "").length < MIN_LETTERS) return false;
  if (name.split(/[ ,-]+/).length > MAX_WORDS) return false;
  // Строчные слова или первое слово с заглавной буквы («Laughs», «Warm, quiet voice»); «TODO», «WIP» — не теги.
  if (name !== name.toLowerCase() && !/^[A-Z][a-z]*(?:[ ,-]+[a-z]+)*$/.test(name)) return false;
  return !NOT_TAGS.has(name.toLowerCase());
}

/** Тег не стоит впритык к закрытой скобке («[a][ref]») и не открывает ссылку или определение. */
function standsAlone(text: string, start: number, end: number): boolean {
  const before = text[start - 1];
  if (before !== undefined && /[\])]/.test(before)) return false;
  const after = text[end];
  return after === undefined || !"([:".includes(after);
}

/** Знаки курсива и жирного, которые обнимают тег с двух сторон («*[laughs]*», «_[sighs]_»): сколько их уходит вместе с тегом. */
function emphasisAround(text: string, start: number, end: number): number {
  let left = start;
  while (left > 0 && EMPHASIS.has(text[left - 1]!)) left--;
  // Подчёркивание внутри слова («snake_[tag]») — не курсив.
  if (left > 0 && /[\p{L}\p{N}]/u.test(text[left - 1]!)) return 0;
  let right = end;
  while (right < text.length && EMPHASIS.has(text[right]!)) right++;
  let paired = 0;
  while (paired < start - left && paired < right - end && text[start - 1 - paired] === text[end + paired]) paired++;
  return paired;
}

/** Знаки, которые в тексте не трогаем: строчный код и блоки кода. */
function codeMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  let fence: { char: string; length: number } | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    const lineEnd = offset + line.length;
    if (fence) {
      mask.fill(1, offset, lineEnd);
      const closing = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (closing && closing[1]![0] === fence.char && closing[1]!.length >= fence.length) fence = null;
    } else {
      const opening = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (opening && !(opening[1]![0] === "`" && opening[2]!.includes("`"))) {
        mask.fill(1, offset, lineEnd);
        fence = { char: opening[1]![0]!, length: opening[1]!.length };
      } else {
        maskInlineCode(line, offset, mask);
      }
    }
    offset = lineEnd + 1;
  }
  return mask;
}

function maskInlineCode(line: string, offset: number, mask: Uint8Array): void {
  const runEnd = (from: number) => {
    let i = from;
    while (line[i] === "`") i++;
    return i;
  };
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    const openEnd = runEnd(i);
    let search = openEnd;
    let closeEnd = -1;
    while (search < line.length) {
      if (line[search] !== "`") {
        search++;
        continue;
      }
      const end = runEnd(search);
      if (end - search === openEnd - i) {
        closeEnd = end;
        break;
      }
      search = end;
    }
    if (closeEnd < 0) {
      i = openEnd;
      continue;
    }
    mask.fill(1, offset + i, offset + closeEnd);
    i = closeEnd;
  }
}

function findSpans(text: string, partialTail: boolean): Span[] {
  const mask = codeMask(text);
  const spans: Span[] = [];
  for (const match of text.matchAll(CANDIDATE)) {
    const start = match.index;
    const end = start + match[0].length;
    if (mask[start] || !isTagBody(match[1]!) || !standsAlone(text, start, end)) continue;
    const wrap = emphasisAround(text, start, end);
    spans.push({ start: start - wrap, end: end + wrap, name: match[1]!.replace(/\s+/g, " ").trim().toLowerCase() });
  }
  if (partialTail) {
    const tail = PARTIAL_TAIL.exec(text);
    if (tail && !mask[tail.index] && standsAlone(text, tail.index, text.length) && !spans.some((span) => span.end > tail.index)) {
      spans.push({ start: tail.index, end: text.length, name: null });
    }
  }
  return spans;
}

/** Длина перевода строки («\n» или «\r\n») в позиции `at`; 0 — там не конец строки. */
function lineBreakLength(text: string, at: number): number {
  if (text[at] === "\n") return 1;
  return text[at] === "\r" && text[at + 1] === "\n" ? 2 : 0;
}

/** Длина перевода строки, оканчивающегося перед позицией `at` (там стоит «\n»; перед ним может быть «\r»). */
function lineBreakBefore(text: string, at: number): number {
  return text[at - 2] === "\r" ? 2 : 1;
}

/** Теги, стоящие подряд (между ними только пробелы), вырезаются вместе: правило пробелов одно на всю цепочку. */
function groupSpans(text: string, spans: Span[]): Span[][] {
  const groups: Span[][] = [];
  for (const span of spans) {
    const last = groups.at(-1);
    const previous = last?.at(-1);
    if (last && previous && [...text.slice(previous.end, span.start)].every((char) => HORIZONTAL_SPACE.has(char))) last.push(span);
    else groups.push([span]);
  }
  return groups;
}

/** Текст без тегов голоса и список вырезанных тегов с их местом. */
export function splitVoiceTags(text: string, options: VoiceTagOptions = {}): SplitVoiceTags {
  if (!text.includes("[")) return { plain: text, tags: [] };
  const groups = groupSpans(text, findSpans(text, options.partialTail === true));
  if (groups.length === 0) return { plain: text, tags: [] };
  let plain = "";
  let copied = 0;
  const tags: VoiceTagMatch[] = [];
  for (const group of groups) {
    const start = group[0]!.start;
    const end = group.at(-1)!.end;
    let spaceBefore = start;
    while (spaceBefore > 0 && HORIZONTAL_SPACE.has(text[spaceBefore - 1]!)) spaceBefore--;
    let spaceAfter = end;
    while (spaceAfter < text.length && HORIZONTAL_SPACE.has(text[spaceAfter]!)) spaceAfter++;
    const lineBreakAfter = lineBreakLength(text, spaceAfter);
    const lineStart = spaceBefore === 0 || text[spaceBefore - 1] === "\n";
    const lineEnd = spaceAfter === text.length || lineBreakAfter > 0;
    const beforePunctuation = spaceAfter < text.length && /[.,!?…;:)\]»”]/.test(text[spaceAfter]!);
    const glued = spaceBefore === start && !lineStart && /[\p{L}\p{N}]/u.test(text[start - 1] ?? "");

    let cutFrom = start;
    let cutTo = spaceAfter;
    let filler = "";
    if (lineStart && lineEnd) {
      // Тег один на строке: уходит вся строка вместе с одним переводом.
      cutFrom = spaceBefore;
      if (lineBreakAfter > 0) cutTo = spaceAfter + lineBreakAfter;
      else if (spaceBefore > 0) cutFrom = spaceBefore - lineBreakBefore(text, spaceBefore);
    } else if (lineEnd || beforePunctuation) {
      cutFrom = spaceBefore;
    } else if (glued) {
      // «ну[sighs] ещё»: пробел справа остаётся; «ну[sighs]ещё»: слова не склеиваются.
      if (spaceAfter > end) cutTo = end;
      else if (/[\p{L}\p{N}]/u.test(text[end] ?? "")) filler = " ";
    }
    plain += text.slice(copied, cutFrom);
    for (const span of group) if (span.name !== null) tags.push({ at: plain.length, name: span.name });
    plain += filler;
    copied = cutTo;
  }
  plain += text.slice(copied);
  return { plain, tags };
}

/** Текст без тегов голоса. */
export function stripVoiceTags(text: string, options: VoiceTagOptions = {}): string {
  return splitVoiceTags(text, options).plain;
}
