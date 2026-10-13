/** Что нужно инструментам от сервисов. Реализация заменяется без правки инструментов (Firecrawl, Exa и другие). */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchService {
  search(query: string, options: { limit: number; signal?: AbortSignal }): Promise<SearchHit[]>;
}

export interface PageContent {
  url: string;
  title: string;
  markdown: string;
}

export interface PageReaderService {
  readPage(url: string, options: { signal?: AbortSignal }): Promise<PageContent>;
}

export interface PageScreenshotService {
  takeScreenshot(url: string, options: { signal?: AbortSignal }): Promise<{ imageUrl: string }>;
}
