/**
 * Отметка ядра «шаг начат заново у другого провайдера»: всё от последней части `step-start` до неё стёрто.
 * Копия логики ядра (`withoutResetSteps`): React не зависит от ядра. Что копии совпадают, проверяет общий тест.
 */
export const STEP_RESET_PART_TYPE = "data-step-reset";

/** Части ответа без стёртых шагов: каждая часть `data-step-reset` убирает себя и всё от последней `step-start` перед ней. Сброса нет — тот же массив. */
export function withoutResetSteps<Part extends { type: string }>(parts: readonly Part[]): Part[] {
  if (!parts.some((part) => part.type === STEP_RESET_PART_TYPE)) return parts as Part[];
  const kept: Part[] = [];
  for (const part of parts) {
    if (part.type !== STEP_RESET_PART_TYPE) {
      kept.push(part);
      continue;
    }
    const stepStart = kept.findLastIndex((candidate) => candidate.type === "step-start");
    if (stepStart !== -1) kept.length = stepStart;
  }
  return kept;
}

/** Сообщения без стёртых шагов; ничего не стёрто — тот же массив. */
export function withoutResetMessages<Message extends { parts: Array<{ type: string }> }>(messages: Message[]): Message[] {
  let changed = false;
  const shown = messages.map((message) => {
    const parts = withoutResetSteps(message.parts);
    if (parts === message.parts) return message;
    changed = true;
    return { ...message, parts };
  });
  return changed ? shown : messages;
}
