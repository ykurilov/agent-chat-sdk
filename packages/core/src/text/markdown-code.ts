/** Ограда блока кода в начале строки (``` или ~~~, не дальше трёх пробелов от края) или `null`. */
export function codeFenceOf(line: string): string | null {
  return /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
}

/** Строка закрывает блок кода, открытый оградой `fence`: та же ограда не короче, и больше ничего в строке. */
export function closesCodeFence(line: string, fence: string): boolean {
  const opener = codeFenceOf(line);
  return opener !== null && opener[0] === fence[0] && opener.length >= fence.length && line.trim() === opener;
}

/** Строка — код с отступом (4 пробела или табуляция) или цитата (`> …`). */
export function isIndentedCodeOrQuote(line: string): boolean {
  return /^(?: {4}|\t)/.test(line) || /^\s*>/.test(line);
}
