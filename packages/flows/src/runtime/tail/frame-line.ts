import type { FlowTailPart } from "./tail-part";
import { flowDay } from "../../engine/flow-days";
import { frameState, humanMessagesToday } from "../../engine/day-frame";

// Мягкая рамка дня — «пора сворачиваться» строкой хвоста: счёт меняется каждое сообщение, постоянная инструкция от
// него не зависит (кэш). Ход уже посчитал сообщение человека, на которое отвечает.

export const frameLine: FlowTailPart = ({ flow, run, now, timeZone = "UTC", staff }) => {
  const schedule = flow.schedule;
  if (!schedule?.dayFrame || run.endedAt !== undefined || staff) return null;
  const count = humanMessagesToday(run, now, timeZone, schedule);
  if (frameState(count, schedule.dayFrame) !== "soft") return null;
  if (flowDay(run, now, timeZone, schedule).isLastDay) {
    return `Это уже ${count}-е сообщение человека за сегодня, а сегодня последний день программы: на завтра не откладывай — по-доброму подведи итог и попрощайся.`;
  }
  return `Это уже ${count}-е сообщение человека за сегодня: пора по-доброму сворачиваться до завтра. Ответь коротко и тепло, предложи продолжить утром.`;
};
