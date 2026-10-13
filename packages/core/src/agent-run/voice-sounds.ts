/**
 * Звуки человека, которые голосовой режим слышит помимо слов (FR-027). Список закрытый: звук вне списка (шаги, музыка)
 * для разговора не важен и до модели не доходит.
 */
export const VOICE_SOUNDS = ["laughter", "sigh", "cough", "sneeze", "gasp", "crying", "yawn", "groan"] as const;

export type VoiceSound = (typeof VOICE_SOUNDS)[number];

export function isVoiceSound(value: unknown): value is VoiceSound {
  return typeof value === "string" && (VOICE_SOUNDS as readonly string[]).includes(value);
}

/** Звуки без повторов, порядок по первому появлению; всё, что не из списка, отбрасывается. */
export function uniqueVoiceSounds(values: readonly unknown[]): VoiceSound[] {
  return [...new Set(values.filter(isVoiceSound))];
}

const SOUND_NAMES: Record<VoiceSound, string> = {
  laughter: "смех",
  sigh: "вздох",
  cough: "кашель",
  sneeze: "чих",
  gasp: "резкий вдох",
  crying: "плач",
  yawn: "зевок",
  groan: "стон",
};

/** Пометка модели: в этой фразе человек издал звуки. Служебная: человек её не писал и не видит. */
export function voiceSoundsNote(sounds: readonly VoiceSound[]): string {
  return `[Служебная пометка приложения, человек её не писал и не видит: пока человек говорил, были слышны его звуки: ${sounds.map((sound) => SOUND_NAMES[sound]).join(", ")}. Не упоминай эту пометку.]`;
}
