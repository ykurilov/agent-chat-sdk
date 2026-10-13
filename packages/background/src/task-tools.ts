import type { AgentToolsModel } from "@ykurilov/agent-chat-core";
import { jsonSchema } from "ai";
import type { Tool } from "ai";
import type { TaskRunner } from "./task-runner";
import type { TaskStore } from "./types";

export const CHECK_TASKS = "check_tasks";
export const CANCEL_TASK = "cancel_task";

/** Постоянный блок системной инструкции: один на все ходы, кэш модели не ломает. */
export function backgroundInstructions(maxRunningPerUser: number): string {
  return [
    "Фоновые задачи. Некоторые инструменты работают в фоне: вызов сразу отвечает «started» с taskId, итог придёт позже отдельным служебным сообщением.",
    "Не жди итога и не запускай ту же задачу повторно: скажи пользователю, что задача запущена, и продолжай разговор.",
    `Состояние задач этого чата — ${CHECK_TASKS}. Отменить задачу — ${CANCEL_TASK} с её taskId.`,
    `У пользователя одновременно идёт не больше ${maxRunningPerUser} задач; при ответе «too_many_tasks» предложи дождаться или отменить одну из них.`,
  ].join("\n");
}

/** `check_tasks` и `cancel_task` для хода: только задачи этого чата. */
export function taskToolsForTurn(model: AgentToolsModel, service: { store: TaskStore; runner(): TaskRunner }): Record<string, Tool> {
  const { ownerId, chatId } = model;
  return {
    [CHECK_TASKS]: {
      description: "Фоновые задачи этого чата: название, состояние, ход.",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }),
      async execute() {
        const tasks = await service.store.listForChat(ownerId, chatId);
        return {
          tasks: tasks.map((task) => ({
            taskId: task.id,
            title: task.title,
            status: task.status,
            startedAt: task.startedAt ?? task.createdAt,
            ...(task.finishedAt && { finishedAt: task.finishedAt }),
            ...(task.progress?.text && { progress: task.progress.text }),
            ...(task.error && { error: task.error }),
          })),
        };
      },
    } as Tool,
    [CANCEL_TASK]: {
      description: "Отменить фоновую задачу этого чата по taskId.",
      inputSchema: jsonSchema<{ taskId: string }>({
        type: "object",
        properties: { taskId: { type: "string" } },
        required: ["taskId"],
        additionalProperties: false,
      }),
      async execute({ taskId }: { taskId: string }) {
        return { status: await service.runner().cancel(ownerId, chatId, taskId, "agent"), taskId };
      },
    } as Tool,
  };
}
