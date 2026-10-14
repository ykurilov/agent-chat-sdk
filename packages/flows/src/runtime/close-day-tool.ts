import { tool } from "ai";
import { z } from "zod";
import { FLOW_STATE_KEY } from "../engine/flow-run";
import { dayInProgress, flowDay } from "../engine/flow-days";
import type { FlowExtraTool } from "./extra-tool";
import { currentRun } from "./flow-events";
import { chatTime } from "./test-clock";

// «На сегодня всё» (FR-404): день закрыт — сегодня агент первым не пишет (запись `dayClosedOn`, её читают правила
// «писать первым»). В последний день день не закрывается: разговор завершается прощанием с итогом.

export const FLOW_CLOSE_DAY_TOOL = "flow_close_day";

const CLOSED = "День закрыт: сегодня ты первым больше не пишешь. Тепло попрощайся до завтра.";
const LAST_DAY = "Сегодня последний день программы — день не закрыт. Попрощайся насовсем: коротко подведи итог разговора и скажи, что дальше.";

export const closeDayTool: FlowExtraTool = {
  name: FLOW_CLOSE_DAY_TOOL,
  wanted: (flow) => flow.schedule !== undefined,
  make: ({ runtime, model }) =>
    tool({
      description: "Человек закончил на сегодня («до завтра»): сегодня больше не пиши первым.",
      inputSchema: z.object({}),
      execute: async (): Promise<string> => {
        const { ownerId, chatId, state, staff } = model;
        const pinned = await runtime.chatFlow(ownerId, chatId);
        const schedule = pinned?.flow.schedule;
        if (!pinned || !schedule) return "В этом чате нет дней программы: продолжай разговор.";
        if (staff) return "Не закрыто: ход ведёт сотрудник, день человека он не закрывает.";
        const run = currentRun(pinned.flow, { [FLOW_STATE_KEY]: state?.get(FLOW_STATE_KEY) }, runtime.now());
        const at = chatTime(run, runtime.now());
        const timeZone = runtime.timeZones ? await runtime.timeZones.of(ownerId, chatId) : "UTC";
        if (flowDay(run, at, timeZone, schedule).isLastDay) return LAST_DAY;
        await runtime.store.setDayClosed(chatId, dayInProgress(at, timeZone, schedule));
        return CLOSED;
      },
    }),
};
