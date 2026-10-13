/**
 * Кусок потока ответа: шаг начат заново у другого провайдера (`providerFallback.onSilence: "restart-step-on-next"`).
 * Клиент убирает всё от последней части `step-start` до этой части включительно. В сохранённом ответе его нет: там
 * стёртого шага уже нет.
 */
export const STEP_RESET_PART_TYPE = "data-step-reset";

/**
 * Кусок потока сразу после `start`: в этом ходе шаг может начаться заново, показанное в нём — стереться. Только клиенту
 * (`transient`), в ответе его нет. Мессенджер по нему придерживает постоянные сообщения до конца шага.
 */
export const STEPS_MAY_RESET_PART_TYPE = "data-steps-may-reset";

/** Данные куска: провайдер, у которого шаг начат заново. */
export interface StepResetData {
  providerId: string;
}

/** Части ответа без стёртых шагов: каждая часть `data-step-reset` убирает себя и всё от последней `step-start` перед ней. */
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

/**
 * Где начинается оборванный шаг ответа, если его можно стереть: номер последней части `step-start`. `null` — частей шага
 * нет или в шаге уже есть вызов инструмента с полным входом: инструмент мог сделать дело, стирать его нельзя.
 */
export function erasableStepStart(parts: readonly { type: string; state?: unknown }[]): number | null {
  const start = parts.findLastIndex((part) => part.type === "step-start");
  if (start === -1) return null;
  const startedCall = parts.slice(start + 1).some((part) => isToolPart(part) && part.state !== "input-streaming");
  return startedCall ? null : start;
}

function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}
