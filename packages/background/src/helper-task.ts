import type { AgentHelper, AgentToolsModel, BackgroundPort, HelperProgress } from "@ykurilov/agent-chat-core";
import { jsonSchema } from "ai";
import type { Tool } from "ai";
import { TOO_MANY_TASKS, turnFields } from "./background-tool";
import type { RunControl, TaskOutcome, TaskRunner } from "./task-runner";
import type { TaskRecord } from "./types";

export const HELPER_TOOL_PREFIX = "helper_";
/** Название задачи помощника — начало задания. */
const TITLE_MAX_LENGTH = 80;

const helperInput = jsonSchema<{ task: string }>({
  type: "object",
  properties: { task: { type: "string", description: "Задание помощнику: что сделать и что вернуть" } },
  required: ["task"],
  additionalProperties: false,
});

/** Фоновые помощники из настроек службы: ядро отдаёт их в порте. */
export function backgroundHelpers(port: BackgroundPort | undefined): Record<string, AgentHelper> {
  const helpers = port?.helpers ?? {};
  return Object.fromEntries(Object.entries(helpers).filter(([, helper]) => helper.background === true));
}

/** Что модель основного агента видит из ответа `helper_<имя>`: как у помощников ядра. */
function helperModelOutput(output: unknown): { type: "text"; value: string } {
  const progress = output as Partial<HelperProgress>;
  if (progress?.status === "background") {
    return { type: "text", value: `Помощник работает в фоне${progress.taskId ? ` (задача ${progress.taskId})` : ""}: итог придёт позже.` };
  }
  return { type: "text", value: `Помощник не справился: ${progress?.error ?? "неизвестная ошибка"}` };
}

/** `helper_<имя>` фонового помощника: создаёт задачу и сразу отвечает «работает в фоне». */
export function helperToolForTurn(
  name: string,
  helper: AgentHelper,
  model: AgentToolsModel,
  service: { runner(): TaskRunner; maxRunningPerUser: number },
): Tool {
  return {
    description: helper.description,
    inputSchema: helperInput,
    toModelOutput: ({ output }: { output: unknown }) => helperModelOutput(output),
    async execute({ task }: { task: string }, options: { toolCallId: string }): Promise<HelperProgress> {
      const started = await service
        .runner()
        .start(
          { ...turnFields(model), toolCallId: options.toolCallId, kind: "helper", name, input: { task }, title: titleOf(task) },
          service.maxRunningPerUser,
        );
      if (started.status === "too_many_tasks") {
        const message = TOO_MANY_TASKS(service.maxRunningPerUser);
        return { task, steps: [], text: message, status: "failed", error: message };
      }
      return { task, steps: [], text: "", status: "background", taskId: started.taskId };
    },
  } as unknown as Tool;
}

/**
 * Работа фонового помощника в бегунке: цикл ядра (`port.runHelper`) с сохранёнными шагами. После каждого шага шаги и ход
 * пишутся в задачу: после перезапуска цикл продолжит с них, траты за старые шаги не повторятся.
 */
export async function runHelperTask(port: BackgroundPort, helper: AgentHelper, record: TaskRecord, control: RunControl): Promise<TaskOutcome> {
  const { task } = record.input as { task: string };
  let lastProgress: HelperProgress | undefined = record.progress;
  const model = await port.helperModel(record.name, record.ownerId, record.chatId);
  const result = await port.runHelper({
    name: record.name,
    helper,
    task,
    model,
    ...(record.helperMessages && { priorMessages: record.helperMessages }),
    abortSignal: control.signal,
    async onStep(step) {
      lastProgress = step.progress;
      await control.saveStep({ helperMessages: step.messages, progress: step.progress });
    },
  });
  const progress: HelperProgress = { ...(lastProgress ?? { task, steps: [] }), text: result.text, status: result.status };
  switch (result.status) {
    case "done":
      return { status: "done", result: result.text, helperMessages: result.messages, progress };
    case "failed":
      return { status: "failed", error: result.text, helperMessages: result.messages, progress: { ...progress, error: result.text } };
    case "awaiting_approval":
      // Пауза: шаги и вопрос человеку сохранены, служебное сообщение покажет подтверждение.
      return { status: "awaiting_approval", helperMessages: result.messages, progress: lastProgress ?? progress };
  }
}

function titleOf(task: string): string {
  const line = task.trim().replace(/\s+/g, " ");
  return line.length <= TITLE_MAX_LENGTH ? line : `${line.slice(0, TITLE_MAX_LENGTH - 1)}…`;
}
