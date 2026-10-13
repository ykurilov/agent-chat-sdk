import type { LanguageModelV4Middleware, LanguageModelV4Prompt, SharedV4ProviderOptions } from "@ai-sdk/provider";

type PromptMessage = LanguageModelV4Prompt[number];

/**
 * OpenRouter кэширует Gemini по одной метке — последней в сообщениях (документация OpenRouter, раздел про Gemini), а
 * метку на самом конце запроса пропускает: кэш не пишется вовсе. Опыт 2026-10-11 на Gemini 3.8 Flash, запрос ~6300
 * токенов: метка в конце — запись 0; та же метка и короткий хвост после неё — запись 6265, следующий запрос их читает.
 * Поэтому у моделей Google метка с последнего сообщения переезжает на предпоследнее: на шаге 0 это конец прошлого хода,
 * на следующих шагах — вызов инструмента. Перед последним только инструкция (у неё своя метка) — метка с конца
 * снимается. Последнее сообщение без метки (после неё снимок шага или пометка) — запрос не меняется.
 */
export function openrouterGeminiCacheMarkMiddleware(providerModelId: string): LanguageModelV4Middleware | undefined {
  if (!providerModelId.startsWith("google/")) return undefined;
  return {
    specificationVersion: "v4",
    async transformParams({ params }) {
      return { ...params, prompt: withMarkBeforeLast(params.prompt) };
    },
  };
}

function withMarkBeforeLast(prompt: LanguageModelV4Prompt): LanguageModelV4Prompt {
  const last = prompt.at(-1);
  const cacheMark = last && markOf(last);
  if (!last || !cacheMark) return prompt;
  const previous = prompt.at(-2);
  const moved = previous && previous.role !== "system" ? [withMark(previous, cacheMark)] : previous ? [previous] : [];
  return [...prompt.slice(0, -2), ...moved, withoutMark(last)];
}

function cacheControlOf(options: SharedV4ProviderOptions | undefined) {
  return options?.openrouter?.cacheControl;
}

/** Метка сообщения: на самом сообщении или на одной из его частей. */
function markOf(message: PromptMessage) {
  const parts = Array.isArray(message.content) ? (message.content as Array<{ providerOptions?: SharedV4ProviderOptions }>) : [];
  return cacheControlOf(message.providerOptions) ?? parts.map((part) => cacheControlOf(part.providerOptions)).find(Boolean);
}

function withMark(message: PromptMessage, cacheControl: NonNullable<ReturnType<typeof markOf>>): PromptMessage {
  return { ...message, providerOptions: { ...message.providerOptions, openrouter: { ...message.providerOptions?.openrouter, cacheControl } } } as PromptMessage;
}

function withoutMark(message: PromptMessage): PromptMessage {
  const strip = (options: SharedV4ProviderOptions | undefined) => {
    if (!cacheControlOf(options)) return options;
    const { cacheControl: _cacheControl, ...openrouter } = options!.openrouter!;
    const { openrouter: _openrouter, ...rest } = options!;
    return Object.keys(openrouter).length > 0 ? { ...rest, openrouter } : Object.keys(rest).length > 0 ? rest : undefined;
  };
  const content = Array.isArray(message.content)
    ? (message.content as Array<{ providerOptions?: SharedV4ProviderOptions }>).map((part) => {
        const providerOptions = strip(part.providerOptions);
        if (providerOptions === part.providerOptions) return part;
        const { providerOptions: _old, ...rest } = part;
        return providerOptions ? { ...rest, providerOptions } : rest;
      })
    : message.content;
  const providerOptions = strip(message.providerOptions);
  const { providerOptions: _old, ...rest } = message;
  return { ...rest, content, ...(providerOptions && { providerOptions }) } as PromptMessage;
}
