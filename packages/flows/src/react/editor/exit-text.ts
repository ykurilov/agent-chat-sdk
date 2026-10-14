import { RETURN_TARGET, type AgentFlow, type FlowCatalog, type FlowCondition, type FlowExit } from "../../format/flow-format";
import { catalogEventLabel } from "../../format/catalog-events";
import { fieldById } from "../../engine/flow-graph";
import type { FlowEditorLabels } from "../../labels/editor";
import type { FlowEdgeKind } from "../flow-editor-skin";

/** Подпись условия для доски, прогона и проверки: «Понятны тема курса и продажи», «Тишина человека 3 ч». С каталогом — подписи событий. */
export function conditionText(flow: AgentFlow, when: FlowCondition, labels: FlowEditorLabels, catalog?: Pick<FlowCatalog, "events">): string {
  switch (when.type) {
    case "judge":
      return when.text.trim() || labels.board.emptyCondition;
    case "data": {
      const name = fieldById(flow, when.field)?.field.name || when.field;
      const op = labels.ops[when.op];
      if (typeof when.value === "boolean") return `${name} ${op} ${when.value ? labels.yes : labels.no}`;
      return when.op === "filled" || when.value === undefined ? `${name} ${op}` : `${name} ${op} ${when.value}`;
    }
    case "event":
      if (when.event === "message" || !when.name) return labels.events[when.event];
      return `${labels.events[when.event]} «${(when.event !== "tool" && catalogEventLabel(catalog, when.name)) || when.name}»`;
    case "timer":
      if (when.from === "time_of_day") return `${labels.timerSpans.time_of_day} ${when.at}`;
      if (when.from === "state_days") return `${labels.statePanel.duration} ${labels.days(when.days)}`;
      if (when.from === "program_day") return labels.programDay(when.day);
      return `${labels.timerSpans[when.from]} ${when.amount} ${labels.units[when.unit]}`;
  }
}

/** Вид стрелки: «назад» рисуется отдельно от вида условия. */
export function edgeKind(exit: FlowExit): FlowEdgeKind {
  return exit.to === RETURN_TARGET ? "return" : exit.when.type;
}

/** Название цели: состояние, «назад, где был» или `null`, если цель не выбрана или пропала. */
export function targetTitle(flow: AgentFlow, to: string | null, labels: FlowEditorLabels): string | null {
  if (to === null) return null;
  if (to === RETURN_TARGET) return labels.returnTarget;
  const state = flow.states.find((candidate) => candidate.id === to);
  return state ? state.title || state.id : null;
}

/** Цель состояния на доске: первая строка инструкции. */
export function stateGoal(instructions: string): string {
  return instructions.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
}
