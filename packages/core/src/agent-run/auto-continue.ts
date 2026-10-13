import type { ModelMessage, UIMessageChunk } from "ai";
import type { AgentChatMessage } from "../conversation/types";
import { hangingToolCallText, isHangingToolCall } from "../conversation/hanging-tool-calls";
import { requestedRetryMs } from "../provider-errors/error-fields";

type MessagePart = AgentChatMessage["parts"][number];

/**
 * Пометка в конце запроса продолжения (FR-039). Только в запросе, в историю не пишется. Стоит последней: всё до неё
 * совпадает с оборванной попыткой, кэш цел.
 */
export const AUTO_CONTINUE_NOTE =
  "Ответ прервался из-за сбоя связи с моделью. Продолжи с того места, где оборвался текст выше: не повторяй уже написанное и не вызывай заново инструменты, у которых есть результат";

/** Сколько последних знаков оборванного текста пометка показывает дословно. */
const NOTE_TAIL_CHARS = 80;

/**
 * Пометка отдельным последним сообщением человека: хвост вопроса стоит раньше ответа и сдвинул бы его кэш. Ответ
 * оборвался на тексте — пометка показывает его последние знаки строкой JSON (перенос строки виден как `\n`): без них
 * модель теряет перенос на шве, и «1 — 1» с продолжением «2 — 4» слипаются в «1 — 12 — 4».
 */
export function autoContinueNoteMessage(answerParts: readonly MessagePart[]): ModelMessage {
  const last = answerParts.findLast((part) => part.type !== "step-start");
  const tail = last?.type === "text" ? last.text.slice(-NOTE_TAIL_CHARS) : "";
  if (!tail) return { role: "user", content: AUTO_CONTINUE_NOTE };
  return {
    role: "user",
    content: `${AUTO_CONTINUE_NOTE}.

Текст выше оборвался на этих знаках (строка JSON: перенос строки записан как \\n): ${JSON.stringify(tail)}
Продолжи ровно со следующего знака после них. Если дальше нужен пробел или перенос строки, начни ответ с него.`,
  };
}

/**
 * Есть ли в ответе что показать модели: непустой текст, вызов инструмента или файл. Ответ из одних рассуждений модели
 * не отправляется (FR-055): продолжать нечего — запрос повторяется как новый, без пометки.
 */
export function hasAnswerContent(parts: readonly MessagePart[]): boolean {
  return parts.some(
    (part) =>
      (part.type === "text" && part.text.trim().length > 0) ||
      part.type === "file" ||
      part.type === "dynamic-tool" ||
      part.type.startsWith("tool-"),
  );
}

/** Не больше двух автопродолжений на ход: потолок лишних трат (FR-037, FR-043). */
export const AUTO_CONTINUES_PER_TURN = 2;
/** Паузы перед первым и вторым продолжением (FR-038). */
export const AUTO_CONTINUE_PAUSES_MS = [2_000, 5_000] as const;
/** Случайная добавка к паузе — до 25%: чаты после общего сбоя не продолжают разом. */
const AUTO_CONTINUE_JITTER = 0.25;
/** Срок `retry-after` от провайдера — не дольше этого. */
const MAX_REQUESTED_PAUSE_MS = 10_000;

/** Пауза перед продолжением номер `index` (с нуля): расписание с разбросом; `retry-after` провайдера длиннее — он, но не больше 10 с. */
export function autoContinuePauseMs(input: { index: number; error: unknown; random: () => number; now?: () => number }): number {
  const base = AUTO_CONTINUE_PAUSES_MS[Math.min(input.index, AUTO_CONTINUE_PAUSES_MS.length - 1)]!;
  const scheduled = Math.round(base * (1 + input.random() * AUTO_CONTINUE_JITTER));
  // Срок провайдера только удлиняет паузу: `retry-after: 0` от перегруженного провайдера не повод стучаться сразу.
  const requested = requestedRetryMs(input.error, (input.now ?? Date.now)()) ?? 0;
  return Math.min(Math.max(requested, scheduled), MAX_REQUESTED_PAUSE_MS);
}

interface PartView {
  type: string;
  state?: string;
  preliminary?: boolean;
}

const isToolPart = (part: MessagePart): boolean => part.type.startsWith("tool-") || part.type === "dynamic-tool";

/** Законченная часть: дописанный текст или рассуждение, вызов с окончательным результатом. */
function isFinished(part: MessagePart): boolean {
  const { state, preliminary } = part as PartView;
  if (isToolPart(part)) return (state === "output-available" && preliminary !== true) || state === "output-error" || state === "output-denied";
  return state === "done";
}

/**
 * Номера частей оборванного ответа, которые в запрос продолжения не идут: недописанные аргументы вызова
 * (`input-streaming`) и недописанное рассуждение после последней законченной части — у него нет подписи провайдера.
 */
export function partsLeftOutOfAutoContinue(parts: readonly MessagePart[]): number[] {
  const lastFinished = parts.findLastIndex(isFinished);
  const left: number[] = [];
  parts.forEach((part, index) => {
    const { state } = part as PartView;
    if (isToolPart(part) && state === "input-streaming") left.push(index);
    else if (part.type === "reasoning" && state === "streaming" && index > lastFinished) left.push(index);
  });
  return left;
}

/** Текст, на котором оборвался ответ: последняя видимая модели часть — текст. Иначе `null`. */
export function textAtBreak(parts: readonly MessagePart[]): string | null {
  const left = new Set(partsLeftOutOfAutoContinue(parts));
  const last = parts.findLast((part, index) => part.type !== "step-start" && !left.has(index));
  return last?.type === "text" ? last.text : null;
}

/**
 * Оборванный ответ, каким его видит модель в запросе продолжения: законченные вызовы и недописанный текст как есть,
 * без частей из `partsLeftOutOfAutoContinue`. Висящие вызовы закроет `buildModelRequest`.
 */
export function messageForAutoContinue(message: AgentChatMessage): AgentChatMessage {
  const left = new Set(partsLeftOutOfAutoContinue(message.parts));
  return { ...message, parts: message.parts.filter((_, index) => !left.has(index)) };
}

/**
 * Следит за кусками ответа и знает незакрытые текст и рассуждения. Части сообщения своих id кусков не хранят,
 * поэтому закрывающие куски строятся по самим кускам.
 */
export function createOpenPartsTracker() {
  const open = new Map<string, UIMessageChunk>();
  return {
    observe(chunk: UIMessageChunk): void {
      if (chunk.type === "text-start") open.set(`text:${chunk.id}`, { type: "text-end", id: chunk.id });
      else if (chunk.type === "reasoning-start") open.set(`reasoning:${chunk.id}`, { type: "reasoning-end", id: chunk.id });
      else if (chunk.type === "text-end") open.delete(`text:${chunk.id}`);
      else if (chunk.type === "reasoning-end") open.delete(`reasoning:${chunk.id}`);
    },
    /** `text-end` и `reasoning-end` для незакрытых частей: клиент и сохранение закроют их, продолжение пойдёт новыми частями. */
    closingChunks(): UIMessageChunk[] {
      const chunks = [...open.values()];
      open.clear();
      return chunks;
    },
  };
}

/** Что узнаёт модель о вызове, оборванном посреди аргументов. */
export const UNSENT_TOOL_CALL_REASON = "Вызов оборвался: аргументы не дошли, инструмент не запускался";

/**
 * Куски, закрывающие вызовы последнего шага оборванного ответа: без них вызов остался бы в сохранённом ответе с вечным
 * «выполняется». Запущенный без результата — `tool-output-error` с `hangingToolCallText` (действие могло выполниться).
 * Недописанный (`input-streaming`) — `tool-input-error` с пустым входом: обрывок JSON из `rawInput` провайдер не примет.
 */
export function closingChunksForHangingCalls(parts: readonly MessagePart[]): UIMessageChunk[] {
  const lastStep = parts.findLastIndex((part) => part.type === "step-start");
  return parts.slice(lastStep + 1).flatMap((part): UIMessageChunk[] => {
    if (!isToolPart(part)) return [];
    const { toolCallId, state, toolName } = part as PartView & { toolCallId: string; toolName?: string };
    if (isHangingToolCall(part)) return [{ type: "tool-output-error", toolCallId, errorText: hangingToolCallText(part) }];
    if (state !== "input-streaming") return [];
    const dynamic = part.type === "dynamic-tool";
    return [
      {
        type: "tool-input-error",
        toolCallId,
        toolName: dynamic ? toolName! : part.type.slice("tool-".length),
        input: {},
        errorText: UNSENT_TOOL_CALL_REASON,
        ...(dynamic && { dynamic: true }),
      },
    ];
  });
}

/** Строка нумерованного списка: «3. …», «3) …», «3 — …». Номер и разделитель — группы 1 и 2. */
const NUMBERED_LINE = /^\s*(\d+)(\.|\)|\s+[—–-])\s+\S/;
const NUMBERED_START = /^(\d+)(\.|\)|\s+[—–-])\s/;
/** Законченная строка таблицы. */
const TABLE_ROW = /^\s*\|.*\|$/;

/**
 * Модель продолжила со следующего элемента списка или строки таблицы, но без переноса строки: «1 — 1» + «2 — 4».
 * Правило узкое: последняя строка оборванного текста — законченный элемент, продолжение начинается следующим номером с тем же
 * разделителем или новой строкой таблицы. Обычный текст, оборванный посреди слова или числа, не трогается.
 */
export function needsLineBreak(before: string, after: string): boolean {
  if (/\s$/.test(before) || /^\s/.test(after)) return false;
  const lastLine = before.slice(before.lastIndexOf("\n") + 1);
  if (TABLE_ROW.test(lastLine)) return after.startsWith("|");
  const item = NUMBERED_LINE.exec(lastLine);
  const next = NUMBERED_START.exec(after);
  return Boolean(item && next && Number(next[1]) === Number(item[1]) + 1 && next[2]!.trim() === item[2]!.trim());
}

/** Сколько знаков начала продолжения достаточно, чтобы решить про перенос. */
const SEAM_LOOKAHEAD = 12;

/**
 * Шов автопродолжения: начало первого текста продолжения придерживается (до 12 знаков или переноса строки), и если
 * `needsLineBreak` — перед ним ставится перенос. Клиент и запись получают одно и то же. Вызов инструмента раньше текста —
 * шов не проверяется.
 */
export function createSeamJoiner() {
  let before: string | null = null;
  let textId: string | null = null;
  let held: Extract<UIMessageChunk, { type: "text-delta" }> | null = null;
  function release(): UIMessageChunk[] {
    const chunk = held;
    const seamBefore = before;
    before = null;
    held = null;
    if (!chunk) return [];
    return [seamBefore !== null && needsLineBreak(seamBefore, chunk.delta) ? { ...chunk, delta: `\n${chunk.delta}` } : chunk];
  }
  return {
    /** Ответ оборвался посреди текста `textBefore`. */
    watch(textBefore: string): void {
      before = textBefore;
      textId = null;
      held = null;
    },
    pass(chunk: UIMessageChunk): UIMessageChunk[] {
      if (before === null) return [chunk];
      if (textId === null) {
        if (chunk.type === "text-start") textId = chunk.id;
        else if (chunk.type.startsWith("tool-")) before = null;
        return [chunk];
      }
      if (chunk.type === "text-delta" && chunk.id === textId) {
        held = held ? { ...chunk, delta: held.delta + chunk.delta, providerMetadata: chunk.providerMetadata ?? held.providerMetadata } : chunk;
        return held.delta.length >= SEAM_LOOKAHEAD || held.delta.includes("\n") ? release() : [];
      }
      return [...release(), chunk];
    },
    /** Придержанное — сейчас: ход кончается. */
    flush(): UIMessageChunk[] {
      return release();
    },
  };
}
