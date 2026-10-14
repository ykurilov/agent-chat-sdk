import { generateText } from "ai";
import type { ModelMessage, SystemModelMessage, UIMessageChunk } from "ai";
import { emptyTokenUsage, addTokenUsage } from "../conversation/token-usage";
import type { AgentChatMessage } from "../conversation/types";
import type { ModelCatalog } from "../models/model-catalog";
import { findModel } from "../models/model-catalog";
import type { ChatStorage } from "../storage/chat-storage";
import { recordSpentTokens } from "../usage/record-usage";
import { buildModelRequest } from "./build-model-request";
import { chunksForParts } from "./parts-to-chunks";
import type { ReplyCheck, ReplyChecksWebMode } from "./reply-check-types";
import { STEP_RESET_PART_TYPE } from "./step-reset";

// Проверка законченного ответа перед записью (`createChatService({ replyChecks })`): цепочка проверок над последней
// текстовой частью, что агент видел за ход, переписка моделью хода и замена текста на экране.

type MessagePart = AgentChatMessage["parts"][number];

/** Проверки хода, уже приведённые к одному виду. */
export interface TurnReplyChecks {
  checks: readonly ReplyCheck[];
  web: ReplyChecksWebMode;
}

/**
 * Что агент видел за ход: инструкция и все запросы к модели — блоки контекста, хвост шага, реплики человека, выводы
 * инструментов. Свои прошлые ответы агента — нет: выдуманная им раньше ссылка не становится «виденной».
 */
export function createSeenTexts() {
  const texts = new Set<string>();
  const add = (text: string) => {
    if (text) texts.add(text);
  };
  return {
    instructions(instructions: string | SystemModelMessage): void {
      add(typeof instructions === "string" ? instructions : instructions.content);
    },
    messages(messages: readonly ModelMessage[]): void {
      for (const message of messages) for (const text of textsOfModelMessage(message)) add(text);
    },
    list: (): string[] => [...texts],
  };
}

export type SeenTexts = ReturnType<typeof createSeenTexts>;

function textsOfModelMessage(message: ModelMessage): string[] {
  if (message.role === "assistant") return [];
  if (typeof message.content === "string") return [message.content];
  return (message.content as ReadonlyArray<{ type: string; text?: string; output?: { value?: unknown } }>).flatMap((part) => {
    if (part.type === "text") return [part.text ?? ""];
    if (part.type === "tool-result") return [typeof part.output?.value === "string" ? part.output.value : JSON.stringify(part.output?.value ?? part.output)];
    return [];
  });
}

/**
 * Проверки по очереди: следующая получает текст предыдущей. Заметка — строка в журнал. Сбой проверки или пустой текст —
 * текст до неё и строка в журнал: пустой ответ человеку не уходит, следующие проверки идут дальше.
 */
export async function checkedReplyText(input: {
  checks: readonly ReplyCheck[];
  text: string;
  ownerId: string;
  chatId: string;
  messageId: string;
  seenTexts: readonly string[];
  rewrite: (system: string, prompt: string) => Promise<string>;
  logError: (message: string) => void;
}): Promise<string> {
  const { ownerId, chatId, messageId, rewrite, logError } = input;
  let text = input.text;
  for (const [index, check] of input.checks.entries()) {
    const where = `[replyChecks] чат=${chatId} ответ=${messageId} проверка=${index + 1}`;
    let result: unknown;
    try {
      result = await check({ text, ownerId, chatId, messageId, seenTexts: [...input.seenTexts], rewrite });
    } catch (failure) {
      logError(`${where} упала: ${failure instanceof Error ? failure.message : String(failure)} — оставлен текст до неё`);
      continue;
    }
    if (result === undefined || result === null) continue;
    const { text: next, note } = result as { text?: unknown; note?: unknown };
    if (typeof next !== "string" || next.trim() === "") {
      logError(`${where} вернула пустой текст — оставлен текст до неё${typeof note === "string" && note ? ` (${note})` : ""}`);
      continue;
    }
    if (typeof note === "string" && note) logError(`${where}: ${note}`);
    text = next;
  }
  return text;
}

/** Переписка для проверок: модель хода, без рассуждений и инструментов; расход — `answer_correction` на этот ответ. */
export function createReplyRewrite(input: {
  catalog: ModelCatalog;
  env: Record<string, string | undefined>;
  storage: ChatStorage;
  modelId: string;
  providerId: string;
  chatId: string;
  ownerId?: string;
  messageId: string;
  abortSignal: AbortSignal;
  logError: (message: string) => void;
}): (system: string, prompt: string) => Promise<string> {
  const { catalog, modelId, providerId, chatId, logError } = input;
  return async (system, prompt) => {
    const { profile } = findModel(catalog, modelId, providerId);
    // Переписке рассуждения не нужны: самый малый уровень модели, как у сжатия.
    const lowestLevel = profile.reasoning.levels?.[0];
    const startedAt = new Date().toISOString();
    const { noteAfterApprovals: _noteAfterApprovals, ...request } = await buildModelRequest({
      catalog,
      modelId,
      providerId,
      chatId,
      instructions: system,
      history: [{ id: "reply-check", role: "user", parts: [{ type: "text", text: prompt }] }],
      env: input.env,
      logError,
      ...(lowestLevel && { reasoning: lowestLevel }),
    });
    const result = await generateText({ ...request, maxRetries: 0, abortSignal: input.abortSignal });
    const spent = emptyTokenUsage();
    addTokenUsage(spent, result.usage);
    if (input.ownerId) {
      await recordSpentTokens({
        storage: input.storage,
        catalog,
        ownerId: input.ownerId,
        chatId,
        messageId: input.messageId,
        source: "answer_correction",
        modelId,
        providerId,
        spent,
        startedAt,
        logError,
      });
    }
    return result.text;
  };
}

/** Номер последней текстовой части ответа; `-1` — текста нет. */
export const lastTextIndex = (parts: readonly MessagePart[]): number => parts.findLastIndex((part) => part.type === "text");

/** Части ответа с новым текстом части `index`. */
export function withTextAt(parts: readonly MessagePart[], index: number, text: string): MessagePart[] {
  return parts.map((part, at) => (at === index ? ({ ...part, text } as MessagePart) : part));
}

/**
 * Шаги, которые уже ушли на экран: экран считает шаги по кускам `start-step` (и пустые шаги, которых в записи нет),
 * сброс шага убирает последний. Нужен, чтобы заменить показанное ровно с шага последнего текста.
 */
export function createShownSteps() {
  let steps = 0;
  // Номера шагов, где на экране начинался текст.
  let textSteps: number[] = [];
  return {
    observe(chunk: UIMessageChunk): void {
      if (chunk.type === "start-step") steps += 1;
      else if (chunk.type === "text-start") textSteps.push(steps);
      else if (chunk.type === STEP_RESET_PART_TYPE) {
        steps = Math.max(steps - 1, 0);
        textSteps = textSteps.filter((step) => step <= steps);
      }
    },
    /** Сколько шагов стереть с конца, чтобы убрать шаг последнего текста; `null` — текста на экране нет. */
    resetsToLastText(): number | null {
      const last = textSteps.at(-1);
      return last === undefined || last === 0 ? null : steps - last + 1;
    },
  };
}

/**
 * Куски, которыми экран заменяет показанное исправленным (`web: "replace"`): сброс `resets` шагов с конца и шаги от
 * шага с текстом `index` заново. `null` — у текста нет шага. Вызов инструмента или часть данных с id в этих шагах
 * клиент обновит на прежнем месте, в стёртом шаге: до перезагрузки их карточка не видна (текст и вызов в одном
 * последнем шаге — редкость).
 */
export function replacementChunks(corrected: readonly MessagePart[], index: number, resets: number, providerId: string): UIMessageChunk[] | null {
  const stepStart = corrected.slice(0, index + 1).findLastIndex((part) => part.type === "step-start");
  if (stepStart === -1) return null;
  const erase = Array.from({ length: resets }, (): UIMessageChunk => ({ type: STEP_RESET_PART_TYPE, data: { providerId } }));
  return [...erase, ...chunksForParts(corrected.slice(stepStart))];
}

/** Кусок, после которого придержанный текст уже не последний: ход идёт дальше. */
const continuesAnswer = (chunk: UIMessageChunk): boolean =>
  chunk.type === "start-step" ||
  chunk.type.startsWith("tool-") ||
  chunk.type.startsWith("reasoning-") ||
  chunk.type.startsWith("source-") ||
  chunk.type === "file";

/**
 * Придержка текста до проверки (`web: "hold"` и мессенджеры): от начала текста куски ждут, пока не станет ясно, что
 * ход идёт дальше (вызов, новый шаг, рассуждение) — тогда уходят как были, порядок прежний. Конец хода — `release`:
 * последний текст уходит уже проверенным. Сброс шага выбрасывает придержанное: оно из стёртого шага.
 */
export function createHeldReplyText() {
  let held: UIMessageChunk[] | null = null;
  let released = false;
  return {
    pass(chunk: UIMessageChunk): UIMessageChunk[] {
      if (released) return [chunk];
      if (chunk.type === STEP_RESET_PART_TYPE) {
        held = null;
        return [chunk];
      }
      if (held) {
        if (!continuesAnswer(chunk)) {
          held.push(chunk);
          return [];
        }
        const out = [...held, chunk];
        held = null;
        return out;
      }
      if (chunk.type !== "text-start") return [chunk];
      held = [chunk];
      return [];
    },
    /** Придержан последний текст ответа. */
    holdsText: (): boolean => held !== null,
    /** Конец хода: придержанное — сейчас, последний текст — `text`, если он задан. Дальше куски идут сразу. */
    release(text?: string): UIMessageChunk[] {
      released = true;
      const out = held ?? [];
      held = null;
      if (text === undefined) return out;
      const lastStart = out.findLast((chunk) => chunk.type === "text-start") as { id: string } | undefined;
      if (!lastStart) return out;
      const { id } = lastStart;
      return out.flatMap((chunk): UIMessageChunk[] => {
        if (chunk.type === "text-delta" && chunk.id === id) return [];
        if (chunk.type === "text-start" && chunk.id === id) return [chunk, { type: "text-delta", id, delta: text }];
        return [chunk];
      });
    },
  };
}
