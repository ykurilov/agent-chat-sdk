import type { EarlierConversationSearch, Finding } from "./search-earlier-conversation";

const roleNames: Record<Finding["role"], string> = { user: "Человек", assistant: "Агент" };

function whenText(createdAt: string): string {
  return `${createdAt.slice(0, 16).replace("T", " ")} UTC`;
}

/** Ответ инструмента: Markdown-текст для модели. */
export function formatSearch(result: EarlierConversationSearch, query: string): string {
  switch (result.status) {
    case "not-compacted":
      return "История этого чата ещё не сжималась: вся переписка уже перед тобой, искать в ней нечего.";
    case "empty-query":
      return "Запрос пустой: назови слова, которые могли быть в переписке.";
    case "none":
      return `По запросу «${query}» в сжатой части переписки ничего не нашлось. Попробуй другие слова: имя, число, название файла.`;
    case "found": {
      const shown = result.findings.length;
      const heading =
        shown < result.totalFound
          ? `Нашлось в старой переписке: показано ${shown} из ${result.totalFound}. Если нужного нет среди них, уточни запрос.`
          : `Нашлось в старой переписке: ${shown}.`;
      const items = result.findings.map(
        (finding, index) => `${index + 1}. ${roleNames[finding.role]}, ${whenText(finding.createdAt)}\n   > ${finding.snippet}`,
      );
      return [heading, ...items].join("\n\n");
    }
  }
}
