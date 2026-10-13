import type { PageContent, PageReaderService, PageScreenshotService, SearchHit, WebSearchService } from "@ykurilov/agent-chat-web-tools";

/*
 * Заглушка веб-сервисов для e2e и запуска без ключа: тот же интерфейс, что у Firecrawl, но без сети.
 */

export const demoSearchQuery = "версия Node.js";
export const demoPageUrl = "https://nodejs.org/en/about/previous-releases";

const hits: SearchHit[] = [
  {
    title: "Node.js — Releases",
    url: demoPageUrl,
    snippet: "Текущая версия Node.js и график поддержки выпусков.",
  },
  {
    title: "Node.js 26: что нового",
    url: "https://nodejs.org/en/blog/release/v26.0.0",
    snippet: "Обзор изменений выпуска.",
  },
];

const page: PageContent = {
  url: demoPageUrl,
  title: "Node.js — Releases",
  markdown: "# Releases\n\nТекущий выпуск: Node.js 26.\n\nДолгая поддержка: Node.js 24.",
};

/** Картинка 1×1: снимок в виде data-адреса, чтобы заглушке не нужна была сеть. */
const pixelPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function createDemoWebServices(): {
  search: WebSearchService;
  reader: PageReaderService;
  screenshots: PageScreenshotService;
} {
  return {
    search: { search: async (_query, { limit }) => hits.slice(0, limit) },
    reader: { readPage: async () => page },
    screenshots: { takeScreenshot: async () => ({ imageUrl: pixelPng }) },
  };
}
