import type { ModelMessage } from "ai";

/** Пометка последнего шага хода: инструменты больше не вызываются, нужен итог. Текст постоянный — кэш модели цел. */
export const LAST_STEP_NOTE =
  "Шаги на этот ответ кончились: инструменты больше не вызываются. Подведи итог для человека: что уже сделано, что узнал и что осталось сделать.";

/**
 * Настройки шага для `prepareStep` (FR-048): на последнем шаге хода модели запрещены вызовы (`toolChoice: "none"`),
 * а в самый конец запроса идёт пометка — ответ кончается итогом, а не вызовом, который уже некому выполнить. Набор
 * инструментов тот же и начало запроса то же: кэш модели цел. Остальные шаги — без изменений. `turnStep` — номер шага
 * во всём ходе, с нуля. Ход из одного шага не ограничивается: этот шаг и первый, и последний.
 */
export function lastStepSettings(input: { turnStep: number; maxSteps: number; messages: ModelMessage[] }) {
  if (input.maxSteps <= 1 || input.turnStep !== input.maxSteps - 1) return undefined;
  return {
    toolChoice: "none" as const,
    messages: [...input.messages, { role: "user" as const, content: [{ type: "text" as const, text: LAST_STEP_NOTE }] }],
  };
}

/**
 * Результат-отказ вызова, который модель прислала на шаге без инструментов (последний шаг, итог по потолку) вопреки запрету: инструмент не выполнен,
 * а у вызова есть закрывающий результат (строгие провайдеры не принимают вызов без результата). Текст постоянный — кэш
 * модели цел.
 */
export const LAST_STEP_TOOL_REFUSAL = "Инструмент не выполнен: на этом шаге инструменты больше не вызываются.";

/**
 * Часть-отметка в ответе: ход упёрся в предел шагов (`agent.maxSteps`) — последний шаг был итоговым, без инструментов.
 * `afterTurn` видит `stepLimit: true`. В запрос к модели не идёт.
 */
export const STEP_LIMIT_PART_TYPE = "data-step-limit";

/** Пометка итогового шага, когда ход дошёл до своего потолка денег или вызовов. Текст постоянный — кэш модели цел. */
export const TURN_BUDGET_NOTE =
  "Бюджет на этот ответ кончился: инструменты больше не вызываются. Подведи итог для человека: что уже сделано, что узнал и что осталось сделать.";

/** Итоговый шаг по потолку хода: как последний шаг (`lastStepSettings`), только со своей пометкой. */
export function turnBudgetSettings(messages: ModelMessage[]) {
  return {
    toolChoice: "none" as const,
    messages: [...messages, { role: "user" as const, content: [{ type: "text" as const, text: TURN_BUDGET_NOTE }] }],
  };
}
