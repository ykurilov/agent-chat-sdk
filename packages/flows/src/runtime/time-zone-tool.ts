import { tool } from "ai";
import { z } from "zod";
import { FLOW_STATE_KEY } from "../engine/flow-run";
import { withDayAnchor } from "../engine/flow-days";
import type { FlowExtraTool } from "./extra-tool";
import { currentRun } from "./flow-events";
import { ianaTimeZone } from "./first-message-rules";

// Пояс человека со слов («я в Новосибирске»): человеку, общий для всех его разговоров. В первый день первый день и
// поздний старт пересчитываются по новому поясу, позже — только сроки (→ В1, FR-207).

export const FLOW_TIME_ZONE_TOOL = "flow_time_zone";

export const timeZoneTool: FlowExtraTool = {
  name: FLOW_TIME_ZONE_TOOL,
  wanted: (flow) => flow.schedule !== undefined,
  make: ({ runtime, model }) =>
    tool({
      description: "Человек назвал свой город или часовой пояс: запиши пояс IANA, например Asia/Novosibirsk.",
      inputSchema: z.object({ timeZone: z.string().describe("Пояс IANA") }),
      execute: async ({ timeZone }): Promise<string> => {
        const zone = ianaTimeZone(timeZone);
        if (!zone) return `Нет такого пояса: «${timeZone}». Нужен пояс IANA вида Europe/Moscow; не знаешь точно — не вызывай.`;
        if (!runtime.timeZones) return "Пояс сейчас не записать: продолжай разговор.";
        await runtime.timeZones.write(model.ownerId, model.chatId, zone);
        const pinned = await runtime.chatFlow(model.ownerId, model.chatId);
        if (pinned?.flow.schedule && model.state) {
          const run = currentRun(pinned.flow, { [FLOW_STATE_KEY]: model.state.get(FLOW_STATE_KEY) }, runtime.now());
          model.state.set(FLOW_STATE_KEY, withDayAnchor(run, zone, pinned.flow.schedule));
        }
        return `Пояс человека записан: ${zone}. Дни и время теперь по его часам.`;
      },
    }),
};
