import type { FlowRulePart } from "./rule-part";

// Когда звать «flow_close_day» и что значит строка «сворачиваться» в хвосте. Счёт сообщений — только в хвосте: так
// постоянная инструкция одинакова весь день и кэш цел.

/** Имя инструмента «закрыть день» (`runtime/close-day-tool.ts`). */
const FLOW_CLOSE_DAY_TOOL = "flow_close_day";

const CLOSE_DAY_RULES = `## Конец дня

- Человек сам закончил на сегодня («всё, до завтра», «на сегодня хватит») — вызови «${FLOW_CLOSE_DAY_TOOL}» и тепло попрощайся до завтра. Сегодня ты больше не напишешь первым.
- В последний день программы «${FLOW_CLOSE_DAY_TOOL}» день не закрывает: попрощайся насовсем — подведи итог и скажи, что дальше.`;

const SOFT_FRAME_RULES = `- В конце запроса может быть строка «пора сворачиваться»: человек сегодня написал уже много. Ответь на сообщение, но коротко и по-доброму предложи продолжить завтра. Не обрывай и не отказывай.`;

export const dayFrameRules: FlowRulePart = (flow) => {
  const schedule = flow.schedule;
  if (!schedule) return null;
  return schedule.dayFrame?.softFrom !== undefined ? `${CLOSE_DAY_RULES}\n${SOFT_FRAME_RULES}` : CLOSE_DAY_RULES;
};
