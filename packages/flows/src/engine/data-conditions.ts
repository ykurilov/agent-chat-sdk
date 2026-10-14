import { FLOW_OPS_BY_FIELD_TYPE, type DataCondition, type FlowField, type FlowFieldType } from "../format/flow-format";
import { sameText } from "./flow-graph";

/** Значение подходит типу поля: непустая строка для текста и выбора, конечное число для числа, `true`/`false` для «да/нет». */
function fitsType(type: FlowFieldType, value: unknown): boolean {
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  return typeof value === "string" && value.trim() !== "";
}

const YES_WORDS = new Set(["да", "yes", "true"]);
const NO_WORDS = new Set(["нет", "no", "false"]);

/**
 * Ответ на вопрос «да/нет»: слово «да»/«нет» (также yes/no/true/false, любой регистр, точка или «!» в конце) или готовое
 * логическое значение. Ничего другого ответом не считается — «может быть» не записывается ни как да, ни как нет.
 */
export function parseBooleanAnswer(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  if (typeof raw !== "string") return undefined;
  const word = raw.trim().toLocaleLowerCase().replace(/[.!\s]+$/u, "");
  if (YES_WORDS.has(word)) return true;
  return NO_WORDS.has(word) ? false : undefined;
}

/** Значение известно и подходит полю: по типу, а у выбора — ещё и по вариантам. Не подходит — считается неизвестным. */
export function fieldValueFits(field: Pick<FlowField, "type" | "options">, value: unknown): boolean {
  if (!fitsType(field.type, value)) return false;
  if (field.type !== "choice" || field.options.length === 0) return true;
  return field.options.some((option) => sameText(option, value as string));
}

/** Выполнено ли условие по данным: `filled` / `eq` / `ne` / `gt` / `lt` / `contains` по типу поля. */
export function dataConditionHolds(condition: DataCondition, fieldType: FlowFieldType, value: unknown): boolean {
  if (!FLOW_OPS_BY_FIELD_TYPE[fieldType].includes(condition.op)) return false;
  if (!fitsType(fieldType, value)) return false;
  const expected = condition.value;
  switch (condition.op) {
    case "filled":
      return true;
    case "eq":
      if (fieldType === "number" || fieldType === "boolean") return value === expected;
      return typeof expected === "string" && sameText(value as string, expected);
    case "ne":
      return typeof expected === "boolean" && value !== expected;
    case "gt":
      return typeof expected === "number" && (value as number) > expected;
    case "lt":
      return typeof expected === "number" && (value as number) < expected;
    case "contains":
      return (
        typeof expected === "string" &&
        expected.trim() !== "" &&
        (value as string).toLocaleLowerCase().includes(expected.trim().toLocaleLowerCase())
      );
  }
}
