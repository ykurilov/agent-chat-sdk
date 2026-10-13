import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import type { AgentToolsModel } from "@ykurilov/agent-chat-core";
import type { DemoTasks } from "./demo-tasks";

/** Метка, по которой страница с задачами узнаёт, что список изменился. */
export const TASKS_CHANGED_TAG = "tasks";

/** Ответ инструмента в копии чата у сотрудника: данные человека там только читаются. */
const STAFF_COPY_WRITE_REFUSAL = "В копии чата запись запрещена: данные человека не меняются.";

/**
 * Инструменты задач демо-страницы с панелью: работают с задачами того человека, чей ход идёт. В копии чата у
 * сотрудника (`model.staff`) запись отказывает: так должен поступать каждый инструмент приложения, который пишет.
 */
export function createDemoTaskTools(tasks: DemoTasks): (model: AgentToolsModel) => ToolSet {
  return ({ ownerId, notifyDataChanged, staff }) => ({
    create_task: tool({
      description: "Создаёт задачу в списке задач человека. Список на его экране обновляется сам.",
      inputSchema: z.object({ title: z.string().min(1).describe("Название задачи") }),
      execute: async ({ title }) => {
        if (staff) return { error: STAFF_COPY_WRITE_REFUSAL };
        const task = tasks.create(ownerId, title);
        // Сразу после записи: страница обновит список, не дожидаясь конца вызова и ответа.
        notifyDataChanged({ tag: TASKS_CHANGED_TAG, details: { taskId: task.id } });
        return { id: task.id, title: task.title };
      },
    }),
  });
}
