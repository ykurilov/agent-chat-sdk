import type { AgentChatMessage } from "./types";

/** Поля частей и кусков, где провайдер прячет своё: шифр рассуждений, подписи, провайдер маршрута, расход. Общий список: его же чистит видимость для браузера. */
export const PROVIDER_METADATA_KEYS = ["providerMetadata", "callProviderMetadata", "resultProviderMetadata"] as const;

/**
 * Копия истории, в которой остались только рассуждения, которые можно вернуть модели:
 * той же модели и того же провайдера, и только если профиль разрешает возврат прошлых ходов.
 * У остальных ответов убираются и метаданные провайдера на частях: зашифрованное рассуждение лежит
 * не только в части `reasoning`, но и в вызовах инструментов и в тексте, а OpenRouter читает его у любой модели.
 */
export function selectReasoningForModel(
  messages: readonly AgentChatMessage[],
  target: { modelId: string; providerId: string; replayPastTurns: boolean },
): AgentChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") return message;
    const sameModel =
      message.metadata?.modelId === target.modelId && message.metadata?.providerId === target.providerId;
    if (sameModel && target.replayPastTurns) return message;
    return {
      ...message,
      parts: message.parts.filter((part) => part.type !== "reasoning").map(withoutProviderMetadata),
    };
  });
}

function withoutProviderMetadata<Part extends object>(part: Part): Part {
  if (!PROVIDER_METADATA_KEYS.some((key) => key in part)) return part;
  const copy = { ...part } as Record<string, unknown>;
  for (const key of PROVIDER_METADATA_KEYS) delete copy[key];
  return copy as Part;
}
