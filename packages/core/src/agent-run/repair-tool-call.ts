import { InvalidToolInputError, asSchema } from "ai";
import type { JSONSchema7, ToolCallRepairFunction, ToolSet } from "ai";
import { repairJson } from "./json-repair";
import { dropStrayClosers } from "./stray-closers";

/** Что поправлено в аргументах одного вызова. Без самих аргументов: в них бывают личные данные. */
export interface ToolInputRepair {
  toolName: string;
  /** Длина присланного текста аргументов, в знаках. */
  inputLength: number;
  /** Убранные лишние `}` и `]`: внутри JSON и после его конца. */
  strayClosers: { inside: number; end: number };
  /** Поправлены записи в строках: сырые переводы строк, неверные `\`. */
  strings: boolean;
  /** Строки приведены к числам и булевым значениям по схеме. */
  types: boolean;
}

/**
 * Чинит вызов инструмента с кривыми аргументами (параметр `repairToolCall` у `streamText`):
 * исправляет сырые переводы строк и неверные `\`, убирает лишние закрывающие скобки, приводит `"2"` к числу
 * и `"true"` к булеву значению по схеме инструмента. Починенный вызов SDK заново проверяет схемой и только тогда
 * выполняет; в историю идёт он же. Что не вышло починить, возвращается как раньше — SDK сам скажет модели об ошибке.
 * `onRepaired` — только о починках, которые прошли схему.
 */
export function createRepairToolCall(options: { onRepaired?: (repair: ToolInputRepair) => void } = {}): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, tools, error, inputSchema }) => {
    if (!InvalidToolInputError.isInstance(error)) return null;
    const escaped = repairJson(toolCall.input);
    const parsed = parseWithStrayClosers(escaped);
    if (!parsed) return null;
    const schema = await inputSchema({ toolName: toolCall.toolName });
    const coerced = coerceBySchema(parsed.value, schema);
    const input = JSON.stringify(coerced);
    if (options.onRepaired && (await passesSchema(tools[toolCall.toolName]?.inputSchema, coerced))) {
      options.onRepaired({
        toolName: toolCall.toolName,
        inputLength: toolCall.input.length,
        strayClosers: parsed.strayClosers,
        strings: escaped !== toolCall.input,
        types: input !== JSON.stringify(parsed.value),
      });
    }
    return { ...toolCall, input };
  };
}

/** Строка журнала сервера об одной починке: что поправлено и длина, без содержимого. */
export function describeToolInputRepair(repair: ToolInputRepair, where: { chatId: string; modelId: string; providerId: string }): string {
  const fixes = [
    ...(repair.strayClosers.inside > 0 ? [`лишние скобки внутри ×${repair.strayClosers.inside}`] : []),
    ...(repair.strayClosers.end > 0 ? [`лишние скобки в конце ×${repair.strayClosers.end}`] : []),
    ...(repair.strings ? ["записи в строках"] : []),
    ...(repair.types ? ["типы по схеме"] : []),
  ];
  return (
    `[аргументы починены] чат=${where.chatId} инструмент=${repair.toolName} модель=${where.modelId} провайдер=${where.providerId} ` +
    `правка=${fixes.join(", ")} длина=${repair.inputLength}`
  );
}

/** Разбор JSON; не разобрался — ещё раз без лишних закрывающих скобок. */
function parseWithStrayClosers(json: string): { value: unknown; strayClosers: { inside: number; end: number } } | undefined {
  try {
    return { value: JSON.parse(json), strayClosers: { inside: 0, end: 0 } };
  } catch {
    const repaired = dropStrayClosers(json);
    if (!repaired) return undefined;
    try {
      return { value: JSON.parse(repaired.text), strayClosers: { inside: repaired.inside, end: repaired.end } };
    } catch {
      return undefined;
    }
  }
}

/** Проходит ли значение схему инструмента — той же проверкой, что SDK сделает перед выполнением. */
async function passesSchema(schema: Parameters<typeof asSchema>[0] | undefined, value: unknown): Promise<boolean> {
  if (schema === undefined) return false;
  const validate = asSchema(schema).validate;
  return validate ? (await validate(value)).success : true;
}

/** Приводит строки к числу и булеву значению там, где схема этого ждёт; остальное не трогает. */
function coerceBySchema(value: unknown, schema: JSONSchema7 | boolean | undefined): unknown {
  if (typeof schema !== "object") return value;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];

  if (typeof value === "string") {
    if (types.includes("string")) return value;
    if (types.includes("integer") || types.includes("number")) return numberFrom(value, types.includes("number")) ?? value;
    if (types.includes("boolean")) return value === "true" ? true : value === "false" ? false : value;
    return value;
  }

  if (Array.isArray(value)) {
    const items = Array.isArray(schema.items) ? undefined : schema.items;
    return value.map((item) => coerceBySchema(item, items));
  }

  if (typeof value === "object" && value !== null) {
    const properties = schema.properties ?? {};
    return Object.fromEntries(
      Object.entries(value).map(([key, property]) => [key, coerceBySchema(property, properties[key])]),
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
