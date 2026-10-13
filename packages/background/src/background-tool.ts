import type { AgentToolsModel } from "@ykurilov/agent-chat-core";
import type { Tool } from "ai";
import type { NewTask, RunControl, TaskOutcome, TaskRunner } from "./task-runner";
import type { BackgroundToolDefinition, TaskRecord } from "./types";

/** Фоновый инструмент: агент запускает его, ход идёт дальше, итог придёт служебным сообщением. */
export function backgroundTool<Input, Output>(definition: BackgroundToolDefinition<Input, Output>): BackgroundToolDefinition {
  return definition as unknown as BackgroundToolDefinition;
}

/** Поля хода для записи задачи; без номера ответа и канала (вызов вне хода) — пустой номер и веб. */
export function turnFields(model: AgentToolsModel): Pick<NewTask, "ownerId" | "chatId" | "messageId" | "channel"> {
  return { ownerId: model.ownerId, chatId: model.chatId, messageId: model.messageId ?? "", channel: model.channel ?? "web" };
}

export const TOO_MANY_TASKS = (max: number) =>
  `Слишком много фоновых задач: одновременно идёт не больше ${max}. Дождитесь, пока одна из них закончится, или отмените ненужную (cancel_task).`;

/** Инструмент хода для фонового инструмента: запись задачи и ответ «запущена» сразу, без ожидания итога. */
export function backgroundToolForTurn(
  name: string,
  definition: BackgroundToolDefinition,
  model: AgentToolsModel,
  service: { runner(): TaskRunner; maxRunningPerUser: number },
): Tool {
  return {
    description: definition.description,
    inputSchema: definition.inputSchema,
    ...(definition.needsApproval !== undefined && { needsApproval: definition.needsApproval }),
    ...(definition.metadata !== undefined && { metadata: definition.metadata }),
    async execute(input: unknown, options: { toolCallId: string }) {
      const title = definition.title(input);
      const started = await service
        .runner()
        .start({ ...turnFields(model), toolCallId: options.toolCallId, kind: "tool", name, input, title }, service.maxRunningPerUser);
      if (started.status === "too_many_tasks") return { status: "too_many_tasks", message: TOO_MANY_TASKS(service.maxRunningPerUser) };
      return { status: "started", taskId: started.taskId, title };
    },
  } as Tool;
}

/** Работа фонового инструмента в бегунке: итог — `done`, ошибка — `failed`. */
export async function runBackgroundTool(definition: BackgroundToolDefinition, record: TaskRecord, control: RunControl): Promise<TaskOutcome> {
  const result = await definition.run(record.input, {
    ownerId: record.ownerId,
    chatId: record.chatId,
    signal: control.signal,
    reportProgress: control.reportProgress,
  });
  return { status: "done", result };
}
