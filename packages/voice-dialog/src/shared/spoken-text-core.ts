/**
 * Говоримый текст: приращения текста ответа → готовые к озвучке предложения (см. docs/contracts/voice-dialog/spoken-text.md).
 * Разметка не читается, блоки кода, схемы ```mermaid и таблицы заменяются короткой фразой, первое предложение выходит как можно раньше.
 * Работа построчная: законченные строки разбираются один раз, недописанная строка разбирается заново на каждом куске,
 * поэтому результат не зависит от того, как ответ порезан на куски.
 * Теги голоса («[laughs]») идут в озвучку как есть и считаются знаками, но не становятся отдельным предложением
 * (ElevenLabs отвергает текст из одних тегов и обрывает всю реплику): тег без слов приклеивается к следующему тексту,
 * а тег в самом конце ответа («Да. [laughs]») — к последнему предложению, и смех в конце звучит. Чтобы это успеть,
 * предложение, за которым идут одни теги (или начало тега), ждёт, чем кончится дело; тег на своей последней строке,
 * когда предложение до него уже ушло с прежней строкой, не озвучивается.
 */
/** Снятие тегов голоса: в браузере — копия правила из экрана, на сервере — из ядра (согласие копий держит `voice-tag-rule.test.ts`). */
export type StripVoiceTags = (text: string, options?: { partialTail?: boolean }) => string;

export interface SpokenSentence {
  text: string;
  /** Где предложение начинается и где кончается (после знака) в тексте ответа, поданном в `push`. */
  sourceStart: number;
  sourceEnd: number;
}

export interface SpokenPhrases {
  code: string;
  /** Блок ```mermaid: схему на экране не зачитывать. */
  diagram: string;
  table: string;
  more: string;
}

export interface SpokenTextOptions {
  /** Потолок озвученных знаков на ответ; дальше — одна фраза `phrases.more` и тишина. По умолчанию 1500. */
  maxChars?: number;
  phrases?: Partial<SpokenPhrases>;
}

export interface SpokenText {
  push(delta: string): SpokenSentence[];
  finish(): SpokenSentence[];
}

const DEFAULT_MAX_CHARS = 1500;
const DEFAULT_PHRASES: SpokenPhrases = { code: "код на экране", diagram: "схема на экране", table: "таблица на экране", more: "Дальше на экране." };
/** Первое предложение режется по запятой или тире, если в нём уже не меньше стольких слов. */
const FIRST_CUT_WORDS = 12;

export function createSpokenTextWith(stripVoiceTags: StripVoiceTags, options: SpokenTextOptions = {}): SpokenText {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const phrases = { ...DEFAULT_PHRASES, ...options.phrases };
  let buffer = "";
  let lineStart = 0;
  let fence: Fence | null = null;
  let inTable = false;
  let charsSpoken = 0;
  let emittedTotal = 0;
  let emittedBeforeLine = 0;
  let emittedInLine = 0;
  let capped = false;
  /** Теги без слов с прошлых строк: ждут следующего текста. */
  let carriedTags: SpokenSentence | null = null;
  /** Последнее предложение, за которым идут одни теги: ждёт, не придёт ли следом текст (тогда оно уходит первым) или конец ответа (тогда теги клеятся к нему). */
  let held: SpokenSentence | null = null;

  function emit(candidate: SpokenSentence, out: SpokenSentence[]) {
    if (capped) return;
    if (charsSpoken >= maxChars) {
      capped = true;
      out.push({ text: phrases.more, sourceStart: candidate.sourceStart, sourceEnd: candidate.sourceStart });
      return;
    }
    charsSpoken += candidate.text.length;
    emittedTotal += 1;
    out.push(candidate);
  }

  function phrase(text: string, line: string, base: number): SpokenSentence {
    const sourceStart = base + (line.length - line.trimStart().length);
    return { text, sourceStart, sourceEnd: base + line.trimEnd().length };
  }

  /** Предложения строки и признак «после последнего идут одни теги». Состояние (блок кода, таблица) меняется только у законченной строки. */
  function analyze(rawLine: string, base: number, final: boolean): { sentences: SpokenSentence[]; tagsTrail: boolean } {
    const none = (sentences: SpokenSentence[] = []) => ({ sentences, tagsTrail: false });
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (fence) {
      if (final && closesFence(line, fence)) fence = null;
      return none();
    }
    const opening = openingFence(line);
    if (opening) {
      if (!final) return none();
      fence = opening;
      inTable = false;
      return none([phrase(opening.diagram ? phrases.diagram : phrases.code, line, base)]);
    }
    if (line.trim() === "") {
      if (final) inTable = false;
      return none();
    }
    if (isTableRow(line)) {
      if (!final) return none();
      const announce = !inTable;
      inTable = true;
      return none(announce ? [phrase(phrases.table, line, base)] : []);
    }
    if (final) inTable = false;
    if (HORIZONTAL_RULE.test(line)) return none();

    const { bodyOffset, body } = stripLinePrefix(line);
    const safe = final ? body : body.slice(0, openConstructStart(body));
    const sentences: SpokenSentence[] = [];
    const ranges = splitSentences(safe, final, emittedBeforeLine === 0);
    for (const range of ranges) {
      const text = cleanMarkup(safe.slice(range.start, range.end));
      if (text) sentences.push({ text, sourceStart: base + bodyOffset + range.start, sourceEnd: base + bodyOffset + range.end });
    }
    // В недописанной строке: после последнего предложения идут только теги (или начало тега, в том числе знаки курсива) — ждём, что будет дальше.
    const rest = body.slice(ranges.at(-1)?.end ?? 0);
    const mayBeTag = rest.includes("[") || /^[\s*_~]+$/.test(rest);
    const tagsTrail = !final && sentences.length > 0 && mayBeTag && !/[\p{L}\p{N}]/u.test(stripVoiceTags(rest, { partialTail: true }));
    return { sentences, tagsTrail };
  }

  function handleLine(line: string, base: number, final: boolean, out: SpokenSentence[]) {
    const analyzed = analyze(line, base, final);
    const { sentences, waiting } = attachTags(stripVoiceTags, analyzed.sentences, carriedTags);
    // Последнее предложение строки ждёт, пока за ним одни теги: если следом придёт текст, оно уйдёт первым, если конец — теги прилипнут к нему.
    const holdLast = sentences.length > 0 && (analyzed.tagsTrail || waiting !== null);
    const ready = holdLast ? sentences.slice(0, -1) : sentences;
    if (sentences.length > 0 && held) {
      emit(held, out);
      held = null;
    }
    for (const sentence of ready.slice(emittedInLine)) emit(sentence, out);
    emittedInLine = final ? 0 : ready.length;
    if (final) {
      carriedTags = waiting;
      if (holdLast) held = sentences.at(-1)!;
    }
  }

  function drain(final: boolean): SpokenSentence[] {
    const out: SpokenSentence[] = [];
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      handleLine(buffer.slice(0, newline), lineStart, true, out);
      lineStart += newline + 1;
      buffer = buffer.slice(newline + 1);
      emittedBeforeLine = emittedTotal;
      newline = buffer.indexOf("\n");
    }
    if (buffer) handleLine(buffer, lineStart, final, out);
    if (final) buffer = "";
    return out;
  }

  return {
    push(delta) {
      if (capped) return [];
      buffer += delta;
      return drain(false);
    },
    finish() {
      if (capped) return [];
      const out = drain(true);
      if (held) {
        emit(carriedTags ? joinSentences(held, carriedTags) : held, out);
        held = null;
        carriedTags = null;
      }
      return out;
    },
  };
}

/** В предложении нет ничего, кроме тегов голоса и знаков препинания. */
function onlyTags(stripVoiceTags: StripVoiceTags, text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(stripVoiceTags(text));
}

function joinSentences(first: SpokenSentence, second: SpokenSentence): SpokenSentence {
  return { text: `${first.text} ${second.text}`, sourceStart: first.sourceStart, sourceEnd: second.sourceEnd };
}

/** Предложения без слов склеиваются со следующим; `waiting` — теги, которым следующего текста в этой строке не нашлось. */
function attachTags(stripVoiceTags: StripVoiceTags, sentences: SpokenSentence[], carried: SpokenSentence | null): { sentences: SpokenSentence[]; waiting: SpokenSentence | null } {
  const attached: SpokenSentence[] = [];
  let waiting = carried;
  for (const sentence of sentences) {
    if (onlyTags(stripVoiceTags, sentence.text)) {
      waiting = waiting ? joinSentences(waiting, sentence) : sentence;
    } else {
      attached.push(waiting ? joinSentences(waiting, sentence) : sentence);
      waiting = null;
    }
  }
  return { sentences: attached, waiting };
}

/** Позиция в тексте ответа по числу озвученных знаков; предложения считаются склеенными через пробел, внутри предложения — пропорционально. */
export function sourcePositionAtSpoken(sentences: SpokenSentence[], spokenChars: number): number {
  let offset = 0;
  for (const sentence of sentences) {
    const end = offset + sentence.text.length;
    if (spokenChars <= end) {
      const share = Math.max(0, spokenChars - offset) / sentence.text.length;
      return Math.round(sentence.sourceStart + share * (sentence.sourceEnd - sentence.sourceStart));
    }
    offset = end + 1;
  }
  return sentences.length > 0 ? sentences[sentences.length - 1]!.sourceEnd : 0;
}

// ─── строки ────────────────────────────────────────────────────────────────

interface Fence {
  char: string;
  length: number;
  /** Язык блока — mermaid: это схема, а не код. */
  diagram: boolean;
}

const HORIZONTAL_RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?(?:\s*\|\s*:?-{2,}:?)*\s*\|?\s*$/;

function openingFence(line: string): Fence | null {
  const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const marks = match[1]!;
  // «```код```» в одной строке — строчный код, а не блок
  if (marks[0] === "`" && match[2]!.includes("`")) return null;
  return { char: marks[0]!, length: marks.length, diagram: match[2]!.trim().split(/\s+/)[0]!.toLowerCase() === "mermaid" };
}

function closesFence(line: string, fence: Fence): boolean {
  const match = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return match !== null && match[1]![0] === fence.char && match[1]!.length >= fence.length;
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim().replace(/`[^`]*`/g, "");
  if (!trimmed.includes("|")) return false;
  if (trimmed.startsWith("|") || trimmed.endsWith("|") || TABLE_SEPARATOR.test(trimmed)) return true;
  return trimmed.split("|").length > 2;
}

/** Убирает знаки цитаты, заголовка и списка в начале строки; `bodyOffset` — где начинается смысловой текст. */
function stripLinePrefix(line: string): { bodyOffset: number; body: string } {
  let offset = 0;
  const advance = (pattern: RegExp): boolean => {
    const match = pattern.exec(line.slice(offset));
    if (!match) return false;
    offset += match[0].length;
    return true;
  };
  advance(/^\s{0,3}(?:>\s?)+/);
  if (!advance(/^\s{0,3}#{1,6}\s+/) && advance(/^\s*(?:[-*+]|\d{1,9}[.)])\s+/)) advance(/^\[[ xX]\]\s+/);
  let body = line.slice(offset);
  const closing = /\s+#+\s*$/.exec(body);
  if (closing && /^\s{0,3}#{1,6}\s/.test(line)) body = body.slice(0, closing.index);
  return { bodyOffset: offset, body };
}

// ─── разбор строки на предложения ──────────────────────────────────────────

interface Range {
  start: number;
  end: number;
}

const TERMINATORS = /[.!?…]/;
const CLOSERS = /["'»”’)\]*_~`]/;
const DASHES = new Set(["—", "–", "-"]);
const isSpace = (char: string | undefined) => char !== undefined && /\s/.test(char);

/** Однобуквенные сокращения и сокращения слов: после их точки предложение не заканчивается. */
const ABBREVIATIONS = new Set([
  "др", "пр", "тд", "тп", "тк", "гг", "ул", "стр", "рис", "см", "напр", "руб", "тыс", "млн", "млрд", "им", "проф", "ст", "вв",
  "обл", "кв", "корп", "англ", "мр", "mr", "mrs", "dr", "vs", "etc", "fig", "pp",
]);
const LOWERCASE_LETTER_ABBREVIATIONS = new Set([..."тедпкгрнэ", ..."egip"]);

function isAbbreviation(word: string): boolean {
  if (word.length === 0) return false;
  const lower = word.toLowerCase();
  if (ABBREVIATIONS.has(lower)) return true;
  if (word.length !== 1) return false;
  return word !== lower || LOWERCASE_LETTER_ABBREVIATIONS.has(word);
}

function wordBefore(body: string, end: number): string {
  let start = end;
  while (start > 0 && /[\p{L}\p{N}]/u.test(body[start - 1]!)) start--;
  return body.slice(start, end);
}

/**
 * Границы предложений в строке. Конец предложения — знак конца и следом пробел; знак в самом конце недописанной строки
 * ждёт следующего символа. Внутри строчного кода, ссылок и адресов знаки не считаются.
 * Первое предложение ответа режется по запятой или тире, если в нём уже достаточно слов.
 */
function splitSentences(body: string, final: boolean, firstOpen: boolean): Range[] {
  const shielded = shieldedMask(body);
  const ranges: Range[] = [];
  let start = skipSpaces(body, 0);
  let cutAllowed = firstOpen;
  // В недописанной строке за разрезом одни пробелы: ждём, что придёт следом (за предложением может идти тег).
  const waitsForMore = (from: number) => !final && skipSpaces(body, from) >= body.length;

  const cut = (end: number, next: number) => {
    ranges.push({ start, end });
    start = skipSpaces(body, next);
    cutAllowed = false;
  };
  const wordsSinceStart = (end: number) => body.slice(start, end).trim().split(/\s+/).length;

  let i = start;
  while (i < body.length) {
    const char = body[i]!;
    if (shielded[i]) {
      i++;
      continue;
    }
    if (TERMINATORS.test(char)) {
      let end = i + 1;
      while (end < body.length && TERMINATORS.test(body[end]!)) end++;
      const marks = body.slice(i, end);
      let after = end;
      while (after < body.length && CLOSERS.test(body[after]!)) after++;
      if (after >= body.length) break; // ждём следующий символ (или конец ответа)
      if (waitsForMore(after)) break;
      if (isSpace(body[after]) && !(marks === "." && isAbbreviation(wordBefore(body, i)))) cut(after, after);
      i = after;
      continue;
    }
    if (cutAllowed && char === "," && isSpace(body[i + 1]) && !waitsForMore(i + 1) && wordsSinceStart(i) >= FIRST_CUT_WORDS) {
      cut(i + 1, i + 1);
    } else if (cutAllowed && isSpace(char) && DASHES.has(body[i + 1] ?? "") && isSpace(body[i + 2]) && !waitsForMore(i + 2) && wordsSinceStart(i) >= FIRST_CUT_WORDS) {
      cut(body.slice(0, i).trimEnd().length, i + 2);
    }
    i++;
  }
  if (final && start < body.length) {
    const end = body.trimEnd().length;
    if (end > start) ranges.push({ start, end });
  }
  return ranges.filter((range) => range.end > range.start);
}

function skipSpaces(body: string, from: number): number {
  let i = from;
  while (i < body.length && isSpace(body[i])) i++;
  return i;
}

/** Куски, внутри которых знаки конца предложения не считаются: строчный код, ссылки, изображения, адреса. */
function shieldedMask(body: string): Uint8Array {
  const mask = new Uint8Array(body.length);
  const shield = (start: number, end: number) => mask.fill(1, start, end);
  for (const match of body.matchAll(/!?\[[^\]]*\]\([^)]*\)|<https?:[^>\s]*>|(?:https?:\/\/|www\.)[^\s<>]*[^\s<>.,;:!?)"'»]/g)) {
    shield(match.index, match.index + match[0].length);
  }
  let i = 0;
  while (i < body.length) {
    if (body[i] !== "`") {
      i++;
      continue;
    }
    const closed = closingBackticks(body, i);
    if (closed === null) {
      i = skipBackticks(body, i);
      continue;
    }
    shield(i, closed);
    i = closed;
  }
  return mask;
}

function skipBackticks(body: string, from: number): number {
  let i = from;
  while (body[i] === "`") i++;
  return i;
}

/** Конец строчного кода, открытого на `open` (после закрывающих кавычек), или `null`, если не закрыт. */
function closingBackticks(body: string, open: number): number | null {
  const length = skipBackticks(body, open) - open;
  let i = open + length;
  while (i < body.length) {
    if (body[i] !== "`") {
      i++;
      continue;
    }
    const end = skipBackticks(body, i);
    if (end - i === length) return end;
    i = end;
  }
  return null;
}

/** Где в недописанной строке начинается незакрытая конструкция (код, ссылка, тег); до неё разбирать можно. Нет такой — длина строки. */
function openConstructStart(body: string): number {
  let i = 0;
  while (i < body.length) {
    const char = body[i]!;
    if (char === "`") {
      const closed = closingBackticks(body, i);
      if (closed === null) return i;
      i = closed;
    } else if (char === "[" || (char === "!" && body[i + 1] === "[")) {
      const open = body.indexOf("[", i);
      const close = body.indexOf("]", open);
      if (close < 0 || close === body.length - 1) return i;
      if (body[close + 1] === "(") {
        const end = body.indexOf(")", close);
        if (end < 0) return i;
        i = end + 1;
      } else {
        i = close + 1;
      }
    } else if (char === "<" && /[A-Za-z/!]/.test(body[i + 1] ?? "")) {
      const end = body.indexOf(">", i);
      if (end < 0) return i;
      i = end + 1;
    } else {
      i++;
    }
  }
  return body.length;
}

// ─── очистка разметки ──────────────────────────────────────────────────────

/** Смысловой текст без разметки; пусто, если букв и цифр не осталось. */
function cleanMarkup(raw: string): string {
  const text = raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<https?:[^>\s]*>/g, " ")
    .replace(/(?:https?:\/\/|www\.)[^\s<>]*[^\s<>.,;:!?)"'»]/g, " ")
    .replace(/(`+)([^`]+?)\1/g, "$2")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/\\([*_`#~])/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/~~/g, "")
    .replace(/\*/g, "")
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : "";
}
