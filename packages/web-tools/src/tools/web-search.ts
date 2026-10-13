import { tool } from "ai";
import type { Tool } from "ai";
import { z } from "zod";
import { formatSearchResults } from "../result-text";
import { callService } from "../service-call";
import type { WebSearchService } from "../services";
import { WebToolError } from "../web-tool-error";

/** Описание и схема неизменны при любых настройках и службах: от них зависит кэш модели. */
export function webSearchTool(search: WebSearchService, resultLimit: number): Tool<{ query: string }, string> {
  return tool({
    // Чужой текст из интернета: чат с ним не запускает живые демонстрации. Модели пометка не уходит — кэш цел.
    metadata: { externalContent: true },
    description:
      "Ищет в интернете свежие сведения и возвращает список страниц: заголовок-ссылка и короткая выдержка. " +
      "Используй, когда нужны факты, которых нет в разговоре или которые могли устареть. " +
      "Чтобы узнать подробности, прочитай подходящую страницу инструментом read_page.",
    inputSchema: z.object({
      query: z.string().describe("Поисковый запрос своими словами, лучше на языке вопроса."),
    }),
    execute: async ({ query }, { abortSignal }) => {
      const trimmed = query.trim();
      if (!trimmed) throw new WebToolError("bad_query", "Пустой поисковый запрос.");
      const hits = await callService(abortSignal, () =>
        search.search(trimmed, { limit: resultLimit, ...(abortSignal && { signal: abortSignal }) }),
      );
      return formatSearchResults(trimmed, hits);
    },
  });
}
