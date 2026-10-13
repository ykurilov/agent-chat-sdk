import { tool } from "ai";
import { z } from "zod";

/**
 * Браузерные инструменты демо-страницы с панелью: общий модуль сервера (`agent.browserTools`) и страницы
 * (функции с теми же именами у `AgentPanelProvider`). Здесь только описания — действие делает страница.
 */
export const demoBrowserTools = {
  open_task: tool({
    description: "Открывает карточку задачи на экране человека.",
    inputSchema: z.object({ taskId: z.string().describe("Номер задачи") }),
  }),
  freeze_page: tool({
    description: "Проверка срока: функция на странице не отвечает. Вызывать, только если человек прямо просит «зависни».",
    inputSchema: z.object({}),
  }),
};
