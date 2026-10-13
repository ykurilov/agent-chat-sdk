import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { createWebTools } from "@ykurilov/agent-chat-web-tools";
import { createFirecrawlServices } from "@ykurilov/agent-chat-web-tools/firecrawl";
import { createDemoWebServices } from "./demo-web-services";

/**
 * Веб-инструменты демо. Заглушка (`mock`) — сервисы без сети. Настоящий режим — Firecrawl, только если в окружении
 * сервера есть ключ; без ключа веб-инструментов нет. Снимок страницы получают только модели, у которых в профиле
 * отмечено, что через выбранного провайдера они видят картинку из результата инструмента (`toolResultImageProviders`).
 * Траты Firecrawl идут в лимит расходов: поиск (до 10 результатов) — 2 кредита, страница и снимок — по 1.
 */
export function createDemoWebTools(options: { model: "live" | "mock"; env: Record<string, string | undefined>; storage: ChatStorage }) {
  if (options.model === "mock") return createWebTools(createDemoWebServices());
  const apiKey = options.env.FIRECRAWL_API_KEY;
  if (!apiKey) return undefined;
  const proxyToken = options.env.FIRECRAWL_PROXY_TOKEN;
  const firecrawl = createFirecrawlServices({
    apiKey,
    ...(options.env.FIRECRAWL_BASE_URL && { baseUrl: options.env.FIRECRAWL_BASE_URL }),
    ...(proxyToken && { headers: { "X-Proxy-Token": proxyToken } }),
  });
  return createWebTools({
    ...firecrawl,
    spending: {
      storage: options.storage,
      pricePerCallUsd: { web_search: 2 * FIRECRAWL_CREDIT_USD, read_page: FIRECRAWL_CREDIT_USD, page_screenshot: FIRECRAWL_CREDIT_USD },
      logError: (message) => console.error(message),
    },
  });
}

/** Цена кредита Firecrawl на тарифе Hobby: $16 за 3000 кредитов. */
const FIRECRAWL_CREDIT_USD = 16 / 3000;
