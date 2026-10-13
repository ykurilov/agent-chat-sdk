/** Что пошло не так с голосом, в терминах человека; готовые надписи живут в словаре чата. */
export type VoiceErrorKind =
  | "permission_denied"
  | "no_microphone"
  | "unsupported"
  | "network"
  | "service_unavailable"
  | "rate_limited"
  | "time_limit"
  | "other";

/** Ошибка подготовки диктовки: несёт готовый вид. */
export class VoiceError extends Error {
  constructor(readonly kind: VoiceErrorKind) {
    super(kind);
    this.name = "VoiceError";
  }
}

/** Вид ошибки по отказу `getUserMedia`. */
export function classifyMicrophoneError(error: unknown): VoiceErrorKind {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "permission_denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no_microphone";
  return "other";
}
