import { tool } from "ai";
import type { Tool } from "ai";
import { z } from "zod";
import { assertPublicWebAddress } from "../page-address";
import { formatPage } from "../result-text";
import { callService } from "../service-call";
import type { PageReaderService } from "../services";

/** Описание и схема неизменны при любых настройках и службах: от них зависит кэш модели. */
export function readPageTool(reader: PageReaderService, characterLimit: number): Tool<{ url: string }, string> {
  return tool({
    // Чужой текст из интернета: чат с ним не запускает живые демонстрации. Модели пометка не уходит — кэш цел.
    metadata: { externalContent: true },
    description:
      "Читает веб-страницу и возвращает её основной текст в Markdown вместе с адресом-источником. " +
      "Адрес бери из результатов поиска или из сообщения человека.",
    inputSchema: z.object({
      url: z.string().describe("Полный адрес страницы, начинающийся с http:// или https://."),
    }),
    execute: async ({ url }, { abortSignal }) => {
      const address = assertPublicWebAddress(url.trim());
      const page = await callService(abortSignal, () =>
        reader.readPage(address.href, { ...(abortSignal && { signal: abortSignal }) }),
      );
      return formatPage(page, characterLimit);
    },
  });
}
