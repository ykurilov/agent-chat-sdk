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

/** Продиктованный текст целиком: подтверждённая часть и часть, которая ещё может измениться. */
export interface DictatedText {
  finalText: string;
  interimText: string;
}

/** Кто слушает диктовку. После `onError` всегда приходит `onEnd`. */
export interface VoiceListener {
  /** Микрофон и соединение готовы, идёт запись. */
  onConnected(): void;
  /** Накопленный текст диктовки целиком. */
  onText(text: DictatedText): void;
  onError(kind: VoiceErrorKind): void;
  /** Диктовка закончена, ресурсы освобождены. */
  onEnd(): void;
  /** Текст закреплён, сервер причёсывает его моделью (только режим `relay` с чисткой). Дальше `onPolished` или сразу `onEnd`. */
  onPolishing?(): void;
  /** Исправленный текст всей диктовки; приходит только если чистка удалась. Затем `onEnd`. */
  onPolished?(text: string): void;
}

export interface VoiceSession {
  /** Закончить запись, дождаться остатка речи; затем `onEnd`. */
  stop(): void;
  /** Бросить диктовку: слушателя больше не звать. */
  cancel(): void;
}

/** Голосовой ввод для `AgentChat`; настоящий делает `createVoiceInput` из `@ykurilov/agent-chat-voice`. */
export interface VoiceInput {
  start(listener: VoiceListener): VoiceSession;
}
