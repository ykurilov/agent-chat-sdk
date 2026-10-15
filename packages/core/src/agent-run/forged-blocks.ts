import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import type { LanguageModel } from "ai";
import type { AgentChatMessage } from "../conversation/types";
import { closesCodeFence, codeFenceOf, isIndentedCodeOrQuote } from "../text/markdown-code";
import { TOOL_ENDED_NOTE } from "./end-turn";
import { GREETING_LEAD } from "./greeting-lead";
import { LENGTH_CUT_NOTE } from "./length-cut";
import { UNANSWERED_NOTE } from "./unanswered-messages";

type MessagePart = AgentChatMessage["parts"][number];

/**
 * Формат служебного блока, который SDK или приложение кладёт в запрос модели. Модель иногда повторяет такой блок в своём
 * ответе (дописала человеку «блок памяти» с номером заметки) — повтор вырезается.
 * - `{ tag }` — блок `<tag …>…</tag>`. Открывающий тег — с начала строки (до трёх пробелов), а после него в той же
 *   строке — ничего, начало данных (`[`, `{`, `"`) или закрывающий тег: тег посреди фразы или с пояснением («— это …») —
 *   упоминание. Закрывающий — где угодно после; нет его — блок до первой пустой строки. Закрывающий тег без
 *   открывающего не трогается.
 * - `{ name, line }` — служебная строка: начинается с `line` (с начала строки), а если задан `match` — вся строка (без
 *   отступа и пробелов в конце) подходит под него. `until: "paragraph"` — блок до пустой строки; `until: RegExp` — до
 *   строки, которая подходит под выражение, включительно.
 * Код (блоки ```, отступ в 4 пробела) и цитаты (`> …`) не смотрятся: там блок — пример по просьбе. Теги не режутся
 * и там, где ответ подаёт блок как пример (строка перед ним — «Формат такой:», «например:», «выглядит так:»), и в
 * ответе на вопрос о тегах и форматах (`explainsServiceFormats`).
 */
export type ServiceBlockFormat = { tag: string } | { name: string; line: string; match?: RegExp; until?: RegExp | "paragraph" };

const CHANNEL_NOTE_LINES = [
  "Разговор снова в веб-приложении: обычная разметка и инструменты страницы доступны.",
  "Разговор идёт в Telegram. Пиши обычным Markdown: его переведут в разметку Telegram. Таблиц и схем там нет — вместо них списки. Отвечай короче, чем в вебе.",
  "Разговор идёт во ВКонтакте. Разметки там нет: Markdown превратится в простой текст. Пиши простым текстом и списками, без таблиц и схем. Отвечай короче, чем в вебе.",
  "Разговор идёт в MAX. Пиши обычным Markdown: его переведут в разметку MAX. Таблиц и схем там нет — вместо них списки. Отвечай короче, чем в вебе.",
];

const exactly = (text: string): RegExp => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/**
 * Служебные блоки ядра. Пакеты добавляют свои (`LongTermMemory.serviceBlocks`, `MessageAttachments.serviceBlocks`,
 * `withSkills`, `flow.withChat`), приложение — `agent.serviceBlocks`. Дата («Сегодня: …») и уведомления о фоновых
 * задачах сюда не входят: такие слова модель законно пишет человеку сама.
 */
export const CORE_SERVICE_BLOCKS: readonly ServiceBlockFormat[] = [
  { tag: "conversation_summary" },
  { tag: "answer_progress" },
  { tag: "screen_place" },
  { name: "service_note", line: "[Служебная пометка приложения", match: /^\[Служебная пометка приложения, человек её не писал и не видит: .+\]$/ },
  { name: "context_gone", line: "[Больше не действует: «", match: /^\[Больше не действует: «[^»\n]+»(?:, «[^»\n]+»)*\]$/ },
  { name: "context_hidden", line: "[Не показано ради места, но по-прежнему действует: «", match: /^\[Не показано ради места, но по-прежнему действует: «[^»\n]+»(?:, «[^»\n]+»)*\]$/ },
  { name: "greeting_lead", line: GREETING_LEAD, match: exactly(GREETING_LEAD) },
  { name: "unanswered", line: UNANSWERED_NOTE, match: exactly(UNANSWERED_NOTE) },
  { name: "length_cut", line: LENGTH_CUT_NOTE, match: exactly(LENGTH_CUT_NOTE) },
  { name: "tool_ended", line: TOOL_ENDED_NOTE, match: exactly(TOOL_ENDED_NOTE) },
  { name: "switched_off_call", line: "[Прошлый вызов «", match: /^\[Прошлый вызов «[^»\n]*», сейчас выключен\./ },
  {
    name: "staff_reply",
    line: "Живой сотрудник",
    match: /^Живой сотрудник(?: «[^»\n]*»)? ответил человеку вместо тебя: «.*»\. Это сказано от вашего имени: продолжай разговор с учётом этого и не противоречь сотруднику\.$/,
  },
  ...CHANNEL_NOTE_LINES.map((note) => ({ name: "channel_note", line: note, match: exactly(note) })),
  // Имя автора — коротко и без знаков конца фразы: «Сообщение в группе от участника: Аня».
  { name: "group_author", line: "Сообщение в группе от участника: ", match: /^Сообщение в группе от участника: [^\s.!?:;][^.!?:;\n]{0,79}$/ },
];

/** Имя формата для журнала: тег или имя служебной строки. */
export const serviceBlockName = (format: ServiceBlockFormat): string => ("tag" in format ? format.tag : format.name);

/**
 * Вопрос человека — о служебных тегах и форматах: называет тег (`agent_memory`) или говорит о тегах, формате, разметке.
 * В ответе на такой вопрос блок — объяснение, а не подделка: теги не режутся (служебные строки — режутся).
 */
export function explainsServiceFormats(question: string, formats: readonly ServiceBlockFormat[]): boolean {
  const text = question.toLowerCase();
  if (formats.some((format) => "tag" in format && text.includes(format.tag.toLowerCase()))) return true;
  return /(?:^|[^\p{L}])(?:тег(?:а|е|и|у|ом|ов|ами|ам|ах)?|формат(?:а|е|у|ом|ы|ов|ами|ам|ах)?|разметк[аеиу]|tags?|formats?|markup)(?:[^\p{L}]|$)/u.test(text);
}

/** Строка перед блоком подаёт его как пример: «Формат памяти такой:», «Например:», «Выглядит так:». */
const EXAMPLE_LEAD = /(?:^|[^\p{L}])(?:например|пример\p{L}*|образец|шаблон\p{L}*|выгляд\p{L}*|формат\p{L}*|такой|такая|такое|такие|так|example|e\.g\.|looks like|format)(?:[^\p{L}][^\n]*)?:\s*$/iu;

/** Текст сообщения человека — для `explainsServiceFormats`. */
const textOfMessage = (message: AgentChatMessage): string => message.parts.map((part) => (part.type === "text" ? part.text : "")).join("\n");

/** Последний вопрос человека в истории (для ответа, который идёт следом). */
export function lastQuestionOf(history: readonly AgentChatMessage[]): string {
  const question = history.findLast((message) => message.role === "user");
  return question ? textOfMessage(question) : "";
}

/** Форматы приложения и пакетов проверяются при создании службы: ошибка в списке — `TypeError` сразу, а не тихий пропуск. */
export function checkServiceBlockFormats(formats: readonly ServiceBlockFormat[]): void {
  for (const format of formats) {
    const shown = JSON.stringify(format);
    if (!format || typeof format !== "object") throw new TypeError(`serviceBlocks: нужен объект формата, а не ${shown}`);
    if ("tag" in format) {
      if (typeof format.tag !== "string" || !/^[A-Za-z][\w:.-]*$/.test(format.tag)) throw new TypeError(`serviceBlocks: имя тега — латиница, цифры, _ : . -, а не ${shown}`);
      continue;
    }
    if (typeof format.name !== "string" || format.name === "") throw new TypeError(`serviceBlocks: у служебной строки нужно имя для журнала: ${shown}`);
    if (typeof format.line !== "string" || format.line.trim() === "") throw new TypeError(`serviceBlocks: у служебной строки нужно непустое начало line: ${shown}`);
    if (format.match !== undefined && !(format.match instanceof RegExp)) throw new TypeError(`serviceBlocks: match — регулярное выражение: ${format.name}`);
    if (format.until !== undefined && format.until !== "paragraph" && !(format.until instanceof RegExp)) {
      throw new TypeError(`serviceBlocks: until — "paragraph" или регулярное выражение: ${format.name}`);
    }
  }
}

/** Кусок разобранного текста: обычный текст, вырезанный блок или пробелы после него (уходят вместе с блоком). */
export type ForgedPiece = { kind: "text"; text: string } | { kind: "block"; name: string; text: string } | { kind: "gap"; text: string };

type LineFormat = Extract<ServiceBlockFormat, { line: string }>;

interface Compiled {
  tags: readonly string[];
  lines: readonly LineFormat[];
  /** Начало строки, после которого стоит разбирать текст целиком: без него в тексте подделки нет. */
  hint: RegExp;
}

const compiledByList = new WeakMap<readonly ServiceBlockFormat[], Compiled>();

function compile(formats: readonly ServiceBlockFormat[]): Compiled {
  const known = compiledByList.get(formats);
  if (known) return known;
  const tags = formats.flatMap((format) => ("tag" in format ? [format.tag] : []));
  const lines = formats.filter((format): format is LineFormat => !("tag" in format));
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const starts = [...tags.map((tag) => `<\\/?${escape(tag)}`), ...lines.map((format) => escape(format.line))];
  const hint = starts.length > 0 ? new RegExp(`(?:^|\\n) {0,3}(?:${starts.join("|")})`) : /(?!)/;
  const compiled = { tags, lines, hint };
  compiledByList.set(formats, compiled);
  return compiled;
}

// Сколько знаков после имени тега ждать «>»: дальше `<agent_memory …` без «>» — обычный текст.
const MAX_ATTRIBUTES_LENGTH = 200;

type Opener = { kind: "tag"; name: string; close: string; from: number } | { kind: "line"; format: LineFormat };

type BlockState =
  | { kind: "tag"; name: string; close: string; text: string; searchFrom: number }
  | { kind: "paragraph"; name: string; text: string }
  | { kind: "until"; name: string; until: RegExp; text: string };

/** Начало первой пустой строки после первой строки блока; нет — `-1`. */
function paragraphEnd(text: string): number {
  const blank = /\n[ \t]*(?:\n|$)/g;
  blank.lastIndex = Math.max(0, text.indexOf("\n"));
  const found = text.indexOf("\n") < 0 ? null : blank.exec(text);
  return found ? found.index + 1 : -1;
}

/**
 * Разбор текста одного ответа по частям потока. Обычный текст отдаётся сразу; начало строки, похожее на служебный блок,
 * придерживается, пока не станет ясно. Служебный блок (с пробелами после него) отдаётся отдельным куском — что с ним
 * делать, решает вызывающий. Разбор по частям даёт те же куски, что разбор законченного текста.
 */
export function createForgedBlockScanner(formats: readonly ServiceBlockFormat[], options: { explaining?: boolean } = {}) {
  const compiled = compile(formats);
  const lines = compiled.lines;
  // Ответ на вопрос о тегах: теги в нём — объяснение.
  const tags = options.explaining ? [] : compiled.tags;
  let fence: string | null = null;
  /** Последняя непустая обычная строка: подаёт ли она следующий блок как пример. */
  let previousLine = "";
  /** Начало текущей строки ещё не решено: придержано здесь. */
  let pending = "";
  /** Текущая строка уже признана обычной: её знаки идут сразу, вся строка — для ограды кода. */
  let ordinaryLine: string | null = null;
  let block: BlockState | null = null;
  let skipSpace = false;
  let out: ForgedPiece[] = [];

  const emitText = (text: string) => {
    if (!text) return;
    const last = out.at(-1);
    if (last?.kind === "text") last.text += text;
    else out.push({ kind: "text", text });
  };
  const emitGap = (text: string) => {
    const last = out.at(-1);
    if (last?.kind === "gap") last.text += text;
    else out.push({ kind: "gap", text });
  };

  const closeOrdinaryLine = (line: string) => {
    if (line.trim() !== "") previousLine = line;
    if (fence !== null) {
      if (closesCodeFence(line, fence)) fence = null;
    } else {
      const opener = codeFenceOf(line);
      if (opener) fence = opener;
    }
  };

  /** Что за строка начинается здесь: `wait` — пока неясно, `text` — обычная, иначе — служебный блок. */
  function classify(line: string, complete: boolean): "wait" | "text" | Opener {
    if (fence !== null || isIndentedCodeOrQuote(line) || codeFenceOf(line)) return "text";
    const indent = /^ {0,3}/.exec(line)![0].length;
    const body = line.slice(indent);
    if (body === "") return complete ? "text" : "wait";
    let waiting = false;
    if (body[0] === "<") {
      const closing = body[1] === "/";
      const nameAt = closing ? 2 : 1;
      for (const tag of tags) {
        const head = body.slice(nameAt, nameAt + tag.length);
        if (!tag.startsWith(head)) continue;
        if (head.length < tag.length) {
          waiting ||= body.length === nameAt + head.length;
          continue;
        }
        // Закрывающий тег без открывающего — не блок.
        if (closing) continue;
        const next = body[nameAt + tag.length];
        if (next === undefined) {
          waiting = true;
          continue;
        }
        if (next !== ">" && !/\s/.test(next)) continue;
        const end = body.indexOf(">", nameAt + tag.length);
        if (end >= 0 && end - (nameAt + tag.length) <= MAX_ATTRIBUTES_LENGTH && !body.slice(nameAt + tag.length, end).includes("\n")) {
          // Блок поданный как пример — объяснение формата.
          if (EXAMPLE_LEAD.test(previousLine.trimEnd())) continue;
          const close = `</${tag}>`;
          const rest = body.slice(end + 1);
          if (rest.includes(close)) return { kind: "tag", name: tag, close, from: indent + end + 1 };
          // После тега в той же строке — пояснение («— это блок…»), а не данные: упоминание. Решается на целой строке.
          if (!complete) {
            waiting = true;
            continue;
          }
          if (rest.trim() === "" || /^\s*[[{"]/.test(rest)) return { kind: "tag", name: tag, close, from: indent + end + 1 };
          continue;
        }
        if (end < 0 && !complete && body.length - (nameAt + tag.length) <= MAX_ATTRIBUTES_LENGTH) waiting = true;
      }
    }
    for (const format of lines) {
      if (body.length < format.line.length) {
        waiting ||= format.line.startsWith(body);
        continue;
      }
      if (!body.startsWith(format.line)) continue;
      if (!complete) {
        waiting = true;
        continue;
      }
      if (!format.match || format.match.test(body.trimEnd())) return { kind: "line", format };
    }
    return waiting && !complete ? "wait" : "text";
  }

  /** Блок начался со строки `line` (без перевода строки); `newline` — был ли он. */
  function openBlock(opener: Opener, line: string, newline: boolean): void {
    const whole = line + (newline ? "\n" : "");
    if (opener.kind === "tag") {
      block = { kind: "tag", name: opener.name, close: opener.close, text: whole, searchFrom: opener.from };
      return;
    }
    const { format } = opener;
    if (!format.until) {
      out.push({ kind: "block", name: format.name, text: whole });
      skipSpace = true;
      return;
    }
    block = format.until === "paragraph" ? { kind: "paragraph", name: format.name, text: whole } : { kind: "until", name: format.name, until: format.until, text: whole };
  }

  /** Внутри блока: ищется его конец, текст копится. `true` — блок кончился, остаток снова в `rest`. */
  function feedBlock(current: BlockState, delta: string): string | null {
    current.text += delta;
    if (current.kind === "tag") {
      const at = current.text.indexOf(current.close, current.searchFrom);
      if (at < 0) {
        current.searchFrom = Math.max(current.searchFrom, current.text.length - current.close.length + 1);
        return null;
      }
      const end = at + current.close.length;
      return finishBlock(current, end);
    }
    // Строчные блоки кончаются на целой строке: смотрятся только законченные строки после первой.
    let lineStart = current.text.indexOf("\n") + 1;
    while (lineStart > 0) {
      const lineEnd = current.text.indexOf("\n", lineStart);
      if (lineEnd < 0) return null;
      const line = current.text.slice(lineStart, lineEnd);
      if (current.kind === "paragraph" && line.trim() === "") return finishBlock(current, lineStart);
      if (current.kind === "until" && current.until.test(line.trim())) return finishBlock(current, lineEnd + 1);
      lineStart = lineEnd + 1;
    }
    return null;
  }

  function finishBlock(current: BlockState, end: number): string {
    out.push({ kind: "block", name: current.name, text: current.text.slice(0, end) });
    block = null;
    skipSpace = true;
    previousLine = "";
    return current.text.slice(end);
  }

  function feed(delta: string): void {
    let rest = delta;
    while (rest) {
      if (block) {
        const left = feedBlock(block, rest);
        if (left === null) return;
        rest = left;
        continue;
      }
      if (skipSpace) {
        const space = /^\s*/.exec(rest)![0];
        if (space) emitGap(space);
        rest = rest.slice(space.length);
        if (!rest) return;
        skipSpace = false;
        // После блока — снова начало строки.
        pending = "";
        ordinaryLine = null;
        continue;
      }
      if (ordinaryLine !== null) {
        const newline = rest.indexOf("\n");
        if (newline < 0) {
          ordinaryLine += rest;
          emitText(rest);
          return;
        }
        closeOrdinaryLine(ordinaryLine + rest.slice(0, newline));
        emitText(rest.slice(0, newline + 1));
        ordinaryLine = null;
        rest = rest.slice(newline + 1);
        continue;
      }
      const newline = rest.indexOf("\n");
      const line = pending + (newline < 0 ? rest : rest.slice(0, newline));
      const verdict = classify(line, newline >= 0);
      if (verdict === "wait") {
        pending = line;
        return;
      }
      pending = "";
      const after = newline < 0 ? "" : rest.slice(newline + 1);
      if (verdict === "text") {
        if (newline < 0) {
          ordinaryLine = line;
          emitText(line);
          return;
        }
        closeOrdinaryLine(line);
        emitText(`${line}\n`);
        rest = after;
        continue;
      }
      openBlock(verdict, line, newline >= 0);
      rest = after;
    }
  }

  const take = (): ForgedPiece[] => {
    const pieces = out;
    out = [];
    return pieces;
  };

  return {
    /** Следующий кусок текста → готовые куски. Начало возможного блока придерживается до следующего. */
    push(delta: string): ForgedPiece[] {
      feed(delta);
      return take();
    },
    /**
     * Текст кончился: придержанное решается на неполной строке. Незакрытый тег — блок до первой пустой строки, остальное
     * разбирается дальше; строчный блок — до конца текста.
     */
    end(): ForgedPiece[] {
      for (;;) {
        const current = block as BlockState | null;
        if (current) {
          block = null;
          const blank = current.kind === "tag" ? paragraphEnd(current.text) : -1;
          if (blank < 0) {
            out.push({ kind: "block", name: current.name, text: current.text });
            continue;
          }
          finishBlock(current, blank);
          feed(current.text.slice(blank));
          continue;
        }
        if (!pending) break;
        const line = pending;
        pending = "";
        const verdict = classify(line, true);
        if (verdict === "text" || verdict === "wait") emitText(line);
        else openBlock(verdict, line, false);
      }
      return take();
    },
  };
}

/** Законченный текст без служебных блоков и вырезанные блоки по порядку (имена). */
export function cutForgedBlocks(text: string, formats: readonly ServiceBlockFormat[], options: { explaining?: boolean } = {}): { text: string; blocks: string[] } {
  if (!compile(formats).hint.test(text)) return { text, blocks: [] };
  const scanner = createForgedBlockScanner(formats, options);
  const pieces = [...scanner.push(text), ...scanner.end()];
  return {
    text: pieces.map((piece) => (piece.kind === "text" ? piece.text : "")).join(""),
    blocks: pieces.flatMap((piece) => (piece.kind === "block" ? [piece.name] : [])),
  };
}

const hasWords = (text: string): boolean => /[\p{L}\p{N}]/u.test(text);

/**
 * Части ответа без служебных блоков в тексте. `null` — вырезать нечего или без блоков в ответе не осталось бы слов
 * (пустой ответ хуже повтора). Части без блоков — те же объекты.
 */
export function cutForgedBlocksInParts(
  parts: readonly MessagePart[],
  formats: readonly ServiceBlockFormat[],
  options: { explaining?: boolean } = {},
): { parts: MessagePart[]; blocks: string[] } | null {
  const blocks: string[] = [];
  // Текстовая часть, от которой после вырезки остались одни пробелы, уходит целиком.
  const cleaned = parts.flatMap((part): MessagePart[] => {
    if (part.type !== "text") return [part];
    const cut = cutForgedBlocks(part.text, formats, options);
    if (cut.blocks.length === 0) return [part];
    blocks.push(...cut.blocks);
    return cut.text.trim() === "" ? [] : [{ ...part, text: cut.text }];
  });
  if (blocks.length === 0) return null;
  if (!cleaned.some((part) => part.type === "text" && hasWords(part.text))) return null;
  return { parts: cleaned, blocks };
}

/**
 * История для модели без служебных блоков в ответах ассистента (ответы до этой версии, форматы, добавленные позже). Только
 * в запросе: запись не меняется. Та же история и те же форматы — те же байты (кэш модели). Нечего вырезать — тот же
 * массив; сообщения без блоков — те же объекты. Сообщения человека не трогаются.
 */
export function withoutForgedBlocks(history: readonly AgentChatMessage[], formats: readonly ServiceBlockFormat[]): readonly AgentChatMessage[] {
  let changed = false;
  let question = "";
  const cleaned = history.map((message) => {
    if (message.role === "user") question = textOfMessage(message);
    if (message.role !== "assistant") return message;
    const cut = cutForgedBlocksInParts(message.parts, formats, { explaining: explainsServiceFormats(question, formats) });
    if (!cut) return message;
    changed = true;
    return { ...message, parts: cut.parts };
  });
  return changed ? cleaned : history;
}

/** Придержанный блок, пока у ответа ещё нет слов: вдруг слов так и не будет — тогда блок показывается. */
interface HeldBlock {
  id: string;
  name: string;
  text: string;
}

/**
 * Вырезка служебных блоков, пока идёт поток ответа модели (каждый шаг попытки). Блок не уходит ни на экран, ни в запись,
 * ни в следующий шаг. Пока у ответа нет ни одного слова, блок придерживается: появились слова или шаг кончился вызовом
 * инструмента — блок выброшен; шаг кончился без слов и без вызовов — блок показывается как есть (пустой ответ хуже).
 */
export function createForgedBlockGuard(formats: readonly ServiceBlockFormat[]) {
  /** У ответа (в любом шаге попытки) уже есть слова. */
  let worded = false;
  /** Вопрос — о тегах и форматах (`explainsServiceFormats`): теги в ответе не режутся. */
  let explaining = false;
  const cut: string[] = [];
  const kept: string[] = [];

  const transformFor = () => {
    const scanners = new Map<string, ReturnType<typeof createForgedBlockScanner>>();
    /** Придержанное, пока у ответа нет слов: блоки и все куски потока после них — по порядку. `null` — куски идут сразу. */
    let held: Array<LanguageModelV4StreamPart | HeldBlock> | null = null;
    // Начало текстовой части уходит с первым её текстом: часть из одних блоков не оставляет в записи пустого текста.
    const starts = new Map<string, LanguageModelV4StreamPart>();
    const started = new Set<string>();
    const enqueue = (part: LanguageModelV4StreamPart, controller: TransformStreamDefaultController<LanguageModelV4StreamPart>) => {
      if (part.type === "text-start" && scanners.has(part.id)) {
        starts.set(part.id, part);
        return;
      }
      if (part.type === "text-delta" && !started.has(part.id) && starts.has(part.id)) {
        controller.enqueue(starts.get(part.id)!);
        started.add(part.id);
      }
      if (part.type === "text-end" && starts.has(part.id) && !started.has(part.id)) return;
      controller.enqueue(part);
    };

    const isBlock = (item: LanguageModelV4StreamPart | HeldBlock): item is HeldBlock => "name" in item && "text" in item && !("type" in item);
    const settle = (keep: boolean, controller: TransformStreamDefaultController<LanguageModelV4StreamPart>) => {
      const items = held ?? [];
      held = null;
      for (const item of items) {
        if (!isBlock(item)) enqueue(item, controller);
        else {
          if (keep) enqueue({ type: "text-delta", id: item.id, delta: item.text }, controller);
          if (item.name) (keep ? kept : cut).push(item.name);
        }
      }
    };
    const send = (part: LanguageModelV4StreamPart, controller: TransformStreamDefaultController<LanguageModelV4StreamPart>) => {
      if (held) held.push(part);
      else enqueue(part, controller);
    };

    /** Куски разбора → текст на выход. Блоки при словах выбрасываются, без слов — придерживаются. */
    const deltaOf = (id: string, pieces: readonly ForgedPiece[], controller: TransformStreamDefaultController<LanguageModelV4StreamPart>): string => {
      let delta = "";
      for (const piece of pieces) {
        if (piece.kind === "text" && hasWords(piece.text)) {
          worded = true;
          if (held) settle(false, controller);
        }
        if (piece.kind === "text" && !held) delta += piece.text;
        else if (worded) {
          if (piece.kind === "block") cut.push(piece.name);
        } else {
          (held ??= []).push({ id, name: piece.kind === "block" ? piece.name : "", text: piece.text });
        }
      }
      return delta;
    };

    const transform = (part: LanguageModelV4StreamPart, controller: TransformStreamDefaultController<LanguageModelV4StreamPart>): void => {
      switch (part.type) {
        case "text-start":
          scanners.set(part.id, createForgedBlockScanner(formats, { explaining }));
          break;
        case "text-delta": {
          const scanner = scanners.get(part.id);
          if (!scanner) break;
          const delta = deltaOf(part.id, scanner.push(part.delta), controller);
          if (delta) send({ ...part, delta }, controller);
          return;
        }
        case "text-end": {
          const scanner = scanners.get(part.id);
          if (!scanner) break;
          scanners.delete(part.id);
          const delta = deltaOf(part.id, scanner.end(), controller);
          if (delta) send({ type: "text-delta", id: part.id, delta }, controller);
          break;
        }
        case "tool-input-start":
        case "tool-call":
          // Шаг кончится вызовом: будет следующий шаг — блок не нужен.
          if (held) settle(false, controller);
          break;
        case "finish":
          // Шаг кончился без слов и без вызовов — блок показывается: пустой ответ хуже повтора.
          if (held) settle(part.finishReason.unified !== "tool-calls", controller);
          break;
      }
      send(part, controller);
    };
    const flush = (controller: TransformStreamDefaultController<LanguageModelV4StreamPart>) => {
      if (held) settle(true, controller);
    };
    return new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({ transform, flush });
  };

  return {
    /**
     * Новая попытка с последним вопросом человека: шаги прежней стёрты — слов у ответа снова нет. Вырезанное раньше
     * остаётся в счёте для журнала.
     */
    reset(question = ""): void {
      worded = false;
      explaining = explainsServiceFormats(question, formats);
    },
    /** Законченный текст мимо потока (переписка проверкой) — по тем же правилам, что поток этой попытки. */
    cutText: (text: string) => cutForgedBlocks(text, formats, { explaining }),
    /** Модель попытки под присмотром: каждый запрос — новый шаг. */
    wrap(model: LanguageModel): LanguageModel {
      if (typeof model === "string" || formats.length === 0) return model;
      return wrapLanguageModel({
        model,
        middleware: {
          specificationVersion: "v4",
          wrapStream: async ({ doStream }) => {
            const result = await doStream();
            return { ...result, stream: result.stream.pipeThrough(transformFor()) };
          },
        },
      });
    },
    /** Вырезанные блоки хода по порядку (имена) — для журнала. */
    cutBlocks: (): readonly string[] => cut,
    /** Блоки, оставленные ради непустого ответа. */
    keptBlocks: (): readonly string[] => kept,
  };
}
