/** Больше слов в заголовке раздумья не бывает: «Продумываю правила игры», а не пересказ. */
export const THOUGHT_TITLE_MAX_WORDS = 6;

/** Языки на кириллице и на латинице: по ним проверяется, что заголовок написан языком человека. */
const CYRILLIC_LANGUAGES = new Set(["ru", "uk", "be", "bg", "sr", "mk", "kk", "ky", "tg", "mn"]);
const LATIN_LANGUAGES = new Set([
  "en", "de", "fr", "es", "it", "pt", "nl", "pl", "cs", "sk", "sl", "hr", "ro", "hu", "fi", "sv", "no", "nb", "da",
  "et", "lv", "lt", "tr", "az", "uz", "id", "ms", "vi", "tl", "sq", "ca", "eu", "gl", "ga",
]);

const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN = /\p{Script=Latin}/u;

/** Основной код языка: «ru-RU» → «ru». */
const baseLanguage = (language: string): string => language.toLowerCase().split(/[-_]/)[0] ?? "";

/** Язык по тексту человека: есть кириллица — русский, иначе английский. */
export function languageOfText(text: string): string {
  return CYRILLIC.test(text) ? "ru" : "en";
}

/**
 * Написан ли текст письменностью языка: для языков на кириллице нужна кириллица и не больше латинских букв, чем
 * кириллических; для языков на латинице — наоборот. Незнакомый язык не проверяется.
 */
export function fitsLanguage(text: string, language: string): boolean {
  const code = baseLanguage(language);
  const letters = [...text];
  const cyrillic = letters.filter((letter) => CYRILLIC.test(letter)).length;
  const latin = letters.filter((letter) => LATIN.test(letter)).length;
  if (CYRILLIC_LANGUAGES.has(code)) return cyrillic > 0 && cyrillic >= latin;
  if (LATIN_LANGUAGES.has(code)) return latin > 0 && latin >= cyrillic;
  return true;
}

/** Первый заголовок провайдера — строка целиком жирным (`**…**`), так пишет сводку рассуждений GPT. */
export function providerHeadingOf(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const heading = /^\s*\*\*([^*\n]+)\*\*\s*$/.exec(line)?.[1]?.trim();
    if (heading) return heading;
  }
  return undefined;
}

export interface ThoughtTitleRules {
  /** Самый длинный заголовок, знаков. */
  maxLength: number;
  /** Язык человека, код («ru»). */
  language: string;
  /** Имена инструментов хода и навыков: заголовок с ними — техника, а не мысль. */
  toolNames?: readonly string[];
}

/** Знаки кода и путей: обратные кавычки, скобки, слэши, подчёркивание, равно. */
const CODE_SIGNS = /[`{}<>[\]=/\\|$#@_~^]/;

/**
 * Заголовок из ответа модели или провайдера по правилам: первая строка, без разметки, кавычек и точки на конце, с
 * заглавной; 1–6 слов, не длиннее предела, языком человека, без кода, путей и имён инструментов. Иначе `undefined`.
 */
export function cleanThoughtTitle(raw: string, rules: ThoughtTitleRules): string | undefined {
  const line = raw.split("\n").map((part) => part.trim()).find((part) => part.length > 0);
  if (!line) return undefined;
  const title = line
    // «Заголовок: …» — подпись модели перед ответом.
    .replace(/^\*{0,2}(заголовок|title)\*{0,2}\s*:\s*\*{0,2}/iu, "")
    .replace(/\*\*/g, "")
    .replace(/^["'«»“”„]+|["'«»“”„]+$/gu, "")
    .replace(/[.!?:;,…]+$/u, "")
    .replace(/^["'«»“”„]+|["'«»“”„]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (title.length === 0 || title.length > rules.maxLength) return undefined;
  if (title.split(" ").length > THOUGHT_TITLE_MAX_WORDS) return undefined;
  if (CODE_SIGNS.test(title) || /\.[a-z]{1,4}\b/i.test(title)) return undefined;
  const lower = title.toLowerCase();
  if (rules.toolNames?.some((name) => name.length > 2 && lower.includes(name.toLowerCase()))) return undefined;
  if (!fitsLanguage(title, rules.language)) return undefined;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** Заголовок короткого раздумья без модели: его первое предложение, если оно подходит под правила. */
export function shortThoughtTitle(text: string, rules: ThoughtTitleRules): string | undefined {
  const sentence = /^[^.!?\n]+/u.exec(text.trim())?.[0];
  return sentence ? cleanThoughtTitle(sentence, rules) : undefined;
}
