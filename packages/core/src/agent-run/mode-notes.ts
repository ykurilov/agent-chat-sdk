import type { AgentChatMessage } from "../conversation/types";
import { uniqueVoiceSounds } from "./voice-sounds";
import type { VoiceSound } from "./voice-sounds";

/** Тип части-отметки: сообщение человека сказано голосом. Хранится в самом сообщении, экран её не рисует. */
export const VOICE_MODE_PART_TYPE = "data-voice-mode";

/**
 * Тексты пометок для модели: `voice` — «дальше разговор голосом» (функция получает голос сообщения, чтобы дать его теги),
 * `text` — «разговор снова текстом», `voiceChanged` — «с этого сообщения говорит другой голос» (`undefined` — смену не отмечать),
 * `sounds` — «в этой фразе слышны звуки человека» (смех, вздох; FR-027; не задан — звуки в запрос не идут).
 */
export interface ModeNotes {
  voice: string | ((voiceId: string | undefined) => string);
  text: string;
  voiceChanged?: (fromVoiceId: string, toVoiceId: string) => string | undefined;
  sounds?: (sounds: readonly VoiceSound[]) => string;
}

/**
 * Отметка, которую ядро ставит на сообщение человека, отправленное из голосового режима; `voiceId` — голос, которым
 * ответят. `replaces` — склейка (FR-026): id сообщения, которое это заменило; оно считается обрывком и в ветках не видно.
 * `sounds` — звуки человека в этой фразе (FR-027): модель узнаёт о них по пометке, экран их не показывает.
 */
export function voiceModePart(voiceId?: string, replaces?: string, sounds?: readonly VoiceSound[]): AgentChatMessage["parts"][number] {
  const heard = sounds && sounds.length > 0 ? sounds : undefined;
  if (voiceId === undefined && replaces === undefined && heard === undefined) return { type: VOICE_MODE_PART_TYPE, data: true };
  return {
    type: VOICE_MODE_PART_TYPE,
    data: { ...(voiceId !== undefined && { voice: voiceId }), ...(replaces !== undefined && { replaces }), ...(heard && { sounds: [...heard] }) },
  };
}

export function isVoiceMessage(message: Pick<AgentChatMessage, "parts">): boolean {
  return message.parts.some((part) => part.type === VOICE_MODE_PART_TYPE);
}

/** Голос, записанный в отметке сообщения; `undefined` — отметки нет или голос в ней не записан. */
export function voiceOfMessage(message: Pick<AgentChatMessage, "parts">): string | undefined {
  for (const part of message.parts) {
    if (part.type !== VOICE_MODE_PART_TYPE) continue;
    const data = (part as { data?: unknown }).data;
    const voice = typeof data === "object" && data !== null ? (data as { voice?: unknown }).voice : undefined;
    return typeof voice === "string" && voice.length > 0 ? voice : undefined;
  }
  return undefined;
}

/** Звуки человека, записанные в отметке сообщения (без повторов, только из списка); пусто — отметки или звуков нет. */
export function soundsOfMessage(message: Pick<AgentChatMessage, "parts">): VoiceSound[] {
  for (const part of message.parts) {
    if (part.type !== VOICE_MODE_PART_TYPE) continue;
    const data = (part as { data?: unknown }).data;
    const sounds = typeof data === "object" && data !== null ? (data as { sounds?: unknown }).sounds : undefined;
    return Array.isArray(sounds) ? uniqueVoiceSounds(sounds) : [];
  }
  return [];
}

/**
 * Пометки смены режима для модели. История идёт по порядку ветки; у сообщения человека, которое голосовое, тогда как
 * предыдущее сообщение человека — нет (или его нет), в конец добавляется текстовая часть `notes.voice`; у первого
 * текстового сообщения после голосового — `notes.text`. Если голос ответов сменился посреди голосового разговора, у первого
 * сообщения с новым голосом — `notes.voiceChanged` (голос сравнивается с последним известным: сообщение без записанного
 * голоса смены не даёт). Голосовое сообщение со звуками человека получает ещё и `notes.sounds` — последней частью, после
 * пометок входа и смены голоса. Пометки выводятся из сохранённых отметок, поэтому от хода к ходу уже отправленные сообщения не
 * меняются и кэш модели цел. Исходная история не изменяется.
 */
export function withModeNotes(history: readonly AgentChatMessage[], notes: ModeNotes | undefined): readonly AgentChatMessage[] {
  if (!notes) return history;
  let previousWasVoice = false;
  let lastVoiceId: string | undefined;
  return history.map((message) => {
    if (message.role !== "user") return message;
    const voice = isVoiceMessage(message);
    const voiceId = voice ? voiceOfMessage(message) : undefined;
    let note: string | undefined;
    if (voice && !previousWasVoice) {
      note = typeof notes.voice === "string" ? notes.voice : notes.voice(voiceId);
      lastVoiceId = voiceId;
    } else if (voice) {
      if (voiceId !== undefined && lastVoiceId !== undefined && voiceId !== lastVoiceId) note = notes.voiceChanged?.(lastVoiceId, voiceId);
      lastVoiceId = voiceId ?? lastVoiceId;
    } else if (previousWasVoice) {
      note = notes.text;
      lastVoiceId = undefined;
    }
    previousWasVoice = voice;
    const sounds = voice && notes.sounds ? soundsOfMessage(message) : [];
    const added = [note, sounds.length > 0 ? notes.sounds!(sounds) : undefined].filter((text): text is string => Boolean(text));
    return added.length > 0 ? { ...message, parts: [...message.parts, ...added.map((text) => ({ type: "text" as const, text }))] } : message;
  });
}
