import { cutAtCharBoundary } from "@ykurilov/agent-chat-core";
import { isHttpAddress } from "./page-address";
import type { PageContent, SearchHit } from "./services";

/** Результат поиска: нумерованный список, заголовок ссылкой, ниже выдержка. Один текст для модели и для человека. */
export function formatSearchResults(query: string, hits: SearchHit[]): string {
  // Схемы кроме http и https (javascript:, data:, file:) человеку и модели не показываем.
  const safeHits = hits.filter((hit) => isHttpAddress(hit.url));
  if (safeHits.length === 0) return `Ничего не найдено по запросу «${query}».`;
  return safeHits
    .map((hit, index) => {
      const title = hit.title.replace(/\s+/g, " ").trim() || hit.url;
      const link = `${index + 1}. [${title.replace(/[[\]]/g, "\\$&")}](${hit.url.replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
      const snippet = hit.snippet.trim();
      return snippet ? `${link}\n   ${snippet}` : link;
    })
    .join("\n");
}

/** Страница: заголовок, источник и текст; длинный текст режется на границе абзаца с пометкой. */
export function formatPage(page: PageContent, characterLimit: number): string {
  const header = `# ${page.title.trim() || page.url}\nИсточник: ${page.url}\n\n`;
  const text = page.markdown.trim();
  if (!text) return `${header}На странице нет текста.`;
  if (text.length <= characterLimit) return header + text;

  const paragraphBreak = text.lastIndexOf("\n\n", characterLimit);
  const shown = cutAtCharBoundary(text, paragraphBreak > 0 ? paragraphBreak : characterLimit).trimEnd();
  return `${header}${shown}\n\n[Текст обрезан: показано ${shown.length} из ${text.length} знаков]`;
}
