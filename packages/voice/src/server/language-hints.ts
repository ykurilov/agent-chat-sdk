/** Больше языков подсказка не держит: Soniox берёт подсказку как намёк, длинный список его только путает. */
const MAX_HINTS = 3;
/** Код языка ISO 639: две-три латинские буквы; регион (`en-US`, `pt_BR`) отбрасывается. */
const LANGUAGE_CODE = /^([a-z]{2,3})(?:[-_][a-z0-9]{2,8})*$/i;

/**
 * Подсказка языка от браузера после проверки: только похожие на код языка строки, без региона и повторов, не больше трёх,
 * и только из `allowed`, если он задан. Ничего годного — `null`: остаётся подсказка сервера.
 */
export function acceptedLanguageHints(value: unknown, allowed?: readonly string[]): string[] | null {
  if (!Array.isArray(value)) return null;
  // Список приложения сравниваем по языку без региона: `pt-BR` в нём разрешает `pt`.
  const permitted = allowed ? new Set(allowed.map(baseLanguage)) : null;
  const hints: string[] = [];
  for (const item of value.slice(0, 16)) {
    const code = baseLanguage(item);
    if (!code || hints.includes(code) || (permitted && !permitted.has(code))) continue;
    hints.push(code);
    if (hints.length === MAX_HINTS) break;
  }
  return hints.length > 0 ? hints : null;
}

/** Язык без региона в нижнем регистре: `pt-BR` → `pt`. Не код языка — `undefined`. */
function baseLanguage(item: unknown): string | undefined {
  return typeof item === "string" ? LANGUAGE_CODE.exec(item)?.[1]?.toLowerCase() : undefined;
}
