import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { formatSearch } from "./format-search";
import { searchEarlierConversation } from "./search-earlier-conversation";

export interface CreateHistorySearchToolsOptions {
  storage: Pick<ChatStorage, "listMessages" | "listCompactions" | "listBranchSelections">;
  /** Сколько находок возвращается за раз. */
  maxResults?: number;
  /** Длина фрагмента вокруг найденного слова, в знаках. */
  snippetChars?: number;
}

/** Выбранная модель и чат: то, что ядро передаёт функции-набору инструментов. */
export interface HistorySearchModel {
  chatId: string;
}

const defaultMaxResults = 5;
const defaultSnippetChars = 300;

/** Набор для `agent.tools` ядра: `tools: (model) => ({ ...appTools, ...historySearchTools(model) })`. */
export function createHistorySearchTools(options: CreateHistorySearchToolsOptions): (model: HistorySearchModel) => ToolSet {
  const { storage, maxResults = defaultMaxResults, snippetChars = defaultSnippetChars } = options;
  return ({ chatId }) => ({
    search_earlier_conversation: tool({
      description:
        "Ищет слова в старой части переписки, которую заменила сводка. Возвращает найденные сообщения с датой и фрагментом. Нужен, когда точной детали нет в сводке.",
      inputSchema: z.object({
        query: z.string().describe("Слова, которые могли стоять в самом тексте: имя, число, название файла."),
      }),
      execute: async ({ query }) =>
        formatSearch(await searchEarlierConversation({ storage, chatId, query, maxResults, snippetChars }), query),
    }),
  });
}
