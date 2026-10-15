import type { AgentFlow } from "../format/flow-format";
import type { FlowRun } from "../engine/flow-run";
import { activeExits, fieldById, isFinal, stateById } from "../engine/flow-graph";

/** Условия словами состояния по порядку проверки (свои, потом общие): номер в карточке = место в этом списке + 1. */
export function judgeExits(flow: AgentFlow, stateId: string): Array<{ exitId: string; text: string }> {
  const state = stateById(flow, stateId);
  if (!state) return [];
  return activeExits(flow, state).flatMap(({ exit }) => (exit.when.type === "judge" ? [{ exitId: exit.id, text: exit.when.text }] : []));
}

/** Цель состояния: первая строка инструкции. */
export function stateGoal(instructions: string): string {
  return instructions.split("\n")[0]!.trim();
}

/**
 * Блок `flow:state`: текущее состояние, цель, условия выхода, что узнать. Зависит только от состояния и набора
 * инструментов модели хода — пока они те же, блок не меняется и в новые вопросы не дописывается (→ В9). Первого текста
 * здесь нет: его несёт переход. `present` — имена в наборе модели хода: инструментов сценария вне набора карточка не
 * называет. Нет — набор неизвестен, называются все.
 */
export function stateCard(flow: AgentFlow, run: FlowRun, present?: ReadonlySet<string>): string {
  const state = stateById(flow, run.state);
  if (!state) return `Состояние «${run.state}» в сценарии не найдено: веди разговор по общим правилам.`;
  const [goal = "", ...rest] = state.instructions.split("\n");
  const lines = [`Состояние: «${state.title}»`, `Цель: ${goal.trim()}`];
  const how = rest.join("\n").trim();
  if (how) lines.push("", how);

  const fields = state.learn.map((id) => fieldById(flow, id)).flatMap((found) => (found ? [`- ${found.field.name}: ${found.field.about}`] : []));
  if (fields.length > 0) lines.push("", "Узнать здесь:", ...fields);

  const conditions = judgeExits(flow, state.id);
  if (isFinal(state)) {
    lines.push("", "Это последнее состояние сценария: условий выхода нет.");
  } else if (conditions.length > 0) {
    lines.push("", "Условия выхода (номер — для flow_exit):", ...conditions.map((condition, index) => `${index + 1}. ${condition.text}`));
  }

  const inSet = (name: string) => !present || present.has(name);
  const tools = state.tools.filter(inSet);
  if (tools.length > 0) lines.push("", `Инструменты этого состояния: ${tools.join(", ")}.`);
  const unavailable = flow.tools.filter((name) => inSet(name) && !state.tools.includes(name));
  if (unavailable.length > 0) lines.push(`Сейчас недоступны: ${unavailable.join(", ")}.`);
  return lines.join("\n");
}
