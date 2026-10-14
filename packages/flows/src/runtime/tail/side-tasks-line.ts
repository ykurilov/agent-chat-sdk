import { hasSideTasks, openSideTasks, sideTaskRecord } from "../../engine/side-tasks";
import { FLOW_SIDE_TASK_TOOL, sideTaskAttemptsText } from "../side-task-tool";
import type { FlowTailPart } from "./tail-part";

// Открытые попутные задачи — строкой в хвосте шага, а не в инструкции: список меняется от попыток и ответов человека,
// постоянная часть запроса от него не зависит (кэш).

export const sideTasksLine: FlowTailPart = async ({ ownerId, chatId, flow, run, runtime, staff, askTimeZone }) => {
  if (!hasSideTasks(flow) || !runtime || staff) return null;
  try {
    const attempts = await runtime.store.readSideTasks(ownerId, chatId);
    const open = openSideTasks({ flow, run, chatId, attempts, card: await runtime.cardValues(ownerId), askTimeZone });
    if (open.length === 0) return null;
    const lines = open.map((task) => {
      const left = task.maxAttempts - (sideTaskRecord(task, chatId, attempts)?.asks ?? 0);
      const when = task.when?.trim() ? `; когда уместно: ${task.when.trim()}` : "";
      return `- ${task.id}: ${task.text.trim()} (${sideTaskAttemptsText(left)}${when})`;
    });
    return [
      "Попутные задачи — только к слову, одна за ответ и вместо вопроса о человеке из блока flow:client:",
      ...lines,
      `Предложил — «${FLOW_SIDE_TASK_TOOL}» { id, status: "asked" }; человек сам сделал — { id, status: "done" }.`,
    ].join("\n");
  } catch (error) {
    runtime.logError(`[сценарий] чат=${chatId} попутные задачи не прочитаны: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
};
