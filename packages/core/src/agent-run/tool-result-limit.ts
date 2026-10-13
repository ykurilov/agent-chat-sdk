import { cutAtCharBoundary } from "../text/safe-truncate";

const DEFAULT_LIMIT = 50_000;
const MIN_LIMIT = 1000;

/** Настройка `agent.toolResultMaxLength`: число для всех инструментов или предел по умолчанию и по имени. */
export type ToolResultLimitSetting = number | { default?: number; byTool?: Record<string, number> };

export interface ResolvedToolResultLimit {
  /** Предел результата инструмента, знаков. */
  forTool(toolName: string): number;
}

/** Проверяет настройку и отдаёт предел по имени инструмента. Плохое значение — `TypeError`. */
export function resolveToolResultLimit(setting: ToolResultLimitSetting | undefined): ResolvedToolResultLimit {
  const settingObject = typeof setting === "object" ? setting : {};
  const defaultLimit =
    typeof setting === "number"
      ? checked(setting, "agent.toolResultMaxLength")
      : checked(settingObject.default ?? DEFAULT_LIMIT, "agent.toolResultMaxLength.default");
  const byTool = new Map(
    Object.entries(settingObject.byTool ?? {}).map(([name, value]) => [
      name,
      checked(value, `agent.toolResultMaxLength.byTool["${name}"]`),
    ]),
  );
  return { forTool: (toolName) => byTool.get(toolName) ?? defaultLimit };
}

function checked(value: number, where: string): number {
  if (!Number.isInteger(value) || value < MIN_LIMIT) {
    throw new TypeError(`${where} — целое число не меньше ${MIN_LIMIT} (знаков), получено: ${String(value)}`);
  }
  return value;
}

export type CutToolResult = { cut: false } | { cut: true; text: string; length: number };

/**
 * Режет результат инструмента до `maxLength` знаков вместе с пометкой для модели. Строка берётся как есть,
 * остальное — как JSON. Влезло — `{ cut: false }`: результат остаётся тем же значением, а не строкой.
 */
export function cutToolResult(output: unknown, maxLength: number): CutToolResult {
  const text = textOf(output);
  if (text === undefined || text.length <= maxLength) return { cut: false };
  // Пометка входит в предел: считаем её по самому длинному числу «показано», оно не больше `maxLength`.
  const room = Math.max(0, maxLength - cutMark(maxLength, text.length).length);
  const shown = cutAtCharBoundary(text, room);
  return { cut: true, text: shown + cutMark(shown.length, text.length), length: text.length };
}

const cutMark = (shown: number, length: number) => `\n\n[Результат обрезан: показано ${shown} из ${length} знаков]`;

function textOf(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return undefined;
  }
}
