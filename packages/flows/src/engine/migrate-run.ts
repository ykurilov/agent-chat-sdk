import type { AgentFlow } from "../format/flow-format";
import type { FlowRun } from "./flow-run";
import { stateById } from "./flow-graph";
import { appendPath } from "./run-updates";

/** Куда перевести чаты из состояний, которых нет в новой версии: id старого → id нового. */
export type StateMap = Record<string, string>;

/**
 * Переводит чат на новую версию сценария (→ В11). Состояние есть в новой версии — часы и путь целы. Удалено — вход в
 * состояние из `map`; без цели — ошибка (её ловит перевод чатов раньше). Заметки чата — по совпадающим `id`.
 * Удалённые состояния в пути и в остановленных часах переименовываются по `map`: так «назад» ведёт туда, куда автор
 * отправил удалённое состояние.
 */
export function migrateRun(run: FlowRun, next: AgentFlow, map: StateMap, now: number): FlowRun {
  const exists = (id: string) => stateById(next, id) !== undefined;
  const renamed = (id: string) => (!exists(id) && map[id] !== undefined && exists(map[id]) ? map[id] : id);
  const noteIds = new Set(next.chatNotes.map((field) => field.id));
  const notes = Object.fromEntries(Object.entries(run.notes).filter(([id]) => noteIds.has(id)));
  const path = run.path.map((entry) => ({ ...entry, state: renamed(entry.state), from: entry.from === null ? null : renamed(entry.from) }));
  const pausedClocks = Object.fromEntries(
    Object.entries(run.pausedClocks)
      .map(([id, ms]) => [renamed(id), ms] as const)
      .filter(([id]) => exists(id)),
  );
  if (exists(run.state)) return { ...run, path, pausedClocks, notes };

  const targetId = map[run.state];
  if (targetId === undefined) {
    throw new Error(`Состояния «${run.state}» нет в новой версии сценария «${next.id}», а куда перевести чат — не выбрано.`);
  }
  const target = stateById(next, targetId);
  if (!target) throw new Error(`Состояния «${targetId}» нет в новой версии сценария «${next.id}»: туда не перевести чат из «${run.state}».`);
  return {
    ...run,
    state: target.id,
    enteredAt: now,
    pausedClocks: {},
    notes,
    path: appendPath(path, { state: target.id, at: now, tags: target.tags, from: run.state, exitId: null, decidedBy: "migrate" }),
    lastRejected: null,
  };
}

/**
 * Чат в состоянии, которого нет в новой версии и для которого цели нет: перевод отобрал его по отставшей записи, а чат
 * уже ушёл туда. Застревать нельзя — цель берётся сама: последнее состояние пути, что есть в новой версии, иначе начало.
 * `lost` — состояние, для которого цель выбрана так.
 */
export function mapWithLostTarget(run: FlowRun, next: AgentFlow, map: StateMap): { map: StateMap; lost?: string } {
  if (stateById(next, run.state) || (map[run.state] !== undefined && stateById(next, map[run.state]!))) return { map };
  const renamed = (id: string) => (!stateById(next, id) && map[id] !== undefined ? map[id]! : id);
  const known = [...run.path].reverse().map((entry) => renamed(entry.state)).find((id) => stateById(next, id));
  const target = known ?? next.start ?? next.states[0]?.id;
  return target === undefined ? { map } : { map: { ...map, [run.state]: target }, lost: run.state };
}
