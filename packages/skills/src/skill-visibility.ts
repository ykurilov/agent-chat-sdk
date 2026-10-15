import type { AgentAudience, AgentViewer } from "@ykurilov/agent-chat-core";
import type { SkillStatus } from "./types";

/** Решение приложения: админ ли этот человек — для экрана навыков. Запрос есть у вызовов из HTTP-адресов навыков. */
export type IsSkillsAdmin = (user: { id: string }, request?: Request) => boolean | Promise<boolean>;

/** Ход: с кем говорит агент и права человека на ход (`agent.viewer` ядра). */
export interface SkillsTurn {
  audience?: AgentAudience;
  viewer?: AgentViewer;
}

/**
 * Какие статусы видны в этом ходе. Всем — `everyone`. Админские — по `viewer.isAdmin` (права из базы приложения, один
 * раз в начале хода; в копии чата человека — права человека) и не в группе: там их видели бы все участники.
 */
export function visibleStatuses(turn: SkillsTurn): ReadonlySet<SkillStatus> {
  return turn.audience !== "group" && turn.viewer?.isAdmin === true ? new Set(["everyone", "admins"]) : new Set(["everyone"]);
}
