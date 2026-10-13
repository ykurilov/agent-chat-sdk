/** Слово или число целиком; адреса, версии и имена файлов (`10.0.0.5`, `report_v2.pdf`) остаются одним словом. */
const wordPattern = /[\p{L}\p{N}]+(?:[._\-:/][\p{L}\p{N}]+)*/gu;
const lettersOnly = /^\p{L}+$/u;
const wordCharacter = /[\p{L}\p{N}]/u;

/**
 * Нижний регистр и «ё» как «е»: длина текста не меняется, места в нём совпадают с исходным. Буква, которая в нижнем
 * регистре длиннее (турецкая «İ»), остаётся как есть.
 */
export function normalizeText(text: string): string {
  const lower = text.toLowerCase();
  const sameLength = lower.length === text.length ? lower : text.replace(/./gsu, (letter) => (letter.toLowerCase().length === letter.length ? letter.toLowerCase() : letter));
  return sameLength.replaceAll("ё", "е");
}

/** Окончание длинного слова подрезается: «документа», «документы» и «документов» ищутся по «документ». */
function stem(word: string): string {
  if (!lettersOnly.test(word)) return word;
  if (word.length >= 7) return word.slice(0, -2);
  if (word.length >= 5) return word.slice(0, -1);
  return word;
}

/** Слова запроса в том виде, в каком их ищут в тексте. Пустой список — искать нечего. */
export function queryWords(query: string): string[] {
  const words = normalizeText(query).match(wordPattern) ?? [];
  const meaningful = words.filter((word) => word.length > 1);
  return [...new Set((meaningful.length > 0 ? meaningful : words).map(stem))];
}

/** Место, где слово начинает слово текста; -1 — нет. Часть слова в середине другого не считается. Текст — уже нормализованный. */
export function findWord(haystack: string, word: string): number {
  for (let at = haystack.indexOf(word); at >= 0; at = haystack.indexOf(word, at + 1)) {
    if (at === 0 || !wordCharacter.test(haystack[at - 1]!)) return at;
  }
  return -1;
}
