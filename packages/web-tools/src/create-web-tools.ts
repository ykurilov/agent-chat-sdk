import type { ToolSet } from "ai";
import { createWebUsageRecorder } from "./spending";
import { modelMaySeeToolResultImages } from "@ykurilov/agent-chat-core";
import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { dnsHostResolver } from "./dns-host-resolver";
import type { HostResolver } from "./page-address";
import type { PageReaderService, PageScreenshotService, WebSearchService } from "./services";
import { WebToolError } from "./web-tool-error";
import type { WebToolErrorKind } from "./web-tool-error";
import { sharedPinnedFetch } from "./pinned-fetch";
import { pageScreenshotTool } from "./tools/page-screenshot";
import { readPageTool } from "./tools/read-page";
import { webSearchTool } from "./tools/web-search";

export interface CreateWebToolsOptions {
  search: WebSearchService;
  reader: PageReaderService;
  /** Сколько результатов возвращает поиск. */
  searchResultLimit?: number;
  /** Сколько знаков страницы отдаётся модели. */
  pageCharacterLimit?: number;
  /** Служба снимков. Без неё инструмента `page_screenshot` нет. */
  screenshots?: PageScreenshotService;
  /**
   * Свой `fetch` для скачивания снимка — граница доверия приложения: имя проверяется по DNS до запроса, а закрепить
   * соединение за проверенным адресом (от подмены DNS) должен сам этот `fetch` (`createPinnedFetch` из `/network`).
   * Без него снимок качает общий закреплённый `fetch`: имя проверяется в момент соединения.
   */
  fetch?: typeof globalThis.fetch;
  /** Как разрешать имена при скачивании снимка. По умолчанию системный DNS; заменяется в тестах. */
  resolveHost?: HostResolver;
  /**
   * Траты служб в лимит расходов: удачный вызов и вызов, оборванный после отправки запроса, пишутся расходом `web_tools`.
   * Без него вызовы не учитываются.
   */
  spending?: WebToolsSpending;
}

/** Учёт трат веб-служб: запись идёт в то же хранилище, по которому считает лимит расходов. */
export interface WebToolsSpending {
  storage: Pick<ChatStorage, "insertUsageRecord">;
  /**
   * Доллары за один удачный вызов. У Firecrawl поиск стоит 2 кредита за 10 результатов, страница и снимок — 1 кредит;
   * цена кредита — по вашему тарифу. Инструмент без цены не учитывается.
   */
  pricePerCallUsd: { web_search: number; read_page: number; page_screenshot?: number };
  /** Служба в записи расхода; по умолчанию `firecrawl`. */
  providerId?: string;
  logError?: (message: string) => void;
  now?: () => number;
}

/** Выбранная модель: то, что ядро передаёт функции-набору инструментов. */
export interface WebToolsModel {
  /**
   * Профиль модели. Снимок даётся, если модель видит картинки и провайдер не помечен «точно не видит картинку в
   * результате инструмента» (`blindToolResultImageProviders`); `toolResultImageProviders` — справка о проверенных.
   */
  profile: {
    acceptsImages: boolean;
    acceptsImagesByProvider?: Readonly<Record<string, boolean>>;
    toolResultImageProviders?: readonly string[];
    blindToolResultImageProviders?: readonly string[];
  };
  providerId: string;
  /** Чей ход и в каком чате: на них пишется расход (`spending`). Ядро передаёт их само. */
  ownerId?: string;
  chatId?: string;
}

const defaultSearchResultLimit = 5;
const defaultPageCharacterLimit = 30_000;

/** Набор веб-инструментов для `agent.tools` ядра: `tools: (model) => ({ ...appTools, ...webTools(model) })`. */
export function createWebTools(options: CreateWebToolsOptions): (model: WebToolsModel) => ToolSet {
  const tools: ToolSet = {
    web_search: webSearchTool(options.search, options.searchResultLimit ?? defaultSearchResultLimit),
    read_page: readPageTool(options.reader, options.pageCharacterLimit ?? defaultPageCharacterLimit),
  };
  const pageCharacterLimit = options.pageCharacterLimit ?? defaultPageCharacterLimit;
  const screenshotTool =
    options.screenshots &&
    pageScreenshotTool(options.screenshots, screenshotDownload(options), pageCharacterLimit);
  const withScreenshot: ToolSet = screenshotTool ? { ...tools, page_screenshot: screenshotTool } : tools;
  const counted = options.spending && countingSpending(options.spending);

  return (model) => {
    const chosen = screenshotTool && modelMaySeeToolResultImages(model.profile, model.providerId) ? withScreenshot : tools;
    return counted && model.ownerId && model.chatId ? counted(chosen, model.ownerId, model.chatId) : chosen;
  };
}

/** Отказы, при которых служба работу не делала: адрес или запрос не прошли проверку, ключ, деньги, частота. */
const refusedBeforeWork: ReadonlySet<WebToolErrorKind> = new Set(["bad_address", "bad_query", "invalid_key", "insufficient_funds", "rate_limited"]);

/**
 * Обёртка над `execute`: пишет расход после удачного вызова и после сбоя или «Стопа», когда запрос уже мог уйти —
 * служба могла списать кредиты, лучше записать лишнее, чем потерять. Не пишет отказ до работы службы и вызов хода,
 * остановленного ещё до него. Описания и схемы те же объекты — кэш модели не трогается.
 */
function screenshotDownload(options: CreateWebToolsOptions) {
  const resolveHost = options.resolveHost ?? dnsHostResolver;
  if (options.fetch) return { fetch: options.fetch, resolveHost };
  return { fetch: sharedPinnedFetch(resolveHost), resolveHost, pinned: true };
}

function countingSpending(spending: WebToolsSpending) {
  const prices: Record<string, number | undefined> = spending.pricePerCallUsd;
  for (const [name, price] of Object.entries(prices)) {
    if (price !== undefined && !(Number.isFinite(price) && price >= 0)) throw new Error(`pricePerCallUsd.${name}: нужно число не меньше нуля, а не ${price}`);
  }
  const record = createWebUsageRecorder(spending);

  return (tools: ToolSet, ownerId: string, chatId: string): ToolSet =>
    Object.fromEntries(
      Object.entries(tools).map(([name, item]) => {
        const price = prices[name];
        const execute = item.execute;
        if (price === undefined || !execute) return [name, item];
        return [
          name,
          {
            ...item,
            execute: async (input: never, executeOptions: Parameters<typeof execute>[1]) => {
              const stoppedBefore = executeOptions.abortSignal?.aborted === true;
              let result: Awaited<ReturnType<typeof execute>>;
              try {
                result = await execute(input, executeOptions);
              } catch (error) {
                const refused = error instanceof WebToolError && refusedBeforeWork.has(error.kind);
                if (!stoppedBefore && !refused) await record(name, price, ownerId, chatId);
                throw error;
              }
              await record(name, price, ownerId, chatId);
              return result;
            },
          },
        ];
      }),
    );
}
