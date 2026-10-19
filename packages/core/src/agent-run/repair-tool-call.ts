import { InvalidToolInputError, asSchema } from "ai";
import type { JSONSchema7, ToolCallRepairFunction, ToolSet } from "ai";
import { repairJson } from "./json-repair";
import { parseArgumentsLoosely } from "./tool-arguments-repair";
import { describeUnreadableToolInput } from "./unreadable-tool-input";

/** Что поправлено в аргументах одного вызова. Без самих аргументов: в них бывают личные данные. */
export interface ToolInputRepair {
  toolName: string;
  /** Длина присланного текста аргументов, в знаках. */
  inputLength: number;
  /** Убранные лишние `}` и `]`: внутри JSON (в том числе посреди объекта) и после его конца. */
  strayClosers: { inside: number; end: number };
  /** Дописанные забытые закрывающие `]` и `}`: там, где пропущена скобка после законченного значения. */
  missingClosers: number;
  /** Поле пришло строкой с JSON внутри (`"[{…}]"` вместо `[{…}]`) и разобрано по схеме. */
  nestedJson: boolean;
  /** Текст поправила `repairToolInput` приложения: встроенная починка не справилась. */
  byApp: boolean;
  /** Поправлены записи в строках: сырые переводы строк, неверные `\`. */
  strings: boolean;
  /** Строки приведены к числам и булевым значениям по схеме. */
  types: boolean;
}

/**
 * Своя починка приложения: получает имя инструмента, присланный текст аргументов и ошибку SDK, возвращает починенный
 * JSON-текст или `undefined` («не умею»). Зовётся после встроенной починки и до отказа; результат тоже проверяется
 * схемой инструмента. Упавшая починка считается «не умею». Встроенная — `repairToolArguments(text)`.
 */
export type RepairToolInput = (call: { toolName: string; text: string; error: unknown }) => string | undefined | Promise<string | undefined>;

/**
 * Чинит вызов инструмента с кривыми аргументами (параметр `repairToolCall` у `streamText`):
 * исправляет сырые переводы строк и неверные `\`, убирает лишние (в том числе посреди объекта) и дописывает забытые
 * закрывающие скобки, разбирает поле, пришедшее строкой с JSON, приводит `"2"` к числу и `"true"` к булеву значению по
 * схеме инструмента. Не вышло — зовёт `repairToolInput` приложения. Починка принимается, только если прошла схему
 * инструмента; в историю идёт починенный вызов. Не вышло совсем — SDK скажет модели об ошибке, но короткой, в 1–2 строки,
 * без аргументов целиком. `onRepaired` — только о починках, которые прошли схему.
 */
export function createRepairToolCall(
  options: { onRepaired?: (repair: ToolInputRepair) => void; repairToolInput?: RepairToolInput } = {},
): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, tools, error, inputSchema }) => {
    if (!InvalidToolInputError.isInstance(error)) return null;
    const schema = await inputSchema({ toolName: toolCall.toolName });
    const toolSchema = tools[toolCall.toolName]?.inputSchema;

    const attempt = async (text: string, byApp: boolean): Promise<string | undefined> => {
      const escaped = repairJson(text);
      const parsed = parseArgumentsLoosely(escaped);
      if (!parsed) return undefined;
      const tally: Tally = { inside: parsed.strayClosers.inside, end: parsed.strayClosers.end, missing: parsed.missingClosers, nested: false, types: false };
      const coerced = coerceBySchema(parsed.value, schema, tally);
      if (!(await passesSchema(toolSchema, coerced))) return undefined;
      options.onRepaired?.({
        toolName: toolCall.toolName,
        inputLength: toolCall.input.length,
        strayClosers: { inside: tally.inside, end: tally.end },
        missingClosers: tally.missing,
        nestedJson: tally.nested,
        byApp,
        strings: escaped !== text,
        types: tally.types,
      });
      return JSON.stringify(coerced);
    };

    const builtIn = await attempt(toolCall.input, false);
    if (builtIn !== undefined) return { ...toolCall, input: builtIn };

    const fromApp = await askApp(options.repairToolInput, { toolName: toolCall.toolName, text: toolCall.input, error });
    const repaired = fromApp === undefined ? undefined : await attempt(fromApp, true);
    if (repaired !== undefined) return { ...toolCall, input: repaired };

    // Сообщение уйдёт модели: вместо ошибки SDK с аргументами целиком — 1–2 строки.
    error.message = `Invalid input for tool ${toolCall.toolName}: ${describeUnreadableToolInput(error, toolCall.input)}`;
    return null;
  };
}

/** Своя починка приложения; упала — как «не умею», ход не страдает. */
async function askApp(repair: RepairToolInput | undefined, call: Parameters<RepairToolInput>[0]): Promise<string | undefined> {
  if (!repair) return undefined;
  try {
    const text = await repair(call);
    return typeof text === "string" ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Строка журнала сервера об одной починке: что поправлено и длина, без содержимого. */
export function describeToolInputRepair(repair: ToolInputRepair, where: { chatId: string; modelId: string; providerId: string }): string {
  const fixes = [
    ...(repair.strayClosers.inside > 0 ? [`лишние скобки внутри ×${repair.strayClosers.inside}`] : []),
    ...(repair.strayClosers.end > 0 ? [`лишние скобки в конце ×${repair.strayClosers.end}`] : []),
    ...(repair.missingClosers > 0 ? [`дописаны скобки ×${repair.missingClosers}`] : []),
    ...(repair.nestedJson ? ["JSON из строки"] : []),
    ...(repair.strings ? ["записи в строках"] : []),
    ...(repair.types ? ["типы по схеме"] : []),
    ...(repair.byApp ? ["правка приложения"] : []),
  ];
  return (
    `[аргументы починены] чат=${where.chatId} инструмент=${repair.toolName} модель=${where.modelId} провайдер=${where.providerId} ` +
    `правка=${fixes.join(", ")} длина=${repair.inputLength}`
  );
}

/** Счёт починок при разборе одного вызова. */
interface Tally {
  inside: number;
  end: number;
  missing: number;
  nested: boolean;
  types: boolean;
}

/** Проходит ли значение схему инструмента — той же проверкой, что SDK сделает перед выполнением. */
async function passesSchema(schema: Parameters<typeof asSchema>[0] | undefined, value: unknown): Promise<boolean> {
  if (schema === undefined) return false;
  const validate = asSchema(schema).validate;
  return validate ? (await validate(value)).success : true;
}

/** Приводит строки к числу и булеву значению там, где схема этого ждёт; остальное не трогает. */
function coerceBySchema(value: unknown, schema: JSONSchema7 | boolean | undefined, tally: Tally): unknown {
  if (typeof schema !== "object") return value;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];

  if (typeof value === "string") {
    if (types.includes("string")) return value;
    if (types.includes("integer") || types.includes("number")) return marked(numberFrom(value, types.includes("number")), value, tally);
    if (types.includes("boolean")) return marked(value === "true" ? true : value === "false" ? false : undefined, value, tally);
    if (types.includes("array") || types.includes("object")) return parseNestedJson(value, schema, tally);
    return value;
  }

  if (Array.isArray(value)) {
    const items = Array.isArray(schema.items) ? undefined : schema.items;
    return value.map((item) => coerceBySchema(item, items, tally));
  }

  if (typeof value === "object" && value !== null) {
    const properties = schema.properties ?? {};
    return Object.fromEntries(
      Object.entries(value).map(([key, property]) => [key, coerceBySchema(property, properties[key], tally)]),
    );
  }

  return value;
}

/** Число из строки вида «2» или «2.5»; для целого поля дробное не подходит. */
function numberFrom(text: string, allowFraction: boolean): number | undefined {
  if (text.trim() === "") return undefined;
  const number = Number(text);
  if (!Number.isFinite(number)) return undefined;
  return allowFraction || Number.isInteger(number) ? number : undefined;
}

/** Приведённое значение, а если привести нельзя — как было; приведение отмечается в счёте. */
function marked(coerced: number | boolean | undefined, original: string, tally: Tally): string | number | boolean {
  if (coerced === undefined) return original;
  tally.types = true;
  return coerced;
}

/** Поле-массив или поле-объект пришло строкой с JSON внутри: разбирается тем же правилом, что и весь вызов. */
function parseNestedJson(text: string, schema: JSONSchema7, tally: Tally): unknown {
  if (!/^\s*[[{]/.test(text)) return text;
  const parsed = parseArgumentsLoosely(repairJson(text));
  if (!parsed) return text;
  tally.nested = true;
  tally.inside += parsed.strayClosers.inside;
  tally.end += parsed.strayClosers.end;
  tally.missing += parsed.missingClosers;
  return coerceBySchema(parsed.value, schema, tally);
}
