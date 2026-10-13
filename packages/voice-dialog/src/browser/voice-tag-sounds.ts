/**
 * Ожидаемые звуки для фильтра эха. Голос на месте тега смеётся или вздыхает, и распознавание слышит это словами:
 * смех — «Ха-ха», вздох — «Эх». Без этого смех модели из динамика в микрофоне фильтр принял бы за перебивание.
 * Тег узнаётся по смыслу слова, а не по закрытому списку: голос принимает и теги, которых модели не называли.
 */

import type { HumanSoundKind } from "../protocol";

const LAUGH = ["ха", "ха-ха", "ха-ха-ха", "хе", "хе-хе", "хи", "хи-хи"];
const SIGH = ["эх", "ох", "ах", "фух", "уф"];

const SOUNDS_BY_MEANING: Array<{ meaning: RegExp; sounds: string[] }> = [
  { meaning: /laugh|chuckl|giggl|snort|cackl|wheez|snicker|guffaw|chortl/, sounds: LAUGH },
  { meaning: /sigh|exhal|huff|groan|puff/, sounds: SIGH },
  { meaning: /gasp/, sounds: ["ах", "ох", "ух"] },
  { meaning: /cry|sob|weep|whimper|sniff/, sounds: ["ох", "ах", "эх"] },
  { meaning: /cough|throat/, sounds: ["кхм", "кхе", "кха", "кх"] },
  { meaning: /yawn/, sounds: ["ааа", "а-а-а", "ах"] },
  { meaning: /\bhm+\b|\bhum/, sounds: ["хм", "мм", "ммм"] },
];

/** Вид звука: смех, вздох (в том числе «ах» удивления и «ох» плача), «хм», кашель, зевок. */
export type SoundClass = "laugh" | "sigh" | "hm" | "cough" | "yawn";

/*
 * Распознавание пишет звуки как придётся: смех — «Ха-ха-ха», «Ха-ха-ха-ха», «Хахахахаха», «Ахаха»; вздох — «Эх», «Ээх», «Оох».
 * Закрытым списком их не перечислить, поэтому слово узнаётся по шаблону: повторы слога и растянутые гласные.
 */
const SOUND_PATTERNS: Array<[SoundClass, RegExp]> = [
  ["laugh", /^[ао]?(?:х[аеиоя])+х?$/],
  ["sigh", /^(?:[эеоау]{1,6}х{1,3}|ф?у{1,4}ф{1,3}|фу{1,4}х)$/],
  ["hm", /^(?:хм{1,6}|м{2,6})$/],
  ["cough", /^(?:кх[меа]?)+$/],
  ["yawn", /^а{2,}х?$/],
];

/** Вид звука, который передаёт слово (строчное, только буквы, «ё» как «е»); `null` — обычное слово. */
export function soundClassOf(word: string): SoundClass | null {
  for (const [soundClass, pattern] of SOUND_PATTERNS) if (pattern.test(word)) return soundClass;
  return null;
}

/** Слова, которыми распознавание передаст звук тега. Тег с подачей без звука («whispers», «excited») — пустой список. */
export function expectedSoundsFor(tag: string): string[] {
  // Закрывающий тег («[/laughs]») звука не даёт.
  if (tag.startsWith("/")) return [];
  const name = tag.toLowerCase();
  const sounds = new Set<string>();
  for (const entry of SOUNDS_BY_MEANING) {
    if (entry.meaning.test(name)) for (const sound of entry.sounds) sounds.add(sound);
  }
  return [...sounds];
}

/**
 * Какие звуки человека (виды Scribe) может издать голос на месте тега: по ним звук в микрофоне опознаётся как эхо.
 * Вздох Scribe может назвать и вздохом, и стоном, поэтому у него два вида.
 */
const HUMAN_KINDS_BY_MEANING: Array<{ meaning: RegExp; kinds: HumanSoundKind[] }> = [
  { meaning: /laugh|chuckl|giggl|snort|cackl|wheez|snicker|guffaw|chortl/, kinds: ["laughter"] },
  { meaning: /sigh|exhal|huff|groan|puff/, kinds: ["sigh", "groan"] },
  { meaning: /gasp/, kinds: ["gasp"] },
  { meaning: /cry|sob|weep|whimper|sniff/, kinds: ["crying"] },
  { meaning: /cough|throat/, kinds: ["cough"] },
  { meaning: /yawn/, kinds: ["yawn"] },
  { meaning: /sneez/, kinds: ["sneeze"] },
];

const KINDS_BY_CLASS: Partial<Record<SoundClass, HumanSoundKind[]>> = {
  laugh: ["laughter"],
  sigh: ["sigh", "groan"],
  cough: ["cough"],
  yawn: ["yawn"],
};

/** Виды звуков человека, которые издаёт голос на месте тега; тег с подачей без звука («whispers») — пустой список. */
export function soundKindsOfTag(tag: string): HumanSoundKind[] {
  if (tag.startsWith("/")) return [];
  const name = tag.toLowerCase();
  const kinds = new Set<HumanSoundKind>();
  for (const entry of HUMAN_KINDS_BY_MEANING) {
    if (entry.meaning.test(name)) for (const kind of entry.kinds) kinds.add(kind);
  }
  return [...kinds];
}

/** Предложение целиком из звуковых слов («Ха-ха!», «Эх…»): голос произносит его как звук, а не как слово. */
export interface Interjection {
  /** Где предложение начинается в тексте. */
  at: number;
  kinds: HumanSoundKind[];
}

/**
 * Отдельные звуковые междометия в тексте: предложение, где нет ничего, кроме звуковых слов. «Ах» внутри обычного предложения
 * («Ах, как красиво!») — слово, голос его проговаривает, и звуком агента оно не считается.
 */
export function interjectionsIn(text: string): Interjection[] {
  const found: Interjection[] = [];
  for (const sentence of text.matchAll(/[^.!?…\n]+/g)) {
    const words = sentence[0].toLowerCase().replace(/ё/g, "е").split(/[^а-я-]+/).filter((word) => word.replace(/-/g, "") !== "");
    if (words.length === 0) continue;
    const kinds = new Set<HumanSoundKind>();
    let onlySounds = true;
    for (const word of words) {
      const soundClass = soundClassOf(word.replace(/-/g, ""));
      if (!soundClass) {
        onlySounds = false;
        break;
      }
      for (const kind of KINDS_BY_CLASS[soundClass] ?? []) kinds.add(kind);
    }
    if (onlySounds && kinds.size > 0) found.push({ at: sentence.index + sentence[0].search(/\S/), kinds: [...kinds] });
  }
  return found;
}

/** Виды звуков человека, которые слышны в отдельных звуковых междометиях озвученного текста («Ха-ха!», «Эх…»). */
export function soundKindsOfText(text: string): HumanSoundKind[] {
  return [...new Set(interjectionsIn(text).flatMap((item) => item.kinds))];
}
