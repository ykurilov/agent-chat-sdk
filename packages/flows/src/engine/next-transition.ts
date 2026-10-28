import type { AgentFlow, FlowCatalog, FlowCondition, FlowEventType } from "../format/flow-format";
import { catalogEventLabel } from "../format/catalog-events";
import { FLOW_CHAIN_LIMIT, type FlowRun, type Transition, type TransitionDecider, type TransitionReason } from "./flow-run";
import { dataConditionHolds } from "./data-conditions";
import { activeExits, fieldById, stateById } from "./flow-graph";
import { exitTarget } from "./targets";
import { timerDueAt } from "./timers";

/** Что случилось в чате: на это движок ищет переход. */
export type FlowEvent =
  /** Сообщение человека, нажатая кнопка, вызванный инструмент, событие приложения. */
  | { type: "event"; event: FlowEventType; name?: string }
  /**
   * Изменились данные: проверить условия по ним. `field` — какое поле изменилось (нет — все условия по данным).
   * Заметки чата движок берёт из `run.notes`, карточку клиента приносит событие.
   */
  | { type: "data"; field?: string; card?: Record<string, unknown> }
  /** Судья подтвердил условие словами: по заявке агента (`claim`) или сам после ответа (`judge`). `why` — слова агента из заявки. */
  | { type: "verdict"; exitId: string; probability?: number; decidedBy: "claim" | "judge"; why?: string }
  /** Наступил таймер из `nextDue`. Пояс человека нужен, чтобы перепроверить срок: человек мог успеть ответить. */
  | { type: "timer"; exitId: string; timeZone: string };

function matches(flow: AgentFlow, run: FlowRun, exitId: string, when: FlowCondition, event: FlowEvent, now: number): boolean {
  switch (event.type) {
    case "event":
      if (when.type !== "event" || when.event !== event.event) return false;
      return when.event === "message" || when.name === undefined || when.name === event.name;
    case "data": {
      if (when.type !== "data" || (event.field !== undefined && when.field !== event.field)) return false;
      const found = fieldById(flow, when.field);
      if (!found) return false;
      const value = found.place === "notes" ? run.notes[when.field] : event.card?.[when.field];
      return dataConditionHolds(when, found.field.type, value);
    }
    case "verdict":
      return exitId === event.exitId && when.type === "judge";
    case "timer": {
      if (exitId !== event.exitId || when.type !== "timer") return false;
      const due = timerDueAt(when, run, event.timeZone, flow.schedule);
      return due !== null && due <= now;
    }
  }
}

const UNITS = { min: "мин", h: "ч", d: "д" } as const;
const DATA_SIGNS = { eq: "=", ne: "≠", gt: ">", lt: "<", contains: "содержит" } as const;

/** «1 день», «3 дня», «5 дней». */
function daysText(days: number): string {
  const last = days % 10;
  const tens = days % 100;
  const word = last === 1 && tens !== 11 ? "день" : last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? "дня" : "дней";
  return `${days} ${word}`;
}

const valueText = (value: string | number | boolean | undefined) => (value === true ? "да" : value === false ? "нет" : String(value));

/** Условие человеческими словами: для служебного сообщения модели и для причины перехода. С каталогом — подписи событий. */
export function describeCondition(flow: AgentFlow, when: FlowCondition, catalog?: Pick<FlowCatalog, "events">): string {
  switch (when.type) {
    case "judge":
      return when.text;
    case "data": {
      const field = flow.clientCard.find((item) => item.id === when.field) ?? flow.chatNotes.find((item) => item.id === when.field);
      const name = `«${field?.name ?? when.field}»`;
      return when.op === "filled" ? `узнали ${name}` : `${name} ${DATA_SIGNS[when.op]} ${valueText(when.value)}`;
    }
    case "event": {
      if (when.event === "message") return "человек написал";
      if (when.event === "tool") return `вызван инструмент «${when.name ?? ""}»`;
      const name = (when.name && catalogEventLabel(catalog, when.name)) ?? when.name ?? "";
      return when.event === "button" ? `нажата кнопка «${name}»` : `событие «${name}»`;
    }
    case "timer":
      if (when.from === "time_of_day") return `наступило ${when.at}`;
      if (when.from === "state_days") return `нода длится ${daysText(when.days)}`;
      if (when.from === "program_day") return `наступил день ${when.day}`;
      if (when.from === "silence") return `тишина ${when.amount} ${UNITS[when.unit]}`;
      if (when.from === "in_state") return `в состоянии ${when.amount} ${UNITS[when.unit]}`;
      return `с начала разговора ${when.amount} ${UNITS[when.unit]}`;
  }
}

/** Причина перехода: у заявки — слова агента, у остальных — условие, по которому сработал выход. */
function reasonOf(flow: AgentFlow, event: FlowEvent, when: FlowCondition): TransitionReason {
  const claimed = event.type === "verdict" ? event.why?.trim() : undefined;
  return { kind: deciderOf(event), text: claimed || describeCondition(flow, when) };
}

const deciderOf = (event: FlowEvent): TransitionDecider => (event.type === "verdict" ? event.decidedBy : event.type);

/**
 * Следующий переход или `null` — агент остаётся (→ В2). Порядок: свои условия, потом общие (→ В3); «назад» — в последнее
 * основное состояние (→ В1). После `FLOW_CHAIN_LIMIT` переходов подряд без ответа агента и сообщения человека — `null`.
 */
export function nextTransition(flow: AgentFlow, run: FlowRun, event: FlowEvent, now: number): Transition | null {
  if (run.chain >= FLOW_CHAIN_LIMIT) return null;
  const state = stateById(flow, run.state);
  if (!state) return null;
  for (const { exit } of activeExits(flow, state)) {
    if (!matches(flow, run, exit.id, exit.when, event, now)) continue;
    const target = exitTarget(flow, run, exit.to);
    if (!target) continue;
    return {
      from: run.state,
      to: target.state.id,
      exitId: exit.id,
      decidedBy: deciderOf(event),
      ...(event.type === "verdict" && event.probability !== undefined ? { probability: event.probability } : {}),
      tags: target.state.tags,
      at: now,
      ...(target.returned ? { returned: true } : {}),
      reason: reasonOf(flow, event, exit.when),
    };
  }
  return null;
}
