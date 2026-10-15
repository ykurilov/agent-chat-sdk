import type { LanguageModelV4CallOptions, LanguageModelV4Prompt, LanguageModelV4ToolResultOutput } from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import type { LanguageModel } from "ai";
import { modelAcceptsImages } from "../models/model-catalog";
import type { ModelCatalog, ModelProfile, ProviderDescription } from "../models/model-catalog";
import { errorStatusCode, errorText, underlyingError } from "../provider-errors/error-fields";

/** Пометка запасного текста в результате инструмента: модели он уходит вместо картинки, а с картинкой — вырезается. */
const FALLBACK_NAMESPACE = "agentChat";

/** Пометка вместо картинки, у которой нет запасного текста. Постоянная — кэш модели цел. */
const NO_IMAGE_NOTE = "[Картинка не показана: эта модель у этого провайдера не получает картинки из инструментов.]";

/** Коды отказа в содержимом запроса. Ключ, деньги, частота и сбои сервера — не про картинку. */
const REFUSAL_CODES: ReadonlySet<number> = new Set([400, 413, 415, 422]);

/** Код «запрос слишком велик»: картинка могла его раздуть — этот запрос уходит текстом, но пара не запоминается. */
const TOO_LARGE = 413;

/** Текст отказа говорит о картинке: только такой отказ выключает картинки паре модели и провайдера. */
const IMAGE_REFUSAL = /image|vision|multi-?modal|content[ _-]?type|base64|unsupported content|media[ _-]?type|mime/i;

/** Переполнение контекста — не отказ картинки, даже если в тексте есть слово «image». */
const CONTEXT_OVERFLOW = /context (length|window)|maximum context|too many tokens|token limit|prompt is too long|reduce the length/i;

type ContentItem = Extract<LanguageModelV4ToolResultOutput, { type: "content" }>["value"][number];

/**
 * Запасной текст для картинки в результате инструмента (`toModelOutput`: `{ type: "content", value: [..., картинка,
 * toolImageFallbackText(текст страницы)] }`). Модели, которая получает картинку, он не уходит; модели без картинки
 * уходит вместо неё. Так снимок никогда не идёт модели base64-строкой.
 */
export function toolImageFallbackText(text: string): { type: "text"; text: string; providerOptions: { agentChat: { toolImageFallback: true } } } {
  return { type: "text", text, providerOptions: { [FALLBACK_NAMESPACE]: { toolImageFallback: true } } as { agentChat: { toolImageFallback: true } } };
}

/**
 * Может ли модель видеть картинку в результате инструмента у этого провайдера: видит картинки вообще и провайдер не
 * помечен «точно не видит» (`blindToolResultImageProviders`). Не проверено — не значит «не умеет»: картинка пробуется,
 * отказ провайдера ядро запоминает и дальше шлёт текст.
 */
export function modelMaySeeToolResultImages(
  profile: Pick<ModelProfile, "acceptsImages" | "acceptsImagesByProvider"> & { blindToolResultImageProviders?: readonly string[] },
  providerId: string,
): boolean {
  return modelAcceptsImages(profile, providerId) && !profile.blindToolResultImageProviders?.includes(providerId);
}

/** Отказы провайдеров на время службы: каталог живёт со службой, отказ одной службы не трогает другую. */
const refusalsByCatalog = new WeakMap<ModelCatalog, Set<string>>();

function refusalsOf(catalog: ModelCatalog): Set<string> {
  let refusals = refusalsByCatalog.get(catalog);
  if (!refusals) {
    refusals = new Set();
    refusalsByCatalog.set(catalog, refusals);
  }
  return refusals;
}

/**
 * Картинки в результатах инструментов: картинкой, если провайдер умеет их передавать (`toolResultImages`), модель
 * может их видеть и провайдер ещё не отказывал; иначе — запасным текстом. Отказ провайдера (400, 415, 422) с текстом о
 * картинке — тот же запрос сразу уходит текстом; удался повтор — строка в журнал, и до перезапуска службы эта пара шлёт
 * текст. 413 — текстом только этот запрос. Переполнение контекста и прочие отказы идут дальше как есть. Ошибка внутри
 * уже открытого потока (код 200) не откатывается. Запрос без картинок в результатах инструментов не меняется.
 */
export function withToolResultImagePolicy(
  model: LanguageModel,
  context: { catalog: ModelCatalog; profile: ModelProfile; provider: ProviderDescription; logError?: (message: string) => void },
): LanguageModel {
  if (typeof model === "string") return model;
  const { profile, provider } = context;
  const pair = `${profile.id}@${provider.id}`;
  const refusals = refusalsOf(context.catalog);
  // Проверенный вживую провайдер модели (`toolResultImageProviders`) умеет картинки и без пометки провайдера.
  const carries = provider.toolResultImages === true || profile.toolResultImageProviders?.includes(provider.id) === true;
  const imagesAllowed = () => carries && modelMaySeeToolResultImages(profile, provider.id) && !refusals.has(pair);

  async function attempt<Result>(params: LanguageModelV4CallOptions, call: (params: LanguageModelV4CallOptions) => PromiseLike<Result>): Promise<Result> {
    if (!hasToolResultImages(params.prompt)) return call(params);
    if (!imagesAllowed()) return call({ ...params, prompt: withToolResultImages(params.prompt, false) });
    try {
      return await call({ ...params, prompt: withToolResultImages(params.prompt, true) });
    } catch (error) {
      const cause = underlyingError(error);
      const code = errorStatusCode(cause);
      if (params.abortSignal?.aborted || code === undefined || !REFUSAL_CODES.has(code)) throw error;
      const text = errorText(cause);
      if (CONTEXT_OVERFLOW.test(text)) throw error;
      const aboutImage = code !== TOO_LARGE && IMAGE_REFUSAL.test(text);
      if (code !== TOO_LARGE && !aboutImage) throw error;
      // Повтор упал — дело не в картинке: пара не запоминается, дальше идёт ошибка повтора
      const result = await call({ ...params, prompt: withToolResultImages(params.prompt, false) });
      if (aboutImage) refusals.add(pair);
      context.logError?.(
        aboutImage
          ? `[картинки инструментов] ${provider.id} отказал модели ${profile.id} в картинке из результата инструмента (код ${code}): ` +
              "запрос повторён текстом страницы, до перезапуска службы — только текст"
          : `[картинки инструментов] ${provider.id}: запрос модели ${profile.id} с картинкой слишком велик (код ${code}), повторён текстом страницы`,
      );
      return result;
    }
  }

  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      wrapGenerate: ({ params, model: inner }) => attempt(params, (next) => inner.doGenerate(next)),
      wrapStream: ({ params, model: inner }) => attempt(params, (next) => inner.doStream(next)),
    },
  });
}

function isImage(item: ContentItem): boolean {
  return item.type === "file" && (item.mediaType === "image" || item.mediaType.startsWith("image/"));
}

function isFallback(item: ContentItem): boolean {
  return item.type === "text" && (item.providerOptions?.[FALLBACK_NAMESPACE] as { toolImageFallback?: unknown } | undefined)?.toolImageFallback === true;
}

function hasToolResultImages(prompt: LanguageModelV4Prompt): boolean {
  return prompt.some(
    (message) =>
      message.role === "tool" &&
      message.content.some((part) => part.type === "tool-result" && part.output.type === "content" && part.output.value.some((item) => isImage(item) || isFallback(item))),
  );
}

/** Результаты инструментов с картинкой: `images` — картинки без запасного текста, иначе запасной текст вместо картинок. */
function withToolResultImages(prompt: LanguageModelV4Prompt, images: boolean): LanguageModelV4Prompt {
  return prompt.map((message) => {
    if (message.role !== "tool") return message;
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "tool-result" || part.output.type !== "content") return part;
        return { ...part, output: { ...part.output, value: contentFor(part.output.value, images) } };
      }),
    };
  });
}

function contentFor(value: ContentItem[], images: boolean): ContentItem[] {
  if (images) return value.filter((item) => !isFallback(item));
  const fallbacks = value.filter(isFallback).map((item) => ({ type: "text" as const, text: (item as { text: string }).text }));
  const kept = value.filter((item) => !isImage(item) && !isFallback(item));
  if (fallbacks.length > 0) return [...kept, ...fallbacks];
  return value.some(isImage) ? [...kept, { type: "text", text: NO_IMAGE_NOTE }] : kept;
}
