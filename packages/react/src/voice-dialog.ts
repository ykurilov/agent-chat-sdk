import type { AnswerStatus, VoiceCut, VoiceSound } from "./chat-types";

/** Состояние голосового режима глазами человека. `interrupted` — человек только что перебил, агент замолчал. */
export type VoiceDialogState = "off" | "connecting" | "listening" | "thinking" | "speaking" | "interrupted" | "error";

/** Что пошло не так с режимом, в терминах человека; готовые надписи живут в словаре чата (`voiceDialog.errors`). */
export type VoiceDialogError =
  | "microphone_denied"
  | "microphone_missing"
  | "network"
  | "service_unavailable"
  | "recognition_lost"
  | "speech_unavailable"
  | "limit"
  | "rate_limited"
  | "idle"
  | "backgrounded";

export interface VoiceDialogVoice {
  id: string;
  name: string;
}

/** Голосовой режим в поле ввода (договор скина, версия 10). */
export interface VoiceDialogView {
  state: VoiceDialogState;
  error?: VoiceDialogError;
  /** `false` — слушаем и пишем, но не озвучиваем. */
  speechAvailable: boolean;
  /** Нет или один голос — меню не показывать. */
  voices?: VoiceDialogVoice[];
  currentVoiceId?: string;
  /** Громкость микрофона 0..1 для индикации. */
  level?: number;
  /** Включить или выключить режим. Вызывается из нажатия: браузер разрешает звук только так. */
  onToggle: () => void;
  onSelectVoice?: (id: string) => void;
}

/** Список голосов сервера и выбор человека; `persisted: false` — сервер выбор не запоминает. */
export interface VoiceDialogVoices {
  voices: VoiceDialogVoice[];
  current: string;
  persisted: boolean;
}

/** Приращение текста ответа агента, идущего сейчас. `partIndex` — номер текстовой части в `parts` сообщения. */
export interface AssistantTextDelta {
  messageId: string;
  partIndex: number;
  text: string;
}

/** Ответ агента закончился; `status` — чем именно (остановлен, ошибка и так далее). */
export interface AnswerEnd {
  messageId: string;
  status: AnswerStatus;
}

/**
 * Модель размышляет или вызывает инструмент: часть `reasoning` или `tool-*` ответа началась (`start`) или закончилась (`end`).
 * Для `end` при ошибке инструмента и при конце ответа тоже приходит, так что пары всегда замкнуты.
 */
export interface AssistantActivity {
  messageId: string;
  /** Номер части в `parts` сообщения: по нему начало и конец сопоставляются. */
  partIndex: number;
  kind: "reasoning" | "tool";
  /** Имя инструмента; только у `tool`. */
  toolName?: string;
  phase: "start" | "end";
}

/**
 * Что движок режима знает о чате: отправить слова, остановить ответ и следить за текстом ответа.
 * Настоящий мост делает хук `useVoiceDialog`; отправка идёт с признаком голосового режима (`voiceMode`).
 */
export interface DialogChatBridge {
  /**
   * Отправить слова агенту. Если отправить нельзя (пусто, ответ ещё идёт, чат не загружен),
   * мост сообщает об этом через `subscribeAnswerEnd` как об ответе со статусом `error` и пустым `messageId`.
   */
  send(text: string, options?: { sounds?: readonly VoiceSound[] }): void;
  /** Остановить идущий ответ; выполнено, когда ход остановлен. */
  stop(): Promise<void>;
  /**
   * Склейка (`options.sounds` — звуки человека, ещё не отправленные модели): вместо последнего сообщения человека отправить `text` (прежние слова вместе с новыми) и остановить ход, у которого ещё нет
   * ни текста, ни звука. Прежнего сообщения и пустого оборванного ответа в чате не остаётся, модель отвечает один раз.
   * `true` — склеено, идёт ответ на `text`. `false` — не вышло (у ответа уже есть текст, сообщение набрано не голосом, сервер отказал):
   * ход мог быть остановлен, текст не отправлен. Необязательный: мост без него — новые слова в ожидании ответа идут отдельным сообщением.
   */
  replaceLastMessage?(text: string, options?: { sounds?: readonly VoiceSound[] }): Promise<boolean>;
  /** Приращения текста ответа. Возвращает отписку. */
  subscribeAssistantText(listener: (delta: AssistantTextDelta) => void): () => void;
  /** Конец ответа. Возвращает отписку. */
  subscribeAnswerEnd(listener: (end: AnswerEnd) => void): () => void;
  /**
   * Размышление и вызовы инструментов: по ним голос говорит заполнители («Сейчас поищу…»). Необязательный: мост без него —
   * режим работает, заполнителей нет. Возвращает отписку.
   */
  subscribeAssistantActivity?(listener: (activity: AssistantActivity) => void): () => void;
  /** Показать отметку обрыва у ответа сразу, до записи на сервере (у хранилища может не быть `setVoiceCut`). */
  showCut(messageId: string, cut: VoiceCut): void;
}

export interface VoiceDialogOpenOptions {
  chatId: string;
  chat: DialogChatBridge;
  /** Вызывается при каждом изменении вида режима. */
  onView(view: VoiceDialogView): void;
}

/** Голосовой режим для `AgentChat`; настоящий делает `createVoiceDialogEngine` из `@ykurilov/agent-chat-voice-dialog`. */
export interface VoiceDialogEngine {
  /** Включить режим. Звать внутри нажатия пользователя. Дальше состояние приходит через `onView`. */
  open(options: VoiceDialogOpenOptions): void;
  close(): void;
  selectVoice(id: string): Promise<void>;
  loadVoices(): Promise<VoiceDialogVoices>;
}
