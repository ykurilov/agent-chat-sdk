import { RETURN_TARGET, type AgentFlow, type ClientCardField, type FlowExit, type FlowField, type FlowState } from "../format/flow-format";

// Что движок и проверка графа читают из сценария: состояния, их виды и условия, которые сейчас действуют.

export function stateById(flow: AgentFlow, id: string | null): FlowState | undefined {
  return id === null ? undefined : flow.states.find((state) => state.id === id);
}

/** Конечное состояние: условий выхода нет. */
export function isFinal(state: FlowState): boolean {
  return state.exits.length === 0;
}

/** Касание — состояние с переходом «назад» («Напоминание», «Утреннее касание»). Остальные — основные. */
export function isTouch(state: FlowState): boolean {
  return state.exits.some((exit) => exit.to === RETURN_TARGET);
}

/** Общие переходы действуют везде, кроме конечных и исключённых состояний. */
export function commonApplies(flow: AgentFlow, state: FlowState): boolean {
  return !isFinal(state) && !flow.anyState.except.includes(state.id);
}

export interface ActiveExit {
  exit: FlowExit;
  /** Условие самого состояния, а не общее. */
  own: boolean;
}

/** Условия, которые действуют в состоянии, в порядке проверки: свои, потом общие. Общий переход в то же состояние не действует. */
export function activeExits(flow: AgentFlow, state: FlowState): ActiveExit[] {
  const own = state.exits.map((exit) => ({ exit, own: true }));
  if (!commonApplies(flow, state)) return own;
  const common = flow.anyState.exits.filter((exit) => exit.to !== state.id).map((exit) => ({ exit, own: false }));
  return [...own, ...common];
}

export type FieldPlace = { field: ClientCardField; place: "card" } | { field: FlowField; place: "notes" };

/** Поле по `id`: карточка клиента или заметка чата. */
export function fieldById(flow: AgentFlow, id: string): FieldPlace | undefined {
  const card = flow.clientCard.find((field) => field.id === id);
  if (card) return { field: card, place: "card" };
  const note = flow.chatNotes.find((field) => field.id === id);
  return note ? { field: note, place: "notes" } : undefined;
}

/** Строки сравниваются без учёта регистра и пробелов по краям: «Да» и «да» — одно. */
export function sameText(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}
