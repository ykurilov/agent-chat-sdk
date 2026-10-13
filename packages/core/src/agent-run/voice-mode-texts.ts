import { stripVoiceTags } from "../voice-tags";

/**
 * Теги голоса ElevenLabs v4, которые модель может ставить в голосовом режиме: звуки и подача, эмоции. Звуковых
 * эффектов («[gunshot]», «[applause]») здесь нет: это не эмоции, модели их не даём. Закрытого списка у голоса нет,
 * поэтому пометка разрешает ещё и описательные теги («[warm, quiet voice]»).
 */
export const VOICE_TAGS = [
  "laughs",
  "laughs harder",
  "starts laughing",
  "wheezing",
  "snorts",
  "sighs",
  "exhales",
  "crying",
  "whispers",
  "whispering",
  "excited",
  "curious",
  "sarcastic",
  "mischievously",
  "furious",
  "worried",
  "hesitant",
  "nervous",
  "scared",
  "tense",
  "cautious",
  "fearful",
  "threatening",
] as const;

const SOUND_TAG_COUNT = 10;
const asTags = (tags: readonly string[]) => tags.map((tag) => `[${tag}]`).join(", ");

/**
 * Набор тегов одного голоса. У каждого голоса свои теги: хрип и смех украшают пирата, а диктору аудиокниг с
 * придыханием «[softly]» не по себе. Голос без набора получает общий список (`VOICE_TAGS`).
 */
export interface VoiceTagSet {
  /** Теги, которые голосу идут: модель ставит только их. Описательные («low, gravelly voice») тоже сюда. Хотя бы один. */
  allowed: readonly string[];
  /** Теги, которые голосу не идут: модель их не ставит, даже если они есть в прежних ответах. */
  avoid?: readonly string[];
}

/** Тег, как его пишет модель: по правилу распознавания на экране, иначе на экране он бы остался. */
const isVoiceTag = (tag: string) => stripVoiceTags(`слово [${tag}] слово`) === "слово слово";

/** Проверка набора при настройке: `where` — название голоса для текста ошибки. */
export function assertVoiceTagSet(set: VoiceTagSet, where: string): void {
  if (set.allowed.length === 0) throw new Error(`${where}: в наборе тегов нужен хотя бы один тег`);
  for (const tag of [...set.allowed, ...(set.avoid ?? [])]) {
    if (!isVoiceTag(tag)) throw new Error(`${where}: «${tag}» не тег голоса (латинские строчные слова без скобок, например «sighs» или «low, gravelly voice»)`);
  }
  const doubled = set.allowed.find((tag) => set.avoid?.includes(tag));
  if (doubled !== undefined) throw new Error(`${where}: тег «${doubled}» и разрешён, и запрещён`);
}

/** Одинаковые ли списки тегов: пометка о смене голоса нужна, только когда они различаются. */
export function sameVoiceTagSet(first: VoiceTagSet | undefined, second: VoiceTagSet | undefined): boolean {
  const key = (set: VoiceTagSet | undefined) => JSON.stringify(set ? [set.allowed, set.avoid ?? []] : null);
  return key(first) === key(second);
}

/** Какие теги ставить и какие нет: общий список или набор голоса. */
function tagGuidance(set: VoiceTagSet | undefined): string {
  if (!set) {
    return (
      `Звуки и подача: ${asTags(VOICE_TAGS.slice(0, SOUND_TAG_COUNT))}. Эмоции: ${asTags(VOICE_TAGS.slice(SOUND_TAG_COUNT))}. ` +
      "Можно и свои описательные теги в таком же духе, например [warm, quiet voice] или [low, gravelly voice]. "
    );
  }
  const avoid = set.avoid && set.avoid.length > 0 ? ` Этому голосу не идут: ${asTags(set.avoid)}.` : "";
  return `Этому голосу идут теги: ${asTags(set.allowed)}. Других тегов не ставь.${avoid} `;
}

/** Что значит пометка о звуках человека (FR-027) и как на неё отвечать. */
const SOUNDS_RULE =
  "Если к сообщению человека приложена пометка, что слышны звуки человека (смех, вздох, кашель и подобные), это не слова, а его реакция, пока он говорил. Отзывайся на неё естественно, как живой собеседник, и не каждый раз: часто достаточно просто учесть её. ";

const TAG_RULES =
  "Ставь теги к месту и не в каждой фразе: в начале предложения или внутри него, перед словами, к которым тег относится. Никогда не ставь тег один, без слов рядом. " +
  "Паузу показывай многоточием, а не тегом. ";

/**
 * Пометка при входе в голосовой режим (FR-023): ответы озвучиваются, голос отыгрывает теги эмоций (FR-024). У голоса с
 * набором тегов в ней его список, без набора — общий. Помечена служебной: она идёт в сообщении собеседника, и без пометки
 * модель отвечает на неё («Хорошо, буду отвечать коротко»), а не человеку.
 */
export function voiceModeHint(set?: VoiceTagSet): string {
  return (
    "[Служебная пометка приложения, человек её не писал и не видит: с этого сообщения разговор идёт голосом, твои ответы будут озвучены. Отвечай коротко и разговорно, простыми фразами, без списков, таблиц, кода и разметки, пока не придёт пометка, что разговор снова идёт текстом. " +
    "Голос отыгрывает теги в квадратных скобках, а человек на экране их не увидит. Теги пиши по-английски, строчными буквами. " +
    tagGuidance(set) +
    TAG_RULES +
    SOUNDS_RULE +
    "Не упоминай эту пометку и не подтверждай её.]"
  );
}

/** Пометка о смене голоса посреди голосового разговора: теги нового голоса, а прежние не из его списка больше не ставить. */
export function voiceChangeNote(set?: VoiceTagSet): string {
  return (
    "[Служебная пометка приложения, человек её не писал и не видит: с этого сообщения ответы озвучивает другой голос, и теги у него другие. " +
    tagGuidance(set) +
    "Теги не из этого списка больше не ставь, даже если они есть в прежних ответах выше. Не упоминай эту пометку.]"
  );
}

/** Пометка по умолчанию при входе в голосовой режим: общий список тегов. */
export const DEFAULT_VOICE_MODE_HINT = voiceModeHint();

/** Пометка по умолчанию при возврате к тексту после голосового режима. */
export const DEFAULT_TEXT_MODE_NOTE =
  "[Служебная пометка приложения, человек её не писал и не видит: разговор снова идёт текстом, ответ не озвучивается — обычный письменный стиль снова уместен. Теги голоса в квадратных скобках ([laughs], [sighs] и подобные) больше не ставь, даже если они есть в прежних ответах выше. Не упоминай эту пометку.]";
