import type { WidgetLabels } from "../labels";
import type { FormFieldView } from "../skin-contract";

/** Самый длинный текст поля формы (data-model, «Ответы»). */
export const FORM_TEXT_MAX_LENGTH = 2000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Тексты ошибок полей: из словаря надписей, чтобы проверку можно было звать вне React. */
export interface FormCheckMessages {
  required: string;
  notNumber: string;
  notDate: string;
  outOfRange: (min: string | undefined, max: string | undefined) => string;
  tooLong: (max: number) => string;
}

export function formCheckMessages(labels: WidgetLabels): FormCheckMessages {
  return {
    required: labels.formRequired,
    notNumber: labels.formNotNumber,
    notDate: labels.formNotDate,
    outOfRange: labels.formOutOfRange,
    tooLong: labels.formTooLong,
  };
}

export type FormValues = Record<string, string | number>;

export type FormCheck = { ok: true; answer: FormValues } | { ok: false; errors: Record<string, string> };

/**
 * Проверка формы до отправки (FR-014): обязательные поля, числа и даты в пределах, вариант из списка, текст до 2000
 * знаков. Верное — ответ для сервера: числа числами, текст без пробелов по краям, пустые необязательные поля опущены,
 * поля не из формы не уходят.
 */
export function checkForm(fields: readonly FormFieldView[], values: Readonly<Record<string, string | number | undefined>>, messages: FormCheckMessages): FormCheck {
  const answer: FormValues = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = values[field.name];
    const text = raw === undefined ? "" : String(raw).trim();
    if (text.length === 0) {
      if (field.required) errors[field.name] = messages.required;
      continue;
    }
    const checked = checkValue(field, raw, text, messages);
    if (typeof checked === "object") errors[field.name] = checked.error;
    else answer[field.name] = checked;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, answer };
}

function checkValue(field: FormFieldView, raw: string | number | undefined, text: string, messages: FormCheckMessages): string | number | { error: string } {
  const outOfRange = { error: messages.outOfRange(edge(field.min), edge(field.max)) };
  switch (field.kind) {
    case "number": {
      const value = typeof raw === "number" ? raw : Number(text.replace(",", "."));
      if (!Number.isFinite(value)) return { error: messages.notNumber };
      if ((typeof field.min === "number" && value < field.min) || (typeof field.max === "number" && value > field.max)) return outOfRange;
      return value;
    }
    case "date": {
      if (!isRealDate(text)) return { error: messages.notDate };
      // Даты `YYYY-MM-DD` сравниваются как строки.
      if ((typeof field.min === "string" && text < field.min) || (typeof field.max === "string" && text > field.max)) return outOfRange;
      return text;
    }
    case "select":
      return field.options?.includes(text) ? text : { error: messages.required };
    default:
      return text.length > FORM_TEXT_MAX_LENGTH ? { error: messages.tooLong(FORM_TEXT_MAX_LENGTH) } : text;
  }
}

const edge = (value: number | string | undefined) => (value === undefined ? undefined : String(value));

function isRealDate(text: string): boolean {
  if (!DATE_PATTERN.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** Выбор нескольких вариантов: в пределах `min..max` и только из списка — выбор в порядке вариантов; иначе `null`. */
export function checkChoices(options: readonly string[], chosen: readonly string[], min: number, max: number): string[] | null {
  const picked = new Set(chosen);
  if ([...picked].some((option) => !options.includes(option))) return null;
  const ordered = options.filter((option) => picked.has(option));
  return ordered.length >= min && ordered.length <= max ? ordered : null;
}
