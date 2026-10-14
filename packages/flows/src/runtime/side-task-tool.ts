import { tool } from "ai";
import { z } from "zod";
import { FLOW_STATE_KEY } from "../engine/flow-run";
import { noteSideQuestion } from "../engine/run-updates";
import { hasSideTasks, sideTaskById, sideTaskFieldKnown, sideTaskRecord, sideTaskStanding, TIME_ZONE_TASK_ID, type SideTaskContext } from "../engine/side-tasks";
import type { FlowExtraTool } from "./extra-tool";
import { currentRun } from "./flow-events";

// Попутная задача предложена или решена. Попытки пишутся на человека, а у «заново в каждом разговоре» — на разговор.

export const FLOW_SIDE_TASK_TOOL = "flow_side_task";

const NO_FLOW = "В этом чате нет сценария: попутных задач нет, продолжай разговор.";
const STAFF_READ_ONLY = "ход ведёт сотрудник: попытки и решения по человеку он не меняет";

/** «осталась 1 попытка», «осталось 2 попытки»: для строки хвоста и ответов инструмента. */
export const sideTaskAttemptsText = (left: number) => (left === 1 ? "осталась 1 попытка" : `осталось ${left} ${left >= 2 && left <= 4 ? "попытки" : "попыток"}`);

export const sideTaskTool: FlowExtraTool = {
  name: FLOW_SIDE_TASK_TOOL,
  wanted: hasSideTasks,
  make: ({ runtime, model }) =>
    tool({
      description:
        "Попутная задача из списка в конце запроса: ты её предложил (asked) или человек её выполнил (done). Задачу с полем закрывает запись поля через flow_note.",
      inputSchema: z.object({
        id: z.string().describe("id задачи из списка"),
        status: z.enum(["asked", "done"]).describe("asked — предложил человеку; done — человек выполнил"),
        value: z.unknown().optional().describe("Не нужен: значение поля записывай через flow_note"),
      }),
      execute: async ({ id, status }): Promise<string> => {
        const { ownerId, chatId, state, staff } = model;
        const pinned = await runtime.chatFlow(ownerId, chatId);
        if (!pinned) return NO_FLOW;
        const { flow } = pinned;
        const task = sideTaskById(flow, id.trim());
        if (!task) return `Нет такой попутной задачи: «${id}». Задачи: ${[...(flow.schedule ? [TIME_ZONE_TASK_ID] : []), ...(flow.sideTasks ?? []).map((item) => item.id)].join(", ")}.`;
        if (staff) return `Не отмечено: ${STAFF_READ_ONLY}.`;

        const run = currentRun(flow, { [FLOW_STATE_KEY]: state?.get(FLOW_STATE_KEY) }, runtime.now());
        const attempts = await runtime.store.readSideTasks(ownerId, chatId);
        const context: SideTaskContext = { flow, run, chatId, attempts, card: await runtime.cardValues(ownerId) };
        const standing = sideTaskStanding(task, context);
        const owner = task.perConversation ? chatId : null;
        const at = new Date(runtime.now()).toISOString();

        if (status === "asked") {
          if (standing === "done") return `Не отмечено: задача «${task.id}» уже решена. Больше не предлагай её.`;
          if (standing === "spent") return `Не отмечено: у задачи «${task.id}» попытки закончились. Больше не предлагай её.`;
          const asks = (sideTaskRecord(task, chatId, attempts)?.asks ?? 0) + 1;
          await runtime.store.noteSideTask({ ownerId, taskId: task.id, chatId: owner, status: "asked", at });
          // Темп общий с вопросами о человеке: следующее дело между делом — не раньше, чем через `pace` сообщений.
          if (state) state.set(FLOW_STATE_KEY, noteSideQuestion(run));
          return `Отмечено: предложил «${task.id}» (попытка ${asks} из ${task.maxAttempts}).`;
        }

        if (task.field !== undefined && !sideTaskFieldKnown(task, context)) {
          const name = [...flow.clientCard, ...flow.chatNotes].find((field) => field.id === task.field)?.name ?? task.field;
          return `Не отмечено: у задачи «${task.id}» есть поле «${name}», а оно ещё не записано. Запиши его через flow_note — задача решится сама.`;
        }
        if (!sideTaskRecord(task, chatId, attempts)?.doneAt) await runtime.store.noteSideTask({ ownerId, taskId: task.id, chatId: owner, status: "done", at });
        return `Отмечено: задача «${task.id}» решена. Больше не предлагай её.`;
      },
    }),
};
