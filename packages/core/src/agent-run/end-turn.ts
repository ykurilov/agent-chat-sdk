import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { TextPart, ToolSet } from "ai";

/** Метка через общий реестр: две копии пакета в приложении узнают пометки друг друга. */
const END_TURN = Symbol.for("@ykurilov/agent-chat-core/end-turn");

/**
 * Служебная часть в записи ответа: ход кончен инструментом без слов. Только для модели — клиенту, хукам и в повтор
 * кусков не идёт.
 */
export const END_TURN_PART_TYPE = "data-end-turn";

/** Что видит модель после результата инструмента, которым ход кончился без слов. Текст постоянный — кэш модели цел. */
export const TOOL_ENDED_NOTE = "[Ход окончен инструментом]";

/**
 * Для `convertToModelMessages`: отметка — ответом модели с `TOOL_ENDED_NOTE` после результата. Строгие провайдеры не
 * принимают вопрос человека сразу после результата инструмента.
 */
export function endTurnNoteForModel(part: { type: string }): TextPart | undefined {
  return part.type === END_TURN_PART_TYPE ? { type: "text", text: TOOL_ENDED_NOTE } : undefined;
}

/** Что добавить к концу хода. */
export interface EndTurnOptions {
  /** Готовый текст ответа: идёт в поток и в запись обычной текстовой частью, модель его не пишет. Пустой — без текста. */
  text?: string;
  /** End only when the active answer has user-facing text, or explicit text supplies it. Otherwise return ordinary output. */
  requireText?: boolean;
}

interface EndTurnMark {
  [END_TURN]: true;
  output: unknown;
  text: string | undefined;
  requireText: boolean;
}

/**
 * Результат инструмента, после которого ход кончается: модель следующего шага не делает. SDK снимает пометку — модель,
 * запись, наблюдатель и следующий ход видят `output` как обычный результат. Готовый `text` ложится в ответ после
 * результата. Для типов возвращает тот же `output`: на деле — обёртка, её понимает только инструмент основного агента.
 * @throws TypeError for invalid text or requireText options.
 */
export function endTurn<T>(output: T, options?: EndTurnOptions): T {
  const text = options?.text;
  if (text !== undefined && typeof text !== "string") throw new TypeError("endTurn: text — строка");
  if (options?.requireText !== undefined && typeof options.requireText !== "boolean") throw new TypeError("endTurn: requireText must be a boolean");
  const mark: EndTurnMark = { [END_TURN]: true, output, requireText: options?.requireText === true, text: text !== undefined && text.trim().length > 0 ? text : undefined };
  return mark as unknown as T;
}

function isEndTurnMark(value: unknown): value is EndTurnMark {
  return typeof value === "object" && value !== null && (value as Partial<EndTurnMark>)[END_TURN] === true;
}

/** Просьбы инструментов закончить ход: одна на весь ход, её видят и новые попытки (запасной, автопродолжение). */
export interface EndTurnRequests {
  /** Инструменты попытки, которые снимают пометку и запоминают просьбу. */
  tools(tools: ToolSet | undefined): ToolSet | undefined;
  /** Какой-то инструмент попросил закончить ход, а последний шаг ещё не сделан. */
  requested(): boolean;
  /** Есть ли готовый текст у просьбы. */
  hasText(): boolean;
  /** Готовые тексты по порядку вызовов через пустую строку; просьба исполнена. */
  take(): string | undefined;
  /** Просьба без текста исполнена остановкой хода сразу после шага. */
  stopWithoutText(): void;
  /** Ход кончен просьбой без готового текста: в ответе после результата нет слов модели. */
  endedWithoutText(): boolean;
  /**
   * Новая попытка хода по частям ответа, с которых она идёт: остаются просьбы только тех вызовов, чей результат в ответе
   * есть. Вызов стёрт со своим шагом или упал с попыткой — модель вызовет инструмент заново, и текст не задвоится. Поздний
   * результат инструмента прошлой попытки просьбы уже не даёт.
   */
  nextAttempt(parts: ReadonlyArray<{ type: string }>): void;
}

/** Text intended for the user, without judging Markdown/HTML meaning or delivery acknowledgements. */
function hasUserFacingText(parts: ReadonlyArray<{ type: string; text?: unknown }>): boolean {
  return parts.some((part) => part.type === "text" && typeof part.text === "string" && hasText(part.text));
}

function hasText(text: string): boolean {
  return text.replace(/[\s\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "").length > 0;
}

export function createEndTurnRequests(snapshot: () => Promise<ReadonlyArray<{ type: string }>> = async () => []): EndTurnRequests {
  let calls = 0;
  let attempt = 0;
  let silent = false;
  // Вызов → номер по порядку начала и готовый текст.
  const ended = new Map<string, { order: number; text: string | undefined; requireText: boolean }>();
  const texts = () =>
    [...ended.values()]
      .sort((left, right) => left.order - right.order)
      .flatMap(({ text }) => (text === undefined ? [] : [text]));
  return {
    tools(tools) {
      const own = attempt;
      return withEndTurn(tools, (toolCallId) => {
        const order = calls++;
        return (text, requireText) => {
          const remember = () => { if (own === attempt) ended.set(toolCallId, { order, text, requireText }); };
          // Explicit user-supplied text keeps its existing precedence; no SDK acknowledgement is invented.
          if (!requireText || (text !== undefined && hasText(text))) return remember();
          return snapshot().then((parts) => { if (hasUserFacingText(parts)) remember(); });
        };
      });
    },
    requested: () => ended.size > 0,
    hasText: () => texts().length > 0,
    take() {
      const joined = texts().join("\n\n");
      ended.clear();
      silent = joined.length === 0;
      return joined.length > 0 ? joined : undefined;
    },
    stopWithoutText() {
      ended.clear();
      silent = true;
    },
    endedWithoutText: () => silent,
    nextAttempt(parts) {
      attempt += 1;
      silent = false;
      const answered = new Set(parts.flatMap((part) => (isAnsweredToolPart(part) ? [part.toolCallId] : [])));
      for (const [toolCallId, request] of ended) {
        if (!answered.has(toolCallId) || (request.requireText && !(request.text !== undefined && hasText(request.text)) && !hasUserFacingText(parts))) ended.delete(toolCallId);
      }
    },
  };
}

function isAnsweredToolPart(part: { type: string }): part is { type: string; toolCallId: string } {
  const { state, toolCallId } = part as { state?: unknown; toolCallId?: unknown };
  return (part.type.startsWith("tool-") || part.type === "dynamic-tool") && state === "output-available" && typeof toolCallId === "string";
}

/** Инструменты, которые снимают пометку `endTurn`, но ход не кончают (помощники: их цикл идёт до своего итога). */
export function withoutEndTurn(tools: ToolSet | undefined): ToolSet | undefined {
  return withEndTurn(tools, () => () => {});
}

/** `startCall` — на начало вызова; отдаёт, что сделать с просьбой этого вызова. */
function withEndTurn(tools: ToolSet | undefined, startCall: (toolCallId: string) => (text: string | undefined, requireText: boolean) => void | Promise<void>): ToolSet | undefined {
  if (!tools) return tools;
  const wrapped: ToolSet = {};
  for (const [name, original] of Object.entries(tools)) {
    const execute = original.execute;
    wrapped[name] = execute
      ? {
          ...original,
          execute: (input: unknown, options: Parameters<typeof execute>[1]) => {
            const onEnd = startCall(options.toolCallId);
            const unwrap = (value: unknown) => {
              if (!isEndTurnMark(value)) return value;
              const accepted = onEnd(value.text, value.requireText === true);
              return accepted ? accepted.then(() => value.output) : value.output;
            };
            const result = execute(input, options);
            if (isAsyncIterable(result)) return unwrapEach(result, unwrap);
            if (isPromiseLike(result)) return Promise.resolve(result).then(unwrap);
            return unwrap(result);
          },
        }
      : original;
  }
  return wrapped;
}

async function* unwrapEach(results: AsyncIterable<unknown>, unwrap: (value: unknown) => unknown): AsyncGenerator<unknown> {
  for await (const value of results) yield unwrap(value);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | null)?.then === "function";
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof (value as AsyncIterable<unknown> | null)?.[Symbol.asyncIterator] === "function";
}

/**
 * Последний шаг хода без запроса к провайдеру: отдаёт готовый текст как ответ модели. Так текст идёт тем же путём, что
 * написанный моделью (поток, запись, история следующего хода), а расход и наблюдатель вызовов модели его не видят.
 */
export function endTurnModel(text: string | undefined): LanguageModelV4 {
  const id = `end-turn-${crypto.randomUUID()}`;
  const parts: LanguageModelV4StreamPart[] = [
    { type: "stream-start", warnings: [] },
    ...(text === undefined
      ? []
      : ([
          { type: "text-start", id },
          { type: "text-delta", id, delta: text },
          { type: "text-end", id },
        ] satisfies LanguageModelV4StreamPart[])),
    {
      type: "finish",
      finishReason: { unified: "stop", raw: undefined },
      usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } },
    },
  ];
  return {
    specificationVersion: "v4",
    provider: "agent-chat",
    modelId: "end-turn",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("Последний шаг хода идёт только потоком");
    },
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      }),
    }),
  };
}
