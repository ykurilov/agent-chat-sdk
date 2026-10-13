import { cutAtCharBoundary } from "@ykurilov/agent-chat-core";
import { z } from "zod";
import { isHttpAddress } from "../page-address";
import type { PageContent, PageReaderService, PageScreenshotService, SearchHit, WebSearchService } from "../services";
import { serviceFailure } from "../web-tool-error";
import type { WebToolErrorKind } from "../web-tool-error";

export interface FirecrawlOptions {
  apiKey: string;
  /** Адрес сервиса или прокси перед ним; по умолчанию https://api.firecrawl.dev. */
  baseUrl?: string;
  /** Дополнительные заголовки каждого запроса, например токен прокси. */
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  /** Предел ожидания ответа, мс. По умолчанию 30 000 для поиска и 60 000 для чтения и снимка. */
  timeoutMs?: number;
}

export interface FirecrawlServices {
  search: WebSearchService;
  reader: PageReaderService;
  screenshots: PageScreenshotService;
}

const defaultBaseUrl = "https://api.firecrawl.dev";
const searchTimeoutMs = 30_000;
const scrapeTimeoutMs = 60_000;
const snippetLimit = 300;

const searchResponse = z.object({
  data: z.object({
    web: z
      .array(z.object({ url: z.string().nullish(), title: z.string().nullish(), description: z.string().nullish() }))
      .optional(),
  }),
});

const scrapeResponse = z.object({
  data: z.object({
    markdown: z.string().nullish(),
    screenshot: z.string().nullish(),
    metadata: z.object({ title: z.string().nullish(), sourceURL: z.string().nullish(), url: z.string().nullish() }).nullish(),
  }),
});

export function createFirecrawlServices(options: FirecrawlOptions): FirecrawlServices {
  const baseUrl = (options.baseUrl ?? defaultBaseUrl).replace(/\/+$/, "");
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  async function post<Schema extends z.ZodType>(
    path: string,
    body: unknown,
    schema: Schema,
    { signal, timeoutMs }: { signal: AbortSignal | undefined; timeoutMs: number },
  ): Promise<z.infer<Schema>> {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    // Оборванный запрос не всегда сам отвечает на сигнал: ждём и сигнал, и ответ.
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason ?? new DOMException("Aborted", "AbortError")));
    });
    aborted.catch(() => {});

    let status: number;
    let text: string;
    try {
      const response = await Promise.race([
        fetchImplementation(`${baseUrl}${path}`, {
          method: "POST",
          headers: { ...options.headers, "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
        aborted,
      ]);
      status = response.status;
      text = await Promise.race([response.text(), aborted]);
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      throw serviceFailure(timedOut ? "timeout" : "unavailable");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
    }

    const failure = failureKindOf(status);
    if (failure) throw serviceFailure(failure);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw serviceFailure("bad_response");
    }
    if ((json as { success?: unknown } | null)?.success === false) throw serviceFailure("bad_response");
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw serviceFailure("bad_response");
    return parsed.data;
  }

  return {
    search: {
      async search(query, { limit, signal }) {
        const response = await post("/v2/search", { query, limit }, searchResponse, {
          signal,
          timeoutMs: options.timeoutMs ?? searchTimeoutMs,
        });
        const hits: SearchHit[] = [];
        for (const item of response.data.web ?? []) {
          if (!item.url || !isHttpAddress(item.url)) continue;
          hits.push({ title: (item.title ?? "").trim(), url: item.url, snippet: cleanSnippet(item.description ?? "") });
        }
        return hits;
      },
    },
    reader: {
      async readPage(url, { signal }) {
        const response = await post("/v2/scrape", { url, formats: ["markdown"], onlyMainContent: true }, scrapeResponse, {
          signal,
          timeoutMs: options.timeoutMs ?? scrapeTimeoutMs,
        });
        if (typeof response.data.markdown !== "string") throw serviceFailure("bad_response");
        const metadata = response.data.metadata;
        const page: PageContent = {
          url: [metadata?.url, metadata?.sourceURL].find((candidate) => candidate && isHttpAddress(candidate)) || url,
          title: (metadata?.title ?? "").trim(),
          markdown: response.data.markdown,
        };
        return page;
      },
    },
    screenshots: {
      async takeScreenshot(url, { signal }) {
        const response = await post("/v2/scrape", { url, formats: ["screenshot"] }, scrapeResponse, {
          signal,
          timeoutMs: options.timeoutMs ?? scrapeTimeoutMs,
        });
        if (!response.data.screenshot || !isHttpAddress(response.data.screenshot)) throw serviceFailure("bad_response");
        return { imageUrl: response.data.screenshot };
      },
    },
  };
}

function failureKindOf(status: number): Exclude<WebToolErrorKind, "bad_address" | "bad_query" | "timeout"> | undefined {
  if (status >= 200 && status < 300) return undefined;
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 402) return "insufficient_funds";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "bad_response";
}

/** Выдержка поиска приходит с разметкой: оставляем чистый текст в одну строку не длиннее предела. */
function cleanSnippet(description: string): string {
  const plain = description
    .split("\n")
    .filter((line) => !/^[\s|:-]+$/.test(line))
    .join(" ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*`|>[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > snippetLimit ? `${cutAtCharBoundary(plain, snippetLimit).trimEnd()}…` : plain;
}
