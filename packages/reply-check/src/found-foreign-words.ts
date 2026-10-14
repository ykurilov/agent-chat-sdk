// Чужие слова в ответе. Слова не латиницы и не кириллицы — чужие всегда. Слово «соседней» письменности (латиница в
// русском ответе, кириллица в английском) — чужое, только если его нет в знакомых текстах и это не название.
// Так у преподавателя английского его термины законны, а «Actually» посреди русской речи — нет.

export type ReplyScript = "cyrillic" | "latin";

/** Ссылки, почта, @имена, домены вида слово.слово/путь: их не трогаем. */
const UNTOUCHABLE =
  /(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|@[\w.]+|[\p{L}\d-]+(?:\.[\p{L}\d-]+)*\.(?:[a-z]{2,6}|рф)(?!\p{L})(?:\/\S*)?/gu;

/** Слово, где кириллица и латиница вперемешку: латинская буква вместо русской. */
const MIXED_WORD = /\p{L}*(?:\p{Script=Cyrillic}\p{L}*\p{Script=Latin}|\p{Script=Latin}\p{L}*\p{Script=Cyrillic})\p{L}*/gu;

/** Слово не латиницы и не кириллицы: иероглифы, кана, хангыль, арабское, греческое письмо… */
const OTHER_SCRIPT_WORD = /(?:(?![\p{Script=Latin}\p{Script=Cyrillic}])\p{L}[\p{M}]*)+/gu;

const LATIN_WORD = /\p{Script=Latin}+(?:['’-]\p{Script=Latin}+)*/gu;
const CYRILLIC_WORD = /\p{Script=Cyrillic}+(?:['’-]\p{Script=Cyrillic}+)*/gu;

/** Сервисы, которые в русской речи пишут латиницей и с маленькой буквы, и в начале фразы. */
const COMMON_SERVICES = new Set(["zoom", "telegram", "instagram", "youtube", "whatsapp", "google", "skype", "excel", "notion", "viber", "facebook", "tiktok"]);

const ROMAN_NUMERAL = /^[IVXLCDM]+$/;

/** Слова соседней письменности: у русского ответа это латиница, у английского — кириллица. */
function neighborWordsOf(text: string, script: ReplyScript): string[] {
  const words = text.match(script === "cyrillic" ? LATIN_WORD : CYRILLIC_WORD) ?? [];
  return words.filter((word) => word.length > 1 && !(script === "cyrillic" && ROMAN_NUMERAL.test(word)));
}

/** Сокращение из заглавных (PDF), большая буква внутри (WhatsApp), большая буква посреди фразы (в Calendly) — название. */
function isName(word: string, before: string, script: ReplyScript): boolean {
  if (script === "cyrillic" && COMMON_SERVICES.has(word.toLowerCase())) return true;
  if (/^\p{Lu}+$/u.test(word) || /\p{Lu}/u.test(word.slice(1))) return true;
  return /^\p{Lu}/u.test(word) && !/(?:^|[.!?…:\n])[\s«"„“(—-]*$/u.test(before);
}

/**
 * Чужие слова ответа по порядку появления. `known` — тексты, слова соседней письменности из которых законны;
 * `knownNames` — названия, которые пишутся другой письменностью, чем ответ.
 */
export function foreignWordsIn(text: string, known: readonly string[], script: ReplyScript, knownNames: readonly string[] = []): string[] {
  const knownWords = new Set(
    [...known, ...knownNames].flatMap((source) => neighborWordsOf(source.replace(UNTOUCHABLE, " "), script).map((word) => word.toLowerCase())),
  );
  const found: Array<{ at: number; word: string }> = [];
  const clean = text
    .replace(UNTOUCHABLE, (link) => " ".repeat(link.length))
    .replace(MIXED_WORD, (word, at: number) => {
      found.push({ at, word });
      return " ".repeat(word.length);
    });
  for (const match of clean.matchAll(OTHER_SCRIPT_WORD)) found.push({ at: match.index, word: match[0] });
  for (const match of clean.matchAll(script === "cyrillic" ? LATIN_WORD : CYRILLIC_WORD)) {
    const [word] = neighborWordsOf(match[0], script);
    if (word && !knownWords.has(word.toLowerCase()) && !isName(word, clean.slice(0, match.index), script)) found.push({ at: match.index, word });
  }
  return found.sort((a, b) => a.at - b.at).map((item) => item.word);
}
