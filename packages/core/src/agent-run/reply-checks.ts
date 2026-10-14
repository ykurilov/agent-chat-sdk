import { generateText } from "ai";
import type { ModelMessage, SystemModelMessage, UIMessageChunk } from "ai";
import { emptyTokenUsage, addTokenUsage } from "../conversation/token-usage";
import type { AgentChatMessage } from "../conversation/types";
import { FROZEN_CONTEXT_PART_TYPE } from "../frozen-context/context-blocks";
import type { FrozenContextData } from "../frozen-context/context-blocks";
import type { AgentNotice, AgentNoticeKind } from "../notices/agent-notice";
import { noticeText, noticesOfPart } from "../notices/notices-for-model";
import type { ModelCatalog } from "../models/model-catalog";
import { findModel } from "../models/model-catalog";
import type { ChatStorage } from "../storage/chat-storage";
import { recordSpentTokens } from "../usage/record-usage";
import { buildModelRequest } from "./build-model-request";
import { chunksForParts } from "./parts-to-chunks";
import type { KnownTexts, KnownTextsContext, ReplyCheck, ReplyChecksWebMode } from "./reply-check-types";
import { STEP_RESET_PART_TYPE } from "./step-reset";

// Проверка законченного ответа перед записью (`createChatService({ replyChecks })`): цепочка проверок над последней
// текстовой частью, что агент видел за ход, переписка моделью хода и замена текста на экране.

type MessagePart = AgentChatMessage["parts"][number];

/** Проверки хода, уже приведённые к одному виду. */
export interface TurnReplyChecks {
  checks: readonly ReplyCheck[];
  web: ReplyChecksWebMode;
  knownTexts?: KnownTexts;
}

/** Служебные сообщения, слова которых «виденным» не считаются: событие приложения (в нём и реплика сотрудника) и «напиши первым». */
const SERVICE_NOTICE_KINDS: ReadonlySet<AgentNoticeKind> = new Set(["app", "conversation_started"]);

/** Результаты фоновых задач — это выводы инструментов, их агент видел по-настоящему. */
const isServiceNotice = (notice: AgentNotice): boolean => SERVICE_NOTICE_KINDS.has(notice.kind);

/**
 * Что агент видел за ход: инструкция и все запросы к модели — блоки контекста, хвост шага, реплики человека, выводы
 * инструментов. Свои прошлые ответы агента — нет: выдуманная им раньше ссылка не становится «виденной». Служебные
 * сообщения приложения (`app`, «напиши первым») и реплики сотрудника — тоже нет: это не слова человека, чужая ссылка в
 * них не становится законной. Тексты приложения законны через `knownTexts`.
 */
export function createSeenTexts() {
  const texts = new Set<string>();
  // Текст части для модели → что в нём остаётся «виденным» (пусто — часть служебная целиком).
  const service = new Map<string, string>();
  const add = (text: string) => {
    if (text) texts.add(text);
  };
  const addVisible = (text: string) => add(service.has(text) ? service.get(text)! : text);
  return {
    instructions(instructions: string | SystemModelMessage): void {
      add(typeof instructions === "string" ? instructions : instructions.content);
    },
    /** Служебные сообщения из истории и хода: их тексты в запросах не считаются виденными. */
    serviceNotices(notices: readonly (readonly AgentNotice[])[]): void {
      for (const group of notices) {
        if (!group.some(isServiceNotice)) continue;
        const kept = group.filter((notice) => !isServiceNotice(notice)).map(noticeText).join("\n\n");
        service.set(group.map(noticeText).join("\n\n"), kept);
        // Служебные сообщения хода — по одному на текстовую часть.
        for (const notice of group) service.set(noticeText(notice), isServiceNotice(notice) ? "" : noticeText(notice));
      }
    },
    messages(messages: readonly ModelMessage[]): void {
      for (const message of messages) for (const text of textsOfModelMessage(message)) (message.role === "tool" ? add : addVisible)(text);
    },
    list: (): string[] => [...texts],
  };
}

export type SeenTexts = ReturnType<typeof createSeenTexts>;

/** Группы служебных сообщений в частях истории и в блоках текущего хода: по группе на часть. */
export function noticeGroupsOf(history: readonly Pick<AgentChatMessage, "parts">[], frozen?: Pick<FrozenContextData, "notices">): AgentNotice[][] {
  const groups = history.flatMap((message) =>
    message.parts.map((part) =>
      part.type === FROZEN_CONTEXT_PART_TYPE ? [...((part as { data?: FrozenContextData }).data?.notices ?? [])] : noticesOfPart(part as { type: string; data?: unknown }),
    ),
  );
  return [...groups, [...(frozen?.notices ?? [])]].filter((group) => group.length > 0);
}

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
 * Что агент видел в чате вне хода (`service.checkReply`): инструкция, блоки контекста, реплики человека и выводы
 * инструментов на ветке. Как у хода, без своих ответов агента и служебных сообщений. Хвоста шага (`stepContext`) вне хода
 * нет — его тексты приложение называет через `knownTexts`.
 */
export function seenTextsOfBranch(input: { instructions: string | SystemModelMessage; branch: readonly Pick<AgentChatMessage, "role" | "parts">[] }): string[] {
  const seen = createSeenTexts();
  seen.instructions(input.instructions);
  seen.serviceNotices(noticeGroupsOf(input.branch));
  const lines: ModelMessage[] = input.branch.flatMap((message): ModelMessage[] =>
    message.parts.flatMap((part): ModelMessage[] => {
      const typed = part as { type: string; text?: string; state?: string; output?: unknown; data?: unknown };
      if (message.role === "user" && typed.type === "text") return [{ role: "user", content: typed.text ?? "" }];
      if (typed.type === FROZEN_CONTEXT_PART_TYPE) {
        const data = typed.data as FrozenContextData | undefined;
        return [...(data?.blocks ?? []).map((block): ModelMessage => ({ role: "user", content: block.text })), ...(data?.notices ?? []).map((notice): ModelMessage => ({ role: "user", content: noticeText(notice) }))];
      }
      const notices = noticesOfPart(typed);
      if (notices.length > 0) return [{ role: "user", content: notices.map(noticeText).join("\n\n") }];
      if (typed.type.startsWith("tool-") && typed.state === "output-available") {
        return [{ role: "tool", content: [{ type: "tool-result", toolCallId: "", toolName: "", output: { type: "json", value: typed.output } }] } as ModelMessage];
      }
      return [];
    }),
  );
  seen.messages(lines);
  return seen.list();
}

/**
 * Тексты приложения для проверок (`replyChecks.knownTexts`). Сбой или не список — строка в журнал и пустой список:
 * проверки идут с тем, что видел агент.
 */
export async function knownTextsOf(known: KnownTexts | undefined, context: KnownTextsContext, logError: (message: string) => void): Promise<string[]> {
  if (!known) return [];
  try {
    const texts = await known({ ...context });
    if (Array.isArray(texts)) return texts.filter((text): text is string => typeof text === "string" && text !== "");
    logError(`[replyChecks] чат=${context.chatId} knownTexts вернул не список — проверка без текстов приложения`);
  } catch (failure) {
    logError(`[replyChecks] чат=${context.chatId} knownTexts упал: ${failure instanceof Error ? failure.message : String(failure)} — проверка без текстов приложения`);
  }
  return [];
}

/**
 * Проверки по очереди: следующая получает текст предыдущей. Заметка — строка в журнал. Сбой проверки или пустой текст —
 * текст до неё и строка в журнал: пустой ответ человеку не уходит, следующие проверки идут дальше.
 */
export async function checkedReplyText(input: Parameters<typeof runReplyChecks>[0]): Promise<string> {
  return (await runReplyChecks(input)).text;
}

/** Те же проверки с итогом: текст после правок и заметки проверок (то, что в ходе уходит строками в журнал). */
export async function runReplyChecks(input: {
  checks: readonly ReplyCheck[];
  text: string;
  ownerId: string;
  chatId: string;
  messageId: string;
  seenTexts: readonly string[];
  rewrite: (system: string, prompt: string) => Promise<string>;
  logError: (message: string) => void;
}): Promise<{ text: string; notes: string[] }> {
  const { ownerId, chatId, messageId, rewrite, logError } = input;
  let text = input.text;
  const notes: string[] = [];
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
    if (typeof note === "string" && note) {
      logError(`${where}: ${note}`);
      notes.push(note);
    }
    text = next;
  }
  return { text, notes };
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
  /** Ответ, на который идёт расход; вне хода (`service.checkReply`) — `null`. */
  messageId: string | null;
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
