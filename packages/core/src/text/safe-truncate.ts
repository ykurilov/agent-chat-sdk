const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** Обрезка до `maxLength` знаков без половинки эмодзи: высокий суррогат в конце отбрасывается. */
export function cutAtCharBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const head = text.slice(0, Math.max(0, maxLength));
  return head.length > 0 && isHighSurrogate(head.charCodeAt(head.length - 1)) ? head.slice(0, -1) : head;
}

/** Текст без непарных половинок суррогатов; целые эмодзи остаются. Нет непарных — та же строка. */
export function withoutLoneSurrogates(text: string): string {
  let result: string | null = null;
  let copiedUpTo = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    const paired = isHighSurrogate(code)
      ? index + 1 < text.length && isLowSurrogate(text.charCodeAt(index + 1))
      : !isLowSurrogate(code);
    if (isHighSurrogate(code) && paired) {
      index++;
      continue;
    }
    if (paired) continue;
    result = (result ?? "") + text.slice(copiedUpTo, index);
    copiedUpTo = index + 1;
  }
  return result === null ? text : result + text.slice(copiedUpTo);
}
