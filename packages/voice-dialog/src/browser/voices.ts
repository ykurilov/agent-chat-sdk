import type { VoiceDialogVoice, VoiceDialogVoices } from "@ykurilov/agent-chat-react";

export interface VoiceClientOptions {
  /** Общий путь режима, например `/api/voice-dialog`. */
  basePath: string;
  fetch?: typeof fetch;
}

export interface VoiceClient {
  loadVoices(): Promise<VoiceDialogVoices>;
  selectVoice(id: string): Promise<void>;
  /** Голос, выбранный человеком; `undefined`, пока список не загружен. */
  currentVoiceId(): string | undefined;
  /** Начинается новая реплика: она говорит выбранным сейчас голосом. Возвращает этот голос. */
  beginReply(): string | undefined;
  /** Голос реплики, которая идёт сейчас. Смена голоса посреди реплики её не затрагивает. */
  voiceOfReply(): string | undefined;
}

function isVoiceList(value: unknown): value is VoiceDialogVoices {
  if (typeof value !== "object" || value === null) return false;
  const { voices, current, persisted } = value as Partial<VoiceDialogVoices>;
  return (
    Array.isArray(voices) &&
    voices.every((voice) => typeof voice?.id === "string" && typeof voice?.name === "string") &&
    typeof current === "string" &&
    typeof persisted === "boolean"
  );
}

/** Список голосов и выбор человека; голос идущей реплики не меняется, новый действует со следующей. */
export function createVoiceClient(options: VoiceClientOptions): VoiceClient {
  const base = options.basePath.replace(/\/+$/, "");
  const request = (input: string, init?: RequestInit) => (options.fetch ?? globalThis.fetch)(input, init);
  let chosen: string | undefined;
  let replyVoice: string | undefined;

  return {
    async loadVoices() {
      const response = await request(`${base}/voices`, { method: "GET" });
      if (!response.ok) throw new Error(`Список голосов не получен: ${response.status}`);
      const body: unknown = await response.json();
      if (!isVoiceList(body)) throw new Error("Сервер прислал список голосов в неожиданном виде");
      chosen = body.current;
      return body;
    },
    async selectVoice(id) {
      const response = await request(`${base}/voice`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId: id }),
      });
      if (!response.ok) throw new Error(`Голос не выбран: ${response.status}`);
      chosen = id;
    },
    currentVoiceId: () => chosen,
    beginReply() {
      replyVoice = chosen;
      return replyVoice;
    },
    voiceOfReply: () => replyVoice ?? chosen,
  };
}

/** Меню нужно, когда есть из чего выбирать: голосов два и больше. */
export function voicesForMenu(loaded: VoiceDialogVoices): VoiceDialogVoice[] | undefined {
  return loaded.voices.length > 1 ? loaded.voices : undefined;
}
