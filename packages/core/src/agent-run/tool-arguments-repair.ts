import { repairJson } from "./json-repair";
import { addMissingClosers } from "./missing-closers";
import { dropPrematureCloser } from "./premature-closer";
import { dropStrayClosers } from "./stray-closers";

/** Разобранные аргументы и что для этого пришлось поправить в скобках. */
export interface ParsedArguments {
  value: unknown;
  /** Убранные лишние `}` и `]`: внутри JSON (в том числе посреди объекта) и после его конца. */
  strayClosers: { inside: number; end: number };
  /** Дописанные забытые закрывающие `]` и `}`. */
  missingClosers: number;
}

/** Разбор JSON; не разобрался — без лишних закрывающих скобок, затем с дописанными забытыми. */
export function parseArgumentsLoosely(json: string): ParsedArguments | undefined {
  const none = { inside: 0, end: 0 };
  const attempts = [
    { text: json, strayClosers: none, missingClosers: 0 },
    ...optional(dropStrayClosers(json), (fix) => ({ text: fix.text, strayClosers: { inside: fix.inside, end: fix.end }, missingClosers: 0 })),
    ...optional(addMissingClosers(json), (fix) => ({ text: fix.text, strayClosers: none, missingClosers: fix.added })),
    ...optional(dropPrematureCloser(json), (fix) => ({ text: fix.text, strayClosers: { inside: 1, end: 0 }, missingClosers: 0 })),
  ];
  for (const { text, ...rest } of attempts) {
    try {
      return { value: JSON.parse(text), ...rest };
    } catch {
      // следующая попытка
    }
  }
  return undefined;
}

/**
 * Встроенный починщик текста аргументов вызова инструмента: сырые переводы строк и неверные `\` в строках,
 * лишние закрывающие скобки (в конце, внутри и посреди объекта), забытые закрывающие `]` и `}`.
 * Возвращает починенный JSON-текст или `undefined`, если текст не разобрать без догадок (обрыв в строке, ключе, числе,
 * после запятой или двоеточия). Схему инструмента не проверяет — это делает вызывающий.
 * Годится для `repairToolInput` приложения: сначала встроенная починка, потом своя.
 */
export function repairToolArguments(text: string): string | undefined {
  const parsed = parseArgumentsLoosely(repairJson(text));
  return parsed === undefined ? undefined : JSON.stringify(parsed.value);
}

function optional<Fix, Attempt>(fix: Fix | undefined, toAttempt: (fix: Fix) => Attempt): Attempt[] {
  return fix === undefined ? [] : [toAttempt(fix)];
}
