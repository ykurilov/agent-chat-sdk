/** Слова из четырёх и больше букв или цифр, в нижнем регистре: по ним видно, об одном ли речь. */
export function meaningfulWords(text: string): Set<string> {
  return new Set(text.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]{4,}/gu) ?? []);
}

/** Слово есть в каждой записи из группы. */
export function wordsSharedByAll(texts: readonly string[]): Set<string> {
  const [first = "", ...rest] = texts.map(meaningfulWords);
  return new Set([...first].filter((word) => rest.every((words) => words.has(word))));
}

const TRAILING_PUNCTUATION = /[.,;:!?)\]»"']+$/u;
const LINKS_MAILS_NUMBERS = /https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|@[-\w]+|\d+(?:[.,]\d+)*/gu;
const CAPITALIZED_WORD = /\p{Lu}\p{L}{2,}/gu;

/**
 * Что нельзя потерять при склейке: ссылки, почты, упоминания (@имя), числа и имена (слова с заглавной буквы,
 * кроме первого слова записи: там заглавная стоит по правилам письма). В нижнем регистре.
 */
export function protectedDetails(text: string): string[] {
  const links = (text.match(LINKS_MAILS_NUMBERS) ?? []).map((detail) => detail.replace(TRAILING_PUNCTUATION, ""));
  const names = [...text.matchAll(CAPITALIZED_WORD)].filter((match) => text.slice(0, match.index).trim() !== "").map((match) => match[0]);
  return [...links, ...names].map((detail) => detail.toLocaleLowerCase("ru")).filter((detail) => detail !== "");
}

/** Слова отрицания целиком: «не», «нет», «без», «ни», «никогда» и родственные. Слово, что лишь начинается так (неделя, низко), — не отрицание. */
const NEGATION = /(?<![\p{L}\p{N}])(?:не|нет|без|безо|ни|никогда|никто|ничего|нельзя|нигде|никак)(?![\p{L}\p{N}])/iu;

/** Есть ли в тексте отрицание. Потерянное при склейке, оно переворачивает смысл: «Не любит кофе» + «Любит кофе» → «Любит кофе». */
export function hasNegation(text: string): boolean {
  return NEGATION.test(text);
}
