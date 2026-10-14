import { readFileSync } from "node:fs";
import { parseFlow, type AgentFlow } from "../src/format";

export type FixtureName = "sales-review" | "shop-support" | "sheets-lesson";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** JSON примера прототипа как он лежит в файле: его удобно портить для проверки графа. */
export function fixtureJson(name: FixtureName): Record<string, any> {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
}

/** Разобранный сценарий; `edit` правит JSON до разбора. */
export function fixtureFlow(name: FixtureName, edit?: (json: Record<string, any>) => void): AgentFlow {
  const json = fixtureJson(name);
  edit?.(json);
  const result = parseFlow(json);
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("\n"));
  return result.flow;
}

export function stateOf(json: Record<string, any>, id: string): Record<string, any> {
  const state = json.states.find((candidate: { id: string }) => candidate.id === id);
  if (!state) throw new Error(`нет состояния ${id}`);
  return state;
}

/** Без своих таймеров тишины («Напоминание», «Утреннее касание», «Прощание по тишине»): касания — из «Дней и времени». */
export function withoutSilenceTimers(json: Record<string, any>): void {
  const dropped = new Set(["remind", "morning", "bye"]);
  json.anyState = { exits: [] };
  json.states = json.states.filter((state: { id: string }) => !dropped.has(state.id));
  for (const state of json.states) state.exits = (state.exits ?? []).filter((exit: { to: string }) => !dropped.has(exit.to));
}
