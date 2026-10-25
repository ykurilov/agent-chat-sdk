/** Причина конечного сбоя. Неизвестное не считается временным сбоем. */
export type ImageFailureKind = "transient" | "content" | "limits" | "configuration" | "delivery" | "unknown";

export interface ImageFailure {
  kind: ImageFailureKind;
  /** Короткая причина без ключей и заголовков подключения. */
  reason: string;
  providerCode?: string;
}

/** Классифицирует только ответ провайдера, никогда не исходный prompt. */
export function providerFailureKind(status: number | undefined, code: string | undefined, message: string): ImageFailureKind {
  // Явные признаки safety-отказа из provider error; одно упоминание темы в prompt сюда не попадает.
  if (/safety_violations\s*=\s*\[[^\]]+\]|rejected by the safety system|content_policy_violation|content policy violation/i.test(message)) return "content";
  if (status === 402 || code === "insufficientCredits") return "limits";
  if (status === 408 || status === 429 || (status !== undefined && status >= 500) || ["timeoutProvider", "providerRateLimitExceeded", "serviceOverloaded", "inferenceRateLimitExceeded"].includes(code ?? "")) return "transient";
  if ((status !== undefined && status >= 400 && status < 500) || code === "invalidApiKey") return "configuration";
  return "unknown";
}

export const canRetryImageFailure = (kind: ImageFailureKind | undefined) => kind === undefined || kind === "transient" || kind === "unknown";
