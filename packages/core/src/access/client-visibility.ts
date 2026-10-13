import type { UIMessageChunk } from "ai";
import { STEP_RESET_PART_TYPE } from "../agent-run/step-reset";
import { PROVIDER_METADATA_KEYS } from "../conversation/select-reasoning";
import type { ChatCapabilities } from "./chat-capabilities";

/**
 * Что из ответа видит браузер по правам `reasoning`, `toolDetails` и `modelDetails`. Хранилище, модель и хуки получают
 * ответ целиком: видимость — только на выходе к клиенту (история, поток, повтор кусков после переподключения).
 */
export interface ClientVisibility {
  /** Всё видно: фильтровать нечего. */
  readonly showsEverything: boolean;
  /** Модель скрыта (`modelDetails: false`). */
  readonly hidesModel: boolean;
  visibleMessage<M extends { role: string; parts: ReadonlyArray<{ type: string }>; metadata?: unknown }>(message: M): M;
  /** Чат истории: при скрытой модели — без выбора модели и владельца. */
  visibleChat<C extends object>(chat: C): C;
  visibleChunks(stream: ReadableStream<UIMessageChunk>): ReadableStream<UIMessageChunk>;
  /**
   * Отметки сжатия: при скрытой работе модели (`modelDetails: false`) — без текста сводки (`summary: ""`,
   * `summaryTokens: 0`). Сводку пишет модель по всей переписке, выходы служебных инструментов в ней пересказаны.
   * Сама отметка остаётся: экран рисует по ней разделитель.
   */
  visibleCompactions<K extends { summary: string; summaryTokens: number }>(markers: K[]): K[];
}

/** Всё разрешено: и история, и поток идут как есть. */
const SHOWS_EVERYTHING: ClientVisibility = {
  showsEverything: true,
  hidesModel: false,
  visibleMessage: (message) => message,
  visibleChat: (chat) => chat,
  visibleChunks: (stream) => stream,
  visibleCompactions: (markers) => markers,
};

/** Поля сообщения о модели: кто ответил и сколько это стоило. */
const MODEL_METADATA_KEYS = ["modelId", "providerId", "usage"] as const;

/** Поля чата о модели и владельце. */
const MODEL_CHAT_KEYS = ["ownerId", "modelId", "providerId", "reasoning"] as const;

const without = <T extends object>(carrier: T, keys: readonly string[]): T => {
  if (!keys.some((key) => key in carrier)) return carrier;
  const rest = { ...carrier } as Record<string, unknown>;
  for (const key of keys) delete rest[key];
  return rest as T;
};

const toolNameOfPart = (part: { type: string; toolName?: unknown }): string | null => {
  if (part.type === "dynamic-tool") return typeof part.toolName === "string" ? part.toolName : null;
  return part.type.startsWith("tool-") ? part.type.slice("tool-".length) : null;
};

/**
 * Пометка инструмента «нужен экран»: `metadata: { showOnScreen: true }` в описании (`tool({ … })`). AI SDK копирует
 * `metadata` инструмента в каждый его вызов (`toolMetadata` у куска потока и части сообщения), модели оно не уходит.
 */
export const SHOW_ON_SCREEN_KEY = "showOnScreen";

/** Вызов помечен как нужный экрану. Вызов без метки (в том числе записанный до пометки) — служебный. */
const markedForScreen = (call: { toolMetadata?: unknown }): boolean => {
  const metadata = call.toolMetadata;
  return typeof metadata === "object" && metadata !== null && (metadata as Record<string, unknown>)[SHOW_ON_SCREEN_KEY] === true;
};

/** Вызов, который спрашивал подтверждения: без его вопроса на экране ход зависнет, поэтому он виден всегда. */
const asksApproval = (part: { type: string }): boolean => {
  const approval = (part as { approval?: unknown }).approval;
  return typeof approval === "object" && approval !== null;
};

/** Куски итога вызова: после них подтверждения уже не будет. */
const CALL_RESULT_CHUNKS: ReadonlySet<string> = new Set(["tool-output-available", "tool-output-error", "tool-output-denied", "tool-input-error"]);

/** Куски мыслей: начало, кусок, конец и файл рассуждения. */
const REASONING_CHUNKS: ReadonlySet<string> = new Set(["reasoning-start", "reasoning-delta", "reasoning-end", "reasoning-file"]);


/**
 * Метаданные поставщика без деталей рассуждений OpenRouter (`openrouter.reasoning_details`: текст или шифр мыслей едет
 * у текста и вызова, чтобы вернуть его модели). Деталей нет — тот же объект.
 */
function withoutReasoningDetails<T extends object>(carrier: T): T {
  let result = carrier;
  for (const key of PROVIDER_METADATA_KEYS) {
    const metadata = (carrier as Record<string, unknown>)[key] as Record<string, unknown> | undefined;
    const openrouter = metadata?.openrouter as Record<string, unknown> | undefined;
    if (typeof openrouter !== "object" || openrouter === null || !("reasoning_details" in openrouter)) continue;
    const { reasoning_details: _details, ...restOpenrouter } = openrouter;
    const { openrouter: _openrouter, ...restMetadata } = metadata!;
    result = { ...result, [key]: Object.keys(restOpenrouter).length > 0 ? { ...restMetadata, openrouter: restOpenrouter } : restMetadata };
  }
  return result;
}

/**
 * Видимость для прав зрителя. При `toolDetails: false` видны вызовы с пометкой `showOnScreen`, инструменты SDK, которым
 * нужен экран (`sdkScreenTool`: виджеты, браузерные), и вызовы, спросившие подтверждения.
 */
export function clientVisibilityOf(
  capabilities: Pick<ChatCapabilities, "reasoning" | "toolDetails" | "modelDetails">,
  sdkScreenTool: (toolName: string) => boolean,
): ClientVisibility {
  const hidesReasoning = !capabilities.reasoning;
  const hidesTools = !capabilities.toolDetails;
  const hidesModel = capabilities.modelDetails === false;
  if (!hidesReasoning && !hidesTools && !hidesModel) return SHOWS_EVERYTHING;
  const hidesCall = (toolName: string, call: { toolMetadata?: unknown }) => hidesTools && !sdkScreenTool(toolName) && !markedForScreen(call);

  const hiddenMetadataKeys = [...(hidesReasoning ? ["reasoningDurationsMs"] : []), ...(hidesModel ? MODEL_METADATA_KEYS : [])];
  const visibleMetadata = (metadata: unknown): unknown =>
    typeof metadata === "object" && metadata !== null ? without(metadata, hiddenMetadataKeys) : metadata;
  // Метаданные поставщика целиком: имя поставщика — ключ, внутри бывают провайдер маршрута, расход и детали мыслей.
  const withoutProviderData = <T extends object>(carrier: T): T =>
    hidesModel ? without(carrier, PROVIDER_METADATA_KEYS) : hidesReasoning ? withoutReasoningDetails(carrier) : carrier;

  return {
    showsEverything: false,
    hidesModel,

    visibleChat: (chat) => (hidesModel ? without(chat, MODEL_CHAT_KEYS) : chat),

    visibleCompactions: (markers) => (hidesModel ? markers.map((marker) => ({ ...marker, summary: "", summaryTokens: 0 })) : markers),

    visibleMessage(message) {
      const kept = message.parts.filter((part) => {
        if (part.type === "reasoning" || part.type === "reasoning-file") return !hidesReasoning;
        const toolName = toolNameOfPart(part as { type: string; toolName?: unknown });
        return toolName === null || !hidesCall(toolName, part as { toolMetadata?: unknown }) || asksApproval(part);
      });
      const parts = kept.map(withoutProviderData);
      const metadata = visibleMetadata(message.metadata);
      return { ...message, parts, ...(message.metadata !== undefined && { metadata }) };
    },

    visibleChunks(stream) {
      // Имя инструмента есть только в первом куске вызова: дальше вызов узнаётся по `toolCallId`. Куски скрытого вызова
      // копятся, пока не ясно, спросит ли он подтверждения: спросил — уходят вместе с запросом, иначе экран не покажет
      // вопрос и ход зависнет; пришёл итог — выбрасываются. `null` — вызов скрыт окончательно.
      const hiddenCalls = new Map<string, UIMessageChunk[] | null>();
      return stream.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          transform(original, controller) {
            const chunk = withoutProviderData(original);
            // Отметка сброса шага несёт провайдера, к которому ушёл ответ; экрану нужен только её тип.
            if (hidesModel && chunk.type === STEP_RESET_PART_TYPE) {
              controller.enqueue({ ...chunk, data: {} } as UIMessageChunk);
              return;
            }
            if (REASONING_CHUNKS.has(chunk.type)) {
              if (!hidesReasoning) controller.enqueue(chunk);
              return;
            }
            if ("toolCallId" in chunk && typeof chunk.toolCallId === "string") {
              const id = chunk.toolCallId;
              if (!hiddenCalls.has(id) && "toolName" in chunk && typeof chunk.toolName === "string" && hidesCall(chunk.toolName, chunk)) hiddenCalls.set(id, []);
              const held = hiddenCalls.get(id);
              if (held === undefined) controller.enqueue(chunk);
              else if (held === null) return;
              else if (chunk.type === "tool-approval-request") {
                hiddenCalls.delete(id);
                for (const earlier of held) controller.enqueue(earlier);
                controller.enqueue(chunk);
              } else if (CALL_RESULT_CHUNKS.has(chunk.type)) hiddenCalls.set(id, null);
              else held.push(chunk);
              return;
            }
            if ("messageMetadata" in chunk && chunk.messageMetadata !== undefined) {
              controller.enqueue({ ...chunk, messageMetadata: visibleMetadata(chunk.messageMetadata) } as UIMessageChunk);
              return;
            }
            controller.enqueue(chunk);
          },
        }),
      );
    },
  };
}
