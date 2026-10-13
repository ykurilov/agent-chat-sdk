import { tool } from "ai";
import type { Tool } from "ai";
import { z } from "zod";
import type { BasicWidgetName } from "./widget-types";

/** Базовые виджеты по имени: порядок — как у инструментов в запросе (по алфавиту). */
export const BASIC_WIDGET_NAMES: readonly BasicWidgetName[] = ["ask_choice", "ask_form", "ask_multi_choice", "ask_rating", "suggest_replies"];

/** Результат подсказок: ход не ждёт, модель сразу узнаёт, что кнопки показаны. */
export const SUGGESTIONS_SHOWN = "показано";

/** Самый длинный текст в поле формы. */
const FORM_TEXT_MAX = 2000;

/** Проверка ответа: годный — с ответом, каким его увидит модель; негодный — без подробностей (в журнал содержимое не идёт). */
export type WidgetAnswerCheck = { ok: true; output: unknown } | { ok: false };

const question = z.string().min(1).max(300);
const options = z
  .array(z.string().min(1).max(80))
  .min(2)
  .max(8)
  .refine((values) => new Set(values).size === values.length, "Варианты не должны повторяться");

const choiceInput = z.object({ question, options });

const multiChoiceInput = z
  .object({ question, options, min: z.number().int().optional(), max: z.number().int().optional() })
  .superRefine((input, context) => {
    const { min, max } = multiChoiceLimits(input);
    if (min < 1 || min > max || max > input.options.length) {
      context.addIssue({ code: "custom", message: "Нужно 1 ≤ min ≤ max ≤ числа вариантов", path: ["min"] });
    }
  });

// Одна плоская схема, а не объединение: провайдеры (OpenAI) ждут объект на верхнем уровне схемы инструмента.
const ratingInput = z
  .object({
    question,
    scale: z.enum(["stars", "range"]),
    from: z.union([z.literal(0), z.literal(1)]).optional(),
    to: z.number().int().min(2).max(10).optional(),
    fromLabel: z.string().min(1).max(40).optional(),
    toLabel: z.string().min(1).max(40).optional(),
  })
  .superRefine((input, context) => {
    const rangeFields = [input.from, input.to, input.fromLabel, input.toLabel].some((value) => value !== undefined);
    if (input.scale === "stars" && rangeFields) context.addIssue({ code: "custom", message: "У звёзд нет from, to и подписей", path: ["scale"] });
    if (input.scale === "range" && (input.from === undefined || input.to === undefined)) {
      context.addIssue({ code: "custom", message: "У шкалы range нужны from (0 или 1) и to (2–10)", path: ["from"] });
    }
  });

const formField = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9_]+$/, "name — латиница, цифры и _").max(64),
    label: z.string().min(1).max(80),
    kind: z.enum(["text", "number", "date", "select"]),
    required: z.boolean().optional(),
    min: z.union([z.number(), z.string()]).optional(),
    max: z.union([z.number(), z.string()]).optional(),
    options: options.optional(),
    multiline: z.boolean().optional(),
  })
  .superRefine((field, context) => {
    const issue = (message: string) => context.addIssue({ code: "custom", message, path: [field.name] });
    if (field.kind === "select" && !field.options) issue("У select нужны options: 2–8 вариантов");
    if (field.kind !== "select" && field.options) issue("options — только у select");
    if (field.kind === "number") {
      if ((field.min !== undefined && typeof field.min !== "number") || (field.max !== undefined && typeof field.max !== "number")) issue("У number min и max — числа");
      else if (field.min !== undefined && field.max !== undefined && field.min > field.max) issue("У number нужно min ≤ max");
    } else if (field.kind === "date") {
      const dates = [field.min, field.max].filter((value) => value !== undefined);
      if (dates.some((value) => typeof value !== "string" || !isCalendarDate(value))) issue("У date min и max — даты YYYY-MM-DD");
      else if (field.min !== undefined && field.max !== undefined && field.min > field.max) issue("У date нужно min ≤ max");
    } else if (field.min !== undefined || field.max !== undefined) {
      issue("min и max — только у number и date");
    }
  });

const formInput = z.object({
  title: z.string().min(1).max(300),
  fields: z
    .array(formField)
    .min(1)
    .max(5)
    .refine((fields) => new Set(fields.map((field) => field.name)).size === fields.length, "Имена полей не должны повторяться"),
});

const suggestInput = z.object({ replies: z.array(z.string().min(1).max(60)).min(1).max(4) });

type MultiChoiceInput = z.infer<typeof multiChoiceInput>;
type RatingInput = z.infer<typeof ratingInput>;
type FormInput = z.infer<typeof formInput>;
type FormField = FormInput["fields"][number];

const ANSWERED_BY_MESSAGE_NOTE = 'Если человек ответит сообщением, а не в виджете, результат будет {"ответ":"сообщением"}, а его сообщение придёт следом.';
const ONE_QUESTION_NOTE = "Задавай один вопрос за раз: не больше одного такого вызова в шаге.";

// Описания — постоянные строки: стоят в начале запроса, кэш модели цел (research 3).
const TOOLS: Record<BasicWidgetName, Tool> = {
  ask_choice: tool({
    description: `Спросить человека и дать выбрать один вариант из 2–8 кнопок. Ответ ждёт человека и приходит как {"выбрано":"<вариант>"}. ${ONE_QUESTION_NOTE} ${ANSWERED_BY_MESSAGE_NOTE}`,
    inputSchema: choiceInput,
  }),
  ask_multi_choice: tool({
    description: `Спросить человека и дать выбрать несколько вариантов из 2–8 (min и max — сколько можно выбрать). Ответ приходит как {"выбрано":["<вариант>",…]} в порядке вариантов. ${ONE_QUESTION_NOTE} ${ANSWERED_BY_MESSAGE_NOTE}`,
    inputSchema: multiChoiceInput,
  }),
  ask_rating: tool({
    description: `Попросить оценку: звёзды 1–5 (scale "stars") или шкала от from (0 или 1) до to (2–10) с подписями краёв (scale "range"). Ответ приходит как {"оценка":<целое>}. ${ONE_QUESTION_NOTE} ${ANSWERED_BY_MESSAGE_NOTE}`,
    inputSchema: ratingInput,
  }),
  ask_form: tool({
    description: `Показать короткую форму из 1–5 полей: text, number (min, max), date (YYYY-MM-DD), select (2–8 вариантов). Ответ приходит как {"поля":{"<name>":<значение>}}; пустые необязательные поля не приходят. ${ONE_QUESTION_NOTE} ${ANSWERED_BY_MESSAGE_NOTE}`,
    inputSchema: formInput,
  }),
  suggest_replies: tool({
    description: `Показать под ответом 1–4 коротких подсказки, которые человек может отправить одним нажатием. Ход не ждёт: результат сразу "${SUGGESTIONS_SHOWN}". Нажатая подсказка придёт обычным сообщением.`,
    inputSchema: suggestInput,
    execute: () => SUGGESTIONS_SHOWN,
  }),
};

/** Инструмент базового виджета: у ждущих нет `execute` (шаг кончается вызовом без результата), у подсказок — «показано». */
export function basicWidgetTool(name: BasicWidgetName): Tool {
  return TOOLS[name];
}

/**
 * Ответ человека на вызов базового виджета с входом `input`: тот ли вид, вариант из списка, пределы, поля формы.
 * Годный ответ приводится к виду для модели: выбор нескольких — в порядке вариантов, пустые необязательные поля
 * формы опускаются. На подсказки не отвечают.
 */
export function checkBasicWidgetAnswer(name: BasicWidgetName, input: unknown, answer: unknown): WidgetAnswerCheck {
  switch (name) {
    case "ask_choice":
      return checkChoice(input, answer);
    case "ask_multi_choice":
      return checkMultiChoice(input, answer);
    case "ask_rating":
      return checkRating(input, answer);
    case "ask_form":
      return checkForm(input, answer);
    case "suggest_replies":
      return REJECTED;
  }
}

const REJECTED: WidgetAnswerCheck = { ok: false };

function checkChoice(input: unknown, answer: unknown): WidgetAnswerCheck {
  const call = choiceInput.safeParse(input);
  const value = onlyField(answer, "выбрано");
  if (!call.success || typeof value !== "string" || !call.data.options.includes(value)) return REJECTED;
  return { ok: true, output: { выбрано: value } };
}

function checkMultiChoice(input: unknown, answer: unknown): WidgetAnswerCheck {
  const call = multiChoiceInput.safeParse(input);
  const value = onlyField(answer, "выбрано");
  if (!call.success || !Array.isArray(value)) return REJECTED;
  const chosen = new Set(value);
  const { min, max } = multiChoiceLimits(call.data);
  const known = value.every((option) => typeof option === "string" && call.data.options.includes(option));
  if (!known || chosen.size !== value.length || value.length < min || value.length > max) return REJECTED;
  return { ok: true, output: { выбрано: call.data.options.filter((option) => chosen.has(option)) } };
}

function checkRating(input: unknown, answer: unknown): WidgetAnswerCheck {
  const call = ratingInput.safeParse(input);
  const value = onlyField(answer, "оценка");
  if (!call.success || typeof value !== "number" || !Number.isInteger(value)) return REJECTED;
  const { from, to } = ratingLimits(call.data);
  if (value < from || value > to) return REJECTED;
  return { ok: true, output: { оценка: value } };
}

function checkForm(input: unknown, answer: unknown): WidgetAnswerCheck {
  const call = formInput.safeParse(input);
  const values = onlyField(answer, "поля");
  if (!call.success || !isPlainObject(values)) return REJECTED;
  const fields = call.data.fields;
  if (Object.keys(values).some((key) => !fields.some((field) => field.name === key))) return REJECTED;
  const output: Record<string, string | number> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (isEmptyValue(value)) {
      if (field.required) return REJECTED;
      continue;
    }
    if (!fieldValueFits(field, value)) return REJECTED;
    output[field.name] = value as string | number;
  }
  return { ok: true, output: { поля: output } };
}

function fieldValueFits(field: FormField, value: unknown): boolean {
  switch (field.kind) {
    case "text":
      return typeof value === "string" && value.length <= FORM_TEXT_MAX;
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (typeof field.min !== "number" || value >= field.min) &&
        (typeof field.max !== "number" || value <= field.max)
      );
    case "date":
      return (
        typeof value === "string" &&
        isCalendarDate(value) &&
        (typeof field.min !== "string" || value >= field.min) &&
        (typeof field.max !== "string" || value <= field.max)
      );
    case "select":
      return typeof value === "string" && (field.options ?? []).includes(value);
  }
}

/** Пустое значение поля: нет его, `null` или строка из одних пробелов. */
function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function multiChoiceLimits(input: Pick<MultiChoiceInput, "options" | "min" | "max">): { min: number; max: number } {
  return { min: input.min ?? 1, max: input.max ?? input.options.length };
}

function ratingLimits(input: RatingInput): { from: number; to: number } {
  return input.scale === "stars" ? { from: 1, to: 5 } : { from: input.from ?? 0, to: input.to ?? 10 };
}

/** Значение единственного поля `key` объекта ответа; другой вид ответа — `undefined`. */
function onlyField(answer: unknown, key: string): unknown {
  if (!isPlainObject(answer)) return undefined;
  const keys = Object.keys(answer);
  return keys.length === 1 && keys[0] === key ? answer[key] : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Дата `YYYY-MM-DD`, которая есть в календаре: «2026-02-30» не подходит. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
