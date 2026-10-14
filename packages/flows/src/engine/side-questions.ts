import type { AgentFlow, ClientCardField } from "../format/flow-format";
import type { FlowRun } from "./flow-run";
import { fieldValueFits } from "./data-conditions";
import { fieldById, isFinal, stateById } from "./flow-graph";

export interface SideQuestionInput {
  /** Карточка клиента: id поля → значение и когда записано (мс). */
  card: Record<string, { value: unknown; updatedAt: number }>;
  now: number;
}

/**
 * О чём спросить человека: `learn` — «узнать здесь», спросить прямо; `stale` — известно давно, мягко уточнить;
 * `unknown` — следующее неизвестное поле карточки, спросить между делом.
 */
export interface SideQuestion {
  fieldId: string;
  reason: "learn" | "stale" | "unknown";
}

/** Пора ли уточнить поле: прошло больше `refreshAfterMonths` месяцев с записи. Без срока поле не устаревает. */
export function isFieldStale(field: Pick<ClientCardField, "refreshAfterMonths">, updatedAt: number, now: number): boolean {
  if (field.refreshAfterMonths === null) return false;
  const due = new Date(updatedAt);
  due.setUTCMonth(due.getUTCMonth() + field.refreshAfterMonths);
  return due.getTime() <= now;
}

/**
 * Что спросить сейчас или `null`. «Узнать здесь» — прямо и вне темпа. Дальше — только если состояние не «без вопросов» и
 * с прошлого вопроса между делом прошло `pace.sideQuestionEveryMessages` сообщений человека: сначала устаревшее, потом
 * первое неизвестное поле карточки по порядку. В конце сценария не спрашиваем.
 */
export function sideQuestion(flow: AgentFlow, run: FlowRun, input: SideQuestionInput): SideQuestion | null {
  const state = stateById(flow, run.state);
  if (!state || isFinal(state)) return null;
  const known = (id: string): boolean => {
    const found = fieldById(flow, id);
    if (!found) return true;
    const value = found.place === "notes" ? run.notes[id] : input.card[id]?.value;
    return fieldValueFits(found.field, value);
  };
  const learn = state.learn.find((id) => !known(id));
  if (learn) return { fieldId: learn, reason: "learn" };
  if (state.noSideQuestions) return null;
  if (run.sideQuestionAt !== null && run.humanMessages - run.sideQuestionAt < flow.pace.sideQuestionEveryMessages) return null;
  const stale = flow.clientCard.find((field) => {
    const entry = input.card[field.id];
    return entry !== undefined && known(field.id) && isFieldStale(field, entry.updatedAt, input.now);
  });
  if (stale) return { fieldId: stale.id, reason: "stale" };
  const unknown = flow.clientCard.find((field) => !known(field.id));
  return unknown ? { fieldId: unknown.id, reason: "unknown" } : null;
}
