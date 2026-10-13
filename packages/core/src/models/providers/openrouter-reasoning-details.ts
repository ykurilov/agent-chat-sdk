import type {
  JSONValue,
  LanguageModelV4Middleware,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";

type ProviderFields = Record<string, JSONValue | undefined>;

/**
 * Шифр рассуждений GPT и подпись Gemini — «детали рассуждений» (`reasoning_details`). Их нужно вернуть модели
 * на следующем ходе, иначе она не вспомнит, о чём думала. Провайдер OpenRouter для ответа без вызова инструмента
 * кладёт их только в итог шага: части ответа (рассуждение, текст) остаются без них, а у рассуждения, которое уже
 * закрылось, подпись пришла позже. Эта обёртка вешает полные детали шага на текст ответа и перед запросом
 * переносит их с текста на сообщение, откуда провайдер их читает.
 */
export const openrouterReasoningDetailsMiddleware: LanguageModelV4Middleware = {
  specificationVersion: "v4",
  async transformParams({ params }) {
    return { ...params, prompt: withReasoningDetailsOnMessages(params.prompt) };
  },
  async wrapStream({ doStream }) {
    const result = await doStream();
    return { ...result, stream: result.stream.pipeThrough(attachDetailsToText()) };
  },
};

function detailsOf(metadata: { openrouter?: ProviderFields } | undefined): JSONValue[] | undefined {
  const details = metadata?.openrouter?.reasoning_details;
  return Array.isArray(details) && details.length > 0 ? details : undefined;
}

/**
 * Полные детали шага приходят в куске `finish`, а конец текста — в `text-end` перед ним. Конец текста придерживается
 * до `finish` (между ними других кусков провайдер не отдаёт), и детали уходят вместе с ним.
 */
function attachDetailsToText(): TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart> {
  let heldTextEnds: Array<Extract<LanguageModelV4StreamPart, { type: "text-end" }>> = [];
  return new TransformStream({
    transform(part, controller) {
      if (part.type === "text-end") {
        heldTextEnds.push(part);
        return;
      }
      const held = heldTextEnds;
      heldTextEnds = [];
      const details = part.type === "finish" ? detailsOf(part.providerMetadata) : undefined;
      held.forEach((textEnd, index) => {
        const last = index === held.length - 1;
        controller.enqueue(
          details && last
            ? { ...textEnd, providerMetadata: { ...textEnd.providerMetadata, openrouter: { ...textEnd.providerMetadata?.openrouter, reasoning_details: details } } }
            : textEnd,
        );
      });
      controller.enqueue(part);
    },
    flush(controller) {
      for (const textEnd of heldTextEnds) controller.enqueue(textEnd);
    },
  });
}

/** Детали, сохранённые на тексте ответа, — на само сообщение агента: там их читает провайдер, и они главнее деталей на частях. */
function withReasoningDetailsOnMessages(prompt: LanguageModelV4Prompt): LanguageModelV4Prompt {
  return prompt.map((message) => {
    if (message.role !== "assistant" || typeof message.content === "string") return message;
    const saved = message.content.findLast((part) => part.type === "text" && detailsOf(part.providerOptions));
    const details = saved && detailsOf(saved.providerOptions);
    if (!details) return message;
    return {
      ...message,
      providerOptions: { ...message.providerOptions, openrouter: { ...message.providerOptions?.openrouter, reasoning_details: details } },
    };
  });
}
