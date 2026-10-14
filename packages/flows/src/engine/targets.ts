import { RETURN_TARGET, type AgentFlow, type FlowState } from "../format/flow-format";
import type { FlowRun } from "./flow-run";
import { isTouch, stateById } from "./flow-graph";

/** Куда ведёт «назад»: последнее в пути основное состояние, касания пропускаются. Такого нет — старт (→ В1). */
export function returnTarget(flow: AgentFlow, run: FlowRun): FlowState | undefined {
  for (let index = run.path.length - 1; index >= 0; index -= 1) {
    const id = run.path[index]!.state;
    if (id === run.state) continue;
    const state = stateById(flow, id);
    if (state && !isTouch(state)) return state;
  }
  return stateById(flow, flow.start);
}

/** Состояние, в которое ведёт условие, или `undefined`: цели нет, она удалена или «назад» ведёт туда же, где чат. */
export function exitTarget(flow: AgentFlow, run: FlowRun, to: string | null): { state: FlowState; returned: boolean } | undefined {
  if (to === null) return undefined;
  if (to !== RETURN_TARGET) {
    const state = stateById(flow, to);
    return state ? { state, returned: false } : undefined;
  }
  const state = returnTarget(flow, run);
  return state && state.id !== run.state ? { state, returned: true } : undefined;
}
