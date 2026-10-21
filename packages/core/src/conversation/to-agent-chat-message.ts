import { thoughtTitlesOfParts } from "../thought-titles/thought-title-parts";
import type { AgentChatMessage, StoredMessage, TokenUsage } from "./types";

/** Сообщение из хранилища в вид, который принимают SDK модели и клиент. */
export function toAgentChatMessage(message: StoredMessage): AgentChatMessage {
  if (message.role === "user") return { id: message.id, role: "user", parts: message.parts };
  // Шаги идущего хода с провайдерами нужны только восстановлению на сервере, экрану — нет.
  const { pendingSteps: _steps, ...usage } = message.usage ?? {};
  // Заголовки раздумий лежат в частях рассуждения: экран читает их из метаданных, как длительности.
  const thoughtTitles = thoughtTitlesOfParts(message.parts);
  return {
    id: message.id,
    role: "assistant",
    parts: message.parts,
    metadata: {
      status: message.status,
      reasoningDurationsMs: message.reasoningDurationsMs,
      ...(Object.keys(thoughtTitles).length > 0 && { thoughtTitles }),
      ...(message.modelId && { modelId: message.modelId }),
      ...(message.providerId && { providerId: message.providerId }),
      ...(message.usage && { usage: usage as TokenUsage }),
      ...(message.error && { error: message.error }),
      ...(message.voiceCut && { voiceCut: message.voiceCut }),
    },
  };
}
