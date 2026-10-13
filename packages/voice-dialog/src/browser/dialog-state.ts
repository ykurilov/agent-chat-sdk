import type { VoiceDialogError, VoiceDialogState } from "@ykurilov/agent-chat-react";

/** Что случилось с режимом. Каждое событие допустимо только из своих состояний. */
export type DialogEvent =
  | { type: "open" }
  | { type: "connected" }
  /** Фраза человека ушла агенту. */
  | { type: "phrase_sent" }
  | { type: "speech_started" }
  /** Ответ закончился и доигран (или звука не было). */
  | { type: "reply_finished" }
  | { type: "interrupted" }
  /** Агент остановлен, человек продолжает говорить. */
  | { type: "listening_again" }
  | { type: "failed"; error: VoiceDialogError }
  | { type: "close" };

export interface DialogSnapshot {
  state: VoiceDialogState;
  error?: VoiceDialogError;
}

export interface DialogState {
  current(): DialogSnapshot;
  /** `false` — событие в этом состоянии не годится, ничего не изменилось. */
  dispatch(event: DialogEvent): boolean;
  subscribe(listener: (snapshot: DialogSnapshot) => void): () => void;
}

type Step = Partial<Record<Exclude<DialogEvent["type"], "failed" | "close">, VoiceDialogState>>;

/** Обычные переходы; ошибка и выход допустимы из любого включённого состояния (см. `dispatch`). */
const STEPS: Record<VoiceDialogState, Step> = {
  off: { open: "connecting" },
  connecting: { connected: "listening" },
  listening: { phrase_sent: "thinking" },
  thinking: { speech_started: "speaking", reply_finished: "listening", interrupted: "interrupted" },
  speaking: { reply_finished: "listening", interrupted: "interrupted" },
  interrupted: { listening_again: "listening", phrase_sent: "thinking" },
  error: { open: "connecting" },
};

export function createDialogState(): DialogState {
  let snapshot: DialogSnapshot = { state: "off" };
  const listeners = new Set<(snapshot: DialogSnapshot) => void>();

  function next(event: DialogEvent): DialogSnapshot | null {
    const { state } = snapshot;
    if (event.type === "close") return state === "off" ? null : { state: "off" };
    if (event.type === "failed") return state === "off" || state === "error" ? null : { state: "error", error: event.error };
    const target = STEPS[state][event.type];
    return target ? { state: target } : null;
  }

  return {
    current: () => snapshot,
    dispatch(event) {
      const changed = next(event);
      if (!changed) return false;
      snapshot = changed;
      for (const listener of [...listeners]) listener(snapshot);
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
