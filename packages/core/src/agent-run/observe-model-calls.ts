import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import type { LanguageModel } from "ai";
import type { ModelPrice } from "../models/model-catalog";
import { costOfUsage } from "../usage/usage-cost";
import type { ModelCallEvent, ModelCallPurpose, TurnObserver } from "./turn-observer";

/** Кому и про что сообщать об обращениях к модели: задаёт тот, кто строит запрос (ход, сжатие, память). */
export interface ModelCallObservation {
  observer: TurnObserver;
  ownerId: string;
  /** Ответ агента, к которому относится обращение; вне хода — `null`. */
  messageId: string | null;
  purpose: ModelCallPurpose;
}

export interface ObserveModelCallsContext extends ModelCallObservation {
  chatId: string;
  modelId: string;
  providerId: string;
  /** Цена модели у провайдера; нет — `costUsd: null`. */
  price?: ModelPrice;
  logError: (message: string) => void;
  /** Часы; в тестах подменяются. */
  now?: () => number;
}

type Status = ModelCallEvent["status"];

/**
 * Прослойка наблюдателя: каждое обращение к модели (и каждая попытка повтора — ставится под обёрткой повторов) —
 * одно событие на конец, сбой или обрыв. Запрос не меняет: `params` только читаются, куски потока идут дальше как есть.
 * Номер попытки — по массиву `prompt`: повтор шлёт тот же массив, новый шаг хода — новый.
 */
export function observeModelCalls(model: LanguageModel, context: ObserveModelCallsContext): LanguageModel {
  // Строка — id модели шлюза SDK; каталог отдаёт готовые модели, строка сюда не приходит.
  if (typeof model === "string") return model;
  const now = context.now ?? Date.now;
  const attempts = new WeakMap<object, number>();
  const nextAttempt = (params: LanguageModelV4CallOptions) => {
    const attempt = (attempts.get(params.prompt) ?? 0) + 1;
    attempts.set(params.prompt, attempt);
    return attempt;
  };

  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      wrapGenerate: async ({ doGenerate, params }) => {
        const call = openCall(params, nextAttempt(params));
        try {
          const result = await doGenerate();
          call.firstChunk();
          call.collectContent(result.content);
          call.finish(result.finishReason, result.usage);
          call.settle("complete");
          return result;
        } catch (error) {
          call.settle(params.abortSignal?.aborted ? "aborted" : "error", error);
          throw error;
        }
      },
      wrapStream: async ({ doStream, params }) => {
        const call = openCall(params, nextAttempt(params));
        let result: Awaited<ReturnType<typeof doStream>>;
        try {
          result = await doStream();
        } catch (error) {
          call.settle(params.abortSignal?.aborted ? "aborted" : "error", error);
          throw error;
        }
        const reader = result.stream.getReader();
        let streamError: { error: unknown } | null = null;
        const stream = new ReadableStream<LanguageModelV4StreamPart>({
          async pull(controller) {
            let read: ReadableStreamReadResult<LanguageModelV4StreamPart>;
            try {
              read = await reader.read();
            } catch (error) {
              call.settle(streamError ? "error" : params.abortSignal?.aborted ? "aborted" : "error", streamError?.error ?? error);
              controller.error(error);
              return;
            }
            if (read.done) {
              call.settle(streamError ? "error" : "complete", streamError?.error);
              controller.close();
              return;
            }
            const part = read.value;
            if (part.type === "error") streamError ??= { error: part.error };
            else call.collectPart(part);
            controller.enqueue(part);
          },
          cancel(reason) {
            call.settle(streamError ? "error" : "aborted", streamError?.error ?? reason);
            return reader.cancel(reason);
          },
        });
        return { ...result, stream };
      },
    },
  });

  function openCall(params: LanguageModelV4CallOptions, attempt: number) {
    const startedAtMs = now();
    const request = requestOf(params);
    const response: ModelCallEvent["response"] = { text: "", reasoning: "", toolCalls: [], finishReason: null };
    let usage: ModelCallEvent["usage"] = null;
    let firstChunkMs: number | null = null;
    let settled = false;
    const firstChunk = () => {
      firstChunkMs ??= now() - startedAtMs;
    };

    return {
      firstChunk,
      collectPart(part: LanguageModelV4StreamPart) {
        if (part.type === "stream-start" || part.type === "response-metadata" || part.type === "raw") return;
        firstChunk();
        if (part.type === "text-delta") response.text += part.delta;
        else if (part.type === "reasoning-delta") response.reasoning += part.delta;
        else if (part.type === "tool-call") response.toolCalls.push(toolCallOf(part));
        else if (part.type === "finish") ({ usage } = finishOf(part.finishReason, part.usage));
      },
      collectContent(content: readonly LanguageModelV4Content[]) {
        for (const part of content) {
          if (part.type === "text") response.text += part.text;
          else if (part.type === "reasoning") response.reasoning += part.text;
          else if (part.type === "tool-call") response.toolCalls.push(toolCallOf(part));
        }
      },
      finish(reason: LanguageModelV4FinishReason, spent: LanguageModelV4Usage) {
        ({ usage } = finishOf(reason, spent));
      },
      settle(status: Status, error?: unknown) {
        if (settled) return;
        settled = true;
        const event: ModelCallEvent = {
          callId: crypto.randomUUID(),
          chatId: context.chatId,
          ownerId: context.ownerId,
          messageId: context.messageId,
          purpose: context.purpose,
          attempt,
          modelId: context.modelId,
          providerId: context.providerId,
          request,
          response,
          usage,
          costUsd: usage && context.price ? costOfUsage(usage, context.price, new Date(startedAtMs)) : null,
          startedAt: new Date(startedAtMs),
          firstChunkMs,
          durationMs: now() - startedAtMs,
          status,
          error: status === "complete" ? null : describeError(error),
        };
        try {
          context.observer.modelCall(event);
        } catch (failure) {
          context.logError(
            `Наблюдатель хода не принял обращение к модели в чате ${context.chatId}: ${failure instanceof Error ? failure.message : String(failure)}`,
          );
        }
      },
    };

    function finishOf(reason: LanguageModelV4FinishReason, spent: LanguageModelV4Usage) {
      response.finishReason = reason.unified;
      return { usage: usageOf(spent) };
    }
  }
}

/** Что ушло провайдеру, без заголовков (в них ключи) и служебного SDK. Ссылки, а не копии: запрос после отправки не меняется. */
function requestOf(params: LanguageModelV4CallOptions): ModelCallEvent["request"] {
  const { prompt, tools, headers: _headers, abortSignal: _abortSignal, includeRawChunks: _includeRawChunks, ...settings } = params;
  const [first, ...rest] = prompt;
  const hasInstructions = first?.role === "system";
  return {
    instructions: hasInstructions ? first : null,
    messages: hasInstructions ? rest : [...prompt],
    tools: (tools ?? []).map((definition) =>
      definition.type === "function"
        ? { name: definition.name, ...(definition.description !== undefined && { description: definition.description }), inputSchema: definition.inputSchema }
        : { name: definition.name, inputSchema: definition.args },
    ),
    settings,
  };
}

function toolCallOf(part: { toolCallId: string; toolName: string; input: string }) {
  return { toolCallId: part.toolCallId, toolName: part.toolName, input: parsedInput(part.input) };
}

/** Вход вызова — JSON-строкой от провайдера; не JSON — строкой как есть. */
function parsedInput(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function usageOf(usage: LanguageModelV4Usage): NonNullable<ModelCallEvent["usage"]> {
  return {
    inputTokens: usage.inputTokens.total ?? 0,
    cachedInputTokens: usage.inputTokens.cacheRead ?? 0,
    cacheWriteTokens: usage.inputTokens.cacheWrite ?? 0,
    outputTokens: usage.outputTokens.total ?? 0,
    reasoningTokens: usage.outputTokens.reasoning ?? 0,
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error === undefined) return "обрыв без причины";
  return typeof error === "string" ? error : String(error);
}
