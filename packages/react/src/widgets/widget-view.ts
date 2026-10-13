import { getToolName } from "ai";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import type { ReactNode } from "react";
import type { CustomWidgetProps, FormFieldView, WidgetView } from "../skin-contract";
import { checkChoices, checkForm } from "./form-check";
import type { FormCheckMessages, FormValues } from "./form-check";
import { BY_MESSAGE_KEY, CHOSEN_KEY, FIELDS_KEY, ONE_QUESTION_AT_A_TIME, RATING_KEY, isAnsweredByMessage } from "./widget-answer-keys";

/** Базовые ждущие виджеты: их рисует скин без свойств страницы. */
const WAITING_BASIC_WIDGETS = new Set(["ask_choice", "ask_multi_choice", "ask_rating", "ask_form"]);
/** Подсказки: не ждут, рисуются кнопками под ответом (suggested-replies.ts), в ленте их вызова не видно. */
export const SUGGEST_REPLIES = "suggest_replies";

type ToolPart = ToolUIPart | DynamicToolUIPart;

/** Вызов виджета в ленте: что спросили, ждёт ли он и чем ответили. */
export interface WidgetCall {
  toolCallId: string;
  name: string;
  input: unknown;
  /** `closed` — «Стоп», сбой или ответ, который уже не ждёт (FR-007). */
  state: CustomWidgetProps["state"];
  /** Ответ из результата вызова, у отвеченного. */
  answer?: unknown;
}

/**
 * Часть вызова → виджет. `null` — не виджет (обычная строка инструмента), `"hidden"` — виджет не показывается:
 * модель ещё пишет вход, вход негодный или это лишний вопрос шага («Задавай один вопрос за раз»).
 * `awaitingHere` — часть стоит в последнем ответе текущей ветки, и этот ответ ждёт человека: только тогда виджет активен.
 * Вызов без результата и без подтверждения в ждущем ответе — тоже виджет: свой, которого страница не знает (FR-018).
 */
export function widgetCallOf(part: ToolPart, where: { awaitingHere: boolean; customNames: ReadonlySet<string> }): WidgetCall | "hidden" | null {
  const name = getToolName(part);
  if (name === SUGGEST_REPLIES) return null;
  const output = (part as { output?: unknown }).output;
  const known = WAITING_BASIC_WIDGETS.has(name) || where.customNames.has(name);
  const hasApproval = (part as { approval?: unknown }).approval !== undefined;
  const unknownWaiting = !known && !hasApproval && part.state === "input-available" && where.awaitingHere;
  if (!known && !unknownWaiting && !(part.state === "output-available" && isAnsweredByMessage(output))) return null;

  const call = { toolCallId: part.toolCallId, name, input: part.input };
  switch (part.state) {
    case "input-streaming":
      // Ответ ушёл, ход продолжается: вызов помечен «в пути» с ответом (use-widget-answer.ts). Без ответа — вход пишется.
      return output !== undefined ? { ...call, state: "answered", answer: output } : "hidden";
    case "input-available":
      return { ...call, state: where.awaitingHere ? "pending" : "closed" };
    case "output-available":
      return isAnsweredByMessage(output) ? { ...call, state: "answered_by_message" } : { ...call, state: "answered", answer: output };
    case "output-error":
      if (part.errorText?.startsWith(ONE_QUESTION_AT_A_TIME)) return "hidden";
      if (WAITING_BASIC_WIDGETS.has(name) && basicInputOf(name, part.input) === null) return "hidden";
      return { ...call, state: "closed" };
    default:
      return null;
  }
}

/** Что даёт слой поведения виду виджета. */
export interface WidgetControls {
  /** Ответ уходит на сервер. */
  pending: boolean;
  failure?: string;
  /** Есть только у активного виджета. */
  onAnswer?: (answer: unknown) => void;
  /** Ошибки полей формы после неудачной проверки. */
  fieldErrors?: Readonly<Record<string, string>>;
  /** Проверка формы не прошла (или прошла — тогда ошибок нет): ошибки показать у полей. */
  onInvalid?: (errors: Record<string, string>) => void;
  messages: FormCheckMessages;
  /** Компонент своего виджета со страницы. */
  content?: ReactNode;
}

/**
 * Виджет → вид для скина (договор v13). Ответ уходит в форме результата вызова (data-model, «Ответы»):
 * `{ "выбрано": … }`, `{ "оценка": … }`, `{ "поля": … }`. Негодный вход базового виджета — `null`.
 */
export function widgetViewOf(call: WidgetCall, controls: WidgetControls): WidgetView | null {
  const active = call.state === "pending";
  const onAnswer = active ? controls.onAnswer : undefined;
  const common = {
    toolCallId: call.toolCallId,
    active,
    pending: controls.pending,
    ...(controls.failure !== undefined && { failure: controls.failure }),
    answeredByMessage: call.state === "answered_by_message",
  };
  const answer = call.state === "answered" ? asRecord(call.answer) : undefined;

  if (!WAITING_BASIC_WIDGETS.has(call.name)) {
    const question = asRecord(call.input)?.["question"];
    return {
      ...common,
      kind: "custom",
      name: call.name,
      ...(typeof question === "string" && question.length > 0 && { question }),
      ...(controls.content !== undefined && { content: controls.content }),
    };
  }
  const input = basicInputOf(call.name, call.input);
  if (!input) return null;

  switch (input.kind) {
    case "choice": {
      const chosen = answer?.[CHOSEN_KEY];
      return {
        ...common,
        ...input,
        ...(typeof chosen === "string" && { chosen }),
        ...(onAnswer && { onChoose: (option: string) => input.options.includes(option) && onAnswer({ [CHOSEN_KEY]: option }) }),
      };
    }
    case "multi_choice": {
      const chosen = answer?.[CHOSEN_KEY];
      return {
        ...common,
        ...input,
        ...(Array.isArray(chosen) && { chosen: chosen.filter((option): option is string => typeof option === "string") }),
        ...(onAnswer && {
          onSubmit: (options: string[]) => {
            const checked = checkChoices(input.options, options, input.min, input.max);
            if (checked) onAnswer({ [CHOSEN_KEY]: checked });
          },
        }),
      };
    }
    case "rating": {
      const value = answer?.[RATING_KEY];
      return {
        ...common,
        ...input,
        ...(typeof value === "number" && { value }),
        ...(onAnswer && {
          onRate: (rating: number) => Number.isInteger(rating) && rating >= input.from && rating <= input.to && onAnswer({ [RATING_KEY]: rating }),
        }),
      };
    }
    case "form": {
      const values = asRecord(answer?.[FIELDS_KEY]);
      const fields = input.fields.map((field) => {
        const error = controls.fieldErrors?.[field.name];
        return error === undefined ? field : { ...field, error };
      });
      return {
        ...common,
        kind: "form",
        title: input.title,
        fields,
        ...(values && { values: formValuesOf(values) }),
        ...(onAnswer && {
          onSubmit: (submitted: Record<string, string | number>) => {
            const checked = checkForm(input.fields, submitted, controls.messages);
            controls.onInvalid?.(checked.ok ? {} : checked.errors);
            if (checked.ok) onAnswer({ [FIELDS_KEY]: checked.answer });
          },
        }),
      };
    }
  }
}

type BasicInput =
  | { kind: "choice"; question: string; options: string[] }
  | { kind: "multi_choice"; question: string; options: string[]; min: number; max: number }
  | { kind: "rating"; question: string; scale: "stars" | "range"; from: number; to: number; fromLabel?: string; toLabel?: string }
  | { kind: "form"; title: string; fields: FormFieldView[] };

/**
 * Вход базового виджета, прочитанный с опаской: сервер его уже проверил схемой, но история могла прийти от старой
 * версии или от чужой модели. Тексты модели остаются строками — скин показывает их только текстом (FR-009).
 */
function basicInputOf(name: string, raw: unknown): BasicInput | null {
  const input = asRecord(raw);
  if (!input) return null;
  if (name === "ask_form") {
    const title = input["title"];
    const fields = Array.isArray(input["fields"]) ? input["fields"].map(formFieldOf) : [];
    if (typeof title !== "string" || fields.length === 0 || fields.some((field) => field === null)) return null;
    return { kind: "form", title, fields: fields as FormFieldView[] };
  }
  const question = input["question"];
  if (typeof question !== "string" || question.length === 0) return null;
  if (name === "ask_rating") {
    if (input["scale"] === "stars") return { kind: "rating", question, scale: "stars", from: 1, to: 5 };
    const from = input["from"];
    const to = input["to"];
    if (input["scale"] !== "range" || typeof from !== "number" || typeof to !== "number" || !(from < to)) return null;
    return { kind: "rating", question, scale: "range", from, to, ...optionalText(input, "fromLabel"), ...optionalText(input, "toLabel") };
  }
  const options = stringsOf(input["options"]);
  if (!options || options.length < 2) return null;
  if (name === "ask_choice") return { kind: "choice", question, options };
  const min = typeof input["min"] === "number" ? input["min"] : 1;
  const max = typeof input["max"] === "number" ? input["max"] : options.length;
  if (!(min >= 1 && min <= max && max <= options.length)) return null;
  return { kind: "multi_choice", question, options, min, max };
}

function formFieldOf(raw: unknown): FormFieldView | null {
  const field = asRecord(raw);
  const kind = field?.["kind"];
  if (!field || typeof field["name"] !== "string" || typeof field["label"] !== "string") return null;
  if (kind !== "text" && kind !== "number" && kind !== "date" && kind !== "select") return null;
  const options = stringsOf(field["options"]);
  if (kind === "select" && (!options || options.length < 2)) return null;
  const edge = (key: "min" | "max") => {
    const value = field[key];
    return (kind === "number" && typeof value === "number") || (kind === "date" && typeof value === "string") ? { [key]: value } : {};
  };
  return {
    name: field["name"],
    label: field["label"],
    kind,
    required: field["required"] === true,
    ...edge("min"),
    ...edge("max"),
    ...(kind === "select" && { options: options! }),
    ...(kind === "text" && field["multiline"] === true && { multiline: true }),
  };
}

function formValuesOf(values: Record<string, unknown>): FormValues {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number"));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringsOf(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function optionalText(input: Record<string, unknown>, key: "fromLabel" | "toLabel"): { fromLabel?: string; toLabel?: string } {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? { [key]: value } : {};
}

/** Ключ пометки «закрыт сообщением» — для оптимистичной отметки в ленте, когда человек написал вместо ответа. */
export { BY_MESSAGE_KEY };
