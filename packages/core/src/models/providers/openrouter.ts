import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { JSONValue, LanguageModelV4Middleware } from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import { isCacheTtl } from "../model-catalog";
import type { CacheTtl, GenerationUsage, ModelProfile, ProviderConnection, ProviderDescription } from "../model-catalog";
import { fetchWithCacheMarkLimit, openrouterCacheMarkLimit } from "./openrouter-cache-mark-limit";
import { openrouterGeminiCacheMarkMiddleware } from "./openrouter-gemini-cache-mark";
import { effortWithAnswerReserve, plainEffort, reasoningBudgetTokens } from "../reasoning-budget";
import { openrouterReasoningDetailsMiddleware } from "./openrouter-reasoning-details";
import { checkedConnection, connectable, connectionField, hiddenField, silenceField } from "./provider-connection";
import { sessionHeaderValue } from "./session-header";

const OPENROUTER_API = "https://openrouter.ai/api/v1";
const OPENROUTER_ID = "openrouter";

export interface OpenRouterProviderOptions extends ProviderConnection {
  /**
   * Id провайдера в каталоге, по умолчанию `openrouter`. Другой id — отдельный маршрут OpenRouter к тем же моделям:
   * свои `only`/`order`/`ignore`, место в списке запасных `providerFallback.byModel`. Модели, цены и отметки маршрут
   * берёт у провайдера `openrouter` каталога.
   */
  id?: string;
  /** Имя для людей, по умолчанию `OpenRouter`. */
  displayName?: string;
  /** Только эти хозяева модели (`provider.only`), например `["together"]`. */
  only?: string[];
  /** Хозяева по порядку (`provider.order`): первым — первый из списка, если доступен. */
  order?: string[];
  /** `false` — OpenRouter не уходит к другим хозяевам сам, когда выбранные недоступны (`provider.allow_fallbacks`). */
  allowFallbacks?: boolean;
  /** `true` — только хозяева, которые умеют все параметры запроса, например инструменты (`provider.require_parameters`). */
  requireParameters?: boolean;
  /**
   * `deny` — запрос уходит только тем хозяевам модели, которые не хранят и не продают запросы
   * (`provider.data_collection`). Моделей, доступных так, меньше. По умолчанию — как в настройках аккаунта OpenRouter.
   */
  dataCollection?: "allow" | "deny";
  /** `true` — только хозяева, которые не хранят запросы вовсе, даже ненадолго (`provider.zdr`). */
  zeroDataRetention?: boolean;
  /**
   * Потолок цены: хозяева модели дороже не получат запрос (`provider.max_price`). Цены — в долларах за миллион
   * токенов, `requestUsd` и `imageUsd` — за запрос и за картинку. Нет хозяина дешевле потолка — запрос не пройдёт.
   */
  maxPrice?: OpenRouterMaxPrice;
  /**
   * Хозяева модели, которым запрос не уходит (`provider.ignore`), например `["venice", "wafer"]`. Сливается с запретом
   * из профиля модели (там отмечены хозяева, которые не видят картинку в результате инструмента).
   */
  ignore?: string[];
  /**
   * Как выбирать хозяина модели (`provider.sort`): `throughput` (по умолчанию) — по скорости, `false` — как решит OpenRouter.
   * Задан `order` — по умолчанию сортировки нет: свой порядок главнее. Явная сортировка вместе с `order` идёт как есть;
   * что из них главнее, OpenRouter не обещает.
   */
  sort?: "throughput" | "price" | "latency" | false;
  /**
   * `true` (по умолчанию) — номер чата идёт заголовком `x-session-id`: запросы чата идут к одному хозяину модели,
   * и кэш модели не теряется. `false` — без заголовка: каждый запрос выбирает хозяина заново.
   */
  stickyProvider?: boolean;
  /**
   * Срок жизни кэша, который держат метки `cache_control`, у всех моделей провайдера: `"5m"` (метка без срока, запрос как
   * был) или `"1h"` (метка `ttl: "1h"`). Не задан — срок из профиля модели (`ModelProfile.cacheTtl`, у Claude Haiku 5.5 —
   * час), нет и там — 5 минут. Задан — главнее профиля. Срок один на все метки запроса: инструкция, последнее сообщение,
   * конец шага; Anthropic не принимает часовую метку после пятиминутной.
   * Часовой кэш дороже на запись (у Anthropic 2× цены входа вместо 1.25×), чтение стоит столько же; выгоден, когда между
   * ходами чата больше 5 минут. Цена записи — по сроку: `cacheWrite1hPerMillion` профиля, нет её — `cacheWritePerMillion`.
   */
  cacheTtl?: CacheTtl;
  /**
   * Срок кэша отдельных моделей: `{ "claude-haiku-5.5": "5m", "gpt-6-luna": "1h" }` (id моделей каталога). Главнее и
   * `cacheTtl`, и профиля.
   */
  cacheTtlByModel?: Record<string, CacheTtl>;
}

export interface OpenRouterMaxPrice {
  promptPerMillion?: number;
  completionPerMillion?: number;
  requestUsd?: number;
  imageUsd?: number;
}

/**
 * OpenRouter со своими правилами хранения данных или через прокси (`baseURL`, `headers`). Подключение — заменой
 * провайдера в каталоге: `extendCatalog(standardCatalog, { addProviders: [createOpenRouterProvider({ dataCollection: "deny" })] })`.
 * Правило одинаково в каждом запросе и кэшу не мешает.
 */
export function createOpenRouterProvider(options: OpenRouterProviderOptions = {}): ProviderDescription {
  const { id = OPENROUTER_ID, displayName = "OpenRouter", dataCollection, zeroDataRetention, maxPrice, ignore, only, order, allowFallbacks, requireParameters } = options;
  const { stickyProvider = true, cacheTtl, cacheTtlByModel } = options;
  const sort = options.sort ?? (order?.length ? false : "throughput");
  if (typeof id !== "string" || !id.trim()) throw new Error(`OpenRouter: id провайдера должен быть непустой строкой: ${JSON.stringify(id)}`);
  if (cacheTtl !== undefined && !isCacheTtl(cacheTtl)) throw new Error(`OpenRouter: cacheTtl — "5m" или "1h": ${JSON.stringify(cacheTtl)}`);
  assertCacheTtlByModel(cacheTtlByModel);
  for (const [name, hosts] of Object.entries({ ignore, only, order })) assertHostList(name, hosts);
  const onlyAndIgnored = only?.filter((host) => ignore?.includes(host)) ?? [];
  if (onlyAndIgnored.length > 0) throw new Error(`OpenRouter: хозяева и в only, и в ignore — уберите из одного списка: ${onlyAndIgnored.join(", ")}`);
  const connection = checkedConnection("OpenRouter", options);
  const routing = {
    ...(sort && { sort }),
    ...(dataCollection && { data_collection: dataCollection }),
    ...(zeroDataRetention && { zdr: true }),
    ...(maxPrice && { max_price: maxPriceField(maxPrice) }),
    ...(only?.length && { only }),
    ...(order?.length && { order }),
    ...(allowFallbacks !== undefined && { allow_fallbacks: allowFallbacks }),
    ...(requireParameters && { require_parameters: true }),
    ...(ignore?.length && { ignore }),
  };
  const cacheTtlFor = (profile: ModelProfile): CacheTtl =>
    (cacheTtlByModel && Object.hasOwn(cacheTtlByModel, profile.id) ? cacheTtlByModel[profile.id] : undefined) ?? cacheTtl ?? profile.cacheTtl ?? "5m";
  const cacheMarkFor = (profile: ModelProfile | undefined) => {
    const hour = (profile ? cacheTtlFor(profile) : (cacheTtl ?? "5m")) === "1h";
    return { openrouter: { cacheControl: { type: "ephemeral", ...(hour && { ttl: "1h" }) } } };
  };
  const routingOptions = Object.keys(routing).length > 0 ? { provider: routing } : {};
  const routingSettings: OpenRouterProviderOptions = {
    id,
    displayName,
    ...(dataCollection && { dataCollection }),
    ...(zeroDataRetention && { zeroDataRetention }),
    ...(maxPrice && { maxPrice }),
    ...(ignore && { ignore }),
    ...(only && { only }),
    ...(order && { order }),
    ...(allowFallbacks !== undefined && { allowFallbacks }),
    ...(requireParameters && { requireParameters }),
    ...(options.sort !== undefined && { sort: options.sort }),
    stickyProvider,
    ...(cacheTtl && { cacheTtl }),
    ...(cacheTtlByModel && { cacheTtlByModel }),
  };
  return connectable({
    ...openrouterBase,
    id,
    displayName,
    ...(id !== OPENROUTER_ID && { servesModelsOf: OPENROUTER_ID }),
    ...connectionField(connection),
    ...silenceField("OpenRouter", options),
    ...hiddenField("OpenRouter", options),
    cacheTtlFor,
    requestOptions: ({ chatId, profile }) => ({
      instructionsProviderOptions: cacheMarkFor(profile),
      lastMessageProviderOptions: cacheMarkFor(profile),
      ...(stickyProvider && { headers: { "x-session-id": sessionHeaderValue(chatId) } }),
    }),
    createLanguageModel: (providerModelId, apiKey, requestOptions) => {
      // Claude принимает не больше 4 меток кэша: лишние снимаются в самом теле запроса. У других моделей fetch прежний.
      const markLimit = openrouterCacheMarkLimit(providerModelId);
      const fetch = markLimit === undefined ? requestOptions?.fetch : fetchWithCacheMarkLimit(requestOptions?.fetch, markLimit);
      return wrapLanguageModel({
        model: createOpenRouter({ apiKey, fetch, ...connection }).chat(providerModelId, routingOptions),
        middleware: [
          openrouterRoutingMiddleware(routing),
          openrouterReasoningDetailsMiddleware,
          ...[openrouterGeminiCacheMarkMiddleware(providerModelId)].filter((middleware) => middleware !== undefined),
        ],
      });
    },
    generationUsage: connection.baseURL || connection.headers ? openrouterGenerationUsage(connection) : directGenerationUsage,
  }, (next) => createOpenRouterProvider({ ...routingSettings, ...next }));
}

/**
 * Маршрут из опций запроса (`providerOptions.openrouter.provider`, например запрет хозяев из профиля модели) провайдер
 * OpenRouter ставит вместо маршрута подключения целиком. Обёртка сливает их: поля подключения остаются, списки `ignore`
 * объединяются. Без маршрута в опциях запрос не меняется.
 */
function openrouterRoutingMiddleware(routing: Record<string, JSONValue>): LanguageModelV4Middleware {
  return {
    specificationVersion: "v4",
    async transformParams({ params }) {
      const openrouter = params.providerOptions?.openrouter;
      const requested = openrouter?.provider;
      if (!isJsonObject(requested)) return params;
      const ignore = [...new Set([...hostList(routing.ignore), ...hostList(requested.ignore)])];
      const provider = { ...routing, ...requested, ...(ignore.length > 0 && { ignore }) };
      const only = hostList(requested.only ?? routing.only);
      if (only.length > 0 && only.every((host) => ignore.includes(host))) {
        throw new Error(`OpenRouter: все хозяева из only (${only.join(", ")}) запрещены в ignore (с запретом из профиля модели) — запросу некуда уйти`);
      }
      return { ...params, providerOptions: { ...params.providerOptions, openrouter: { ...openrouter, provider } } };
    },
  };
}

/** Сроки кэша по моделям — объект «id модели → "5m" | "1h"»; иначе ошибка сразу, при создании провайдера. */
function assertCacheTtlByModel(byModel: unknown): void {
  if (byModel === undefined) return;
  const valid = typeof byModel === "object" && byModel !== null && !Array.isArray(byModel) && Object.values(byModel).every(isCacheTtl);
  if (!valid) throw new Error(`OpenRouter: cacheTtlByModel — объект «id модели → "5m" или "1h"»: ${JSON.stringify(byModel)}`);
}

/** Список хозяев модели — массив строк; иначе ошибка сразу, при создании провайдера. */
function assertHostList(name: string, hosts: unknown): void {
  if (hosts === undefined) return;
  if (!Array.isArray(hosts) || hosts.some((host) => typeof host !== "string" || !host.trim())) {
    throw new Error(`OpenRouter: ${name} — список имён хозяев модели (строк): ${JSON.stringify(hosts)}`);
  }
}

function isJsonObject(value: JSONValue | undefined): value is { readonly [key: string]: JSONValue | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hostList(value: JSONValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((host): host is string => typeof host === "string") : [];
}

/** Потолок цены в поля OpenRouter; отрицательное или нечисловое — ошибка сразу, при создании провайдера. */
function maxPriceField(maxPrice: OpenRouterMaxPrice): Record<string, number> {
  const fields = { prompt: maxPrice.promptPerMillion, completion: maxPrice.completionPerMillion, request: maxPrice.requestUsd, image: maxPrice.imageUsd };
  const result: Record<string, number> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0) throw new Error(`OpenRouter: maxPrice — цена «${name}» должна быть числом от нуля: ${value}`);
    result[name] = value;
  }
  return result;
}

const openrouterBase: Omit<ProviderDescription, "id" | "displayName" | "createLanguageModel" | "generationUsage" | "requestOptions"> = {
  apiKeyEnv: "OPENROUTER_API_KEY",
  reasoningRequest: (level, { profile, maxOutputTokens }) => {
    const summary = profile.reasoning.encrypted ? { summary: "concise" } : {};
    if (level === "off") return { providerOptions: { openrouter: { reasoning: { enabled: false } } } };
    if (level === "on") return { providerOptions: { openrouter: { reasoning: { enabled: true, ...summary } } } };
    // Модель держит жёсткий бюджет: число вместо effort. У effort OpenRouter сам считает бюджет как долю max_tokens
    // (xhigh — 95 %), и ответу почти ничего не остаётся; наш бюджет оставляет ответу запас. `effort` и `max_tokens`
    // вместе OpenRouter не принимает.
    const budget = profile.reasoning.tokenBudget && maxOutputTokens !== undefined ? reasoningBudgetTokens(level, maxOutputTokens) : undefined;
    if (budget !== undefined) return { providerOptions: { openrouter: { reasoning: { max_tokens: budget, ...summary } } } };
    // Сила — доля потолка вывода (Claude у OpenRouter: `xhigh` — 95 %): уровень пониже, чтобы ответу остался запас.
    const effort =
      profile.reasoning.effortShareOfOutput && maxOutputTokens !== undefined ? effortWithAnswerReserve(level, maxOutputTokens) : plainEffort(level);
    return { providerOptions: { openrouter: { reasoning: { effort, ...summary } } } };
  },
  // Деньги кончились: OpenRouter отвечает 402 и пишет «insufficient credits» в теле.
  errorHints: [{ match: /insufficient credits|insufficient funds/i, kind: "insufficient_funds" }],
};

interface GenerationStats {
  native_tokens_prompt?: number | null;
  native_tokens_cached?: number | null;
  native_tokens_completion?: number | null;
  native_tokens_reasoning?: number | null;
}

/**
 * Расход генерации OpenRouter: номер — в заголовке `x-generation-id` ответа, расход — `GET /api/v1/generation?id=…`.
 * Данные появляются через 10–20 с после конца генерации, до того — 404. Числа — родные токены модели
 * (`native_tokens_*`), как в usage потока; выход включает рассуждения (замер 2026-10-02). Через прокси — как и ход.
 */
function openrouterGenerationUsage(connection: ProviderConnection): GenerationUsage {
  const api = connection.baseURL ?? OPENROUTER_API;
  return {
    generationId: (headers) => headers?.["x-generation-id"] || undefined,
    async lookup({ generationId, apiKey, fetch = globalThis.fetch, signal }) {
      const response = await fetch(`${api}/generation?id=${encodeURIComponent(generationId)}`, {
        headers: { ...connection.headers, authorization: `Bearer ${apiKey}` },
        ...(signal && { signal }),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`OpenRouter: расход генерации — ответ ${response.status}`);
      const { data } = (await response.json()) as { data?: GenerationStats };
      // Запись без чисел — OpenRouter ещё не досчитал генерацию: спросят позже.
      if (!data || (data.native_tokens_prompt == null && data.native_tokens_completion == null)) return null;
      return {
        inputTokens: data.native_tokens_prompt ?? 0,
        cachedInputTokens: data.native_tokens_cached ?? 0,
        outputTokens: data.native_tokens_completion ?? 0,
        reasoningTokens: data.native_tokens_reasoning ?? 0,
      };
    },
  };
}

const directGenerationUsage = openrouterGenerationUsage({});

/**
 * OpenRouter (`openrouter.ai`): один ключ, много моделей разных создателей.
 * - Хозяев модели сортирует по скорости (`provider.sort = "throughput"`): настройка одна и та же в каждом
 *   запросе, кэшу не мешает.
 * - Общий параметр SDK `reasoning` OpenRouter игнорирует: силу рассуждений принимает только
 *   `providerOptions.openrouter.reasoning`. У моделей с зашифрованными рассуждениями просим пересказ.
 * - Кэш: у одних моделей (GPT) начало запроса кэшируется само, у других (Gemini) — только по метке
 *   `cache_control`. Метка стоит на инструкции и на последнем сообщении истории (скользящая точка: на
 *   следующем ходе переезжает на новое сообщение), так кэшируется и переписка. Ставим всегда: где она не
 *   нужна, OpenRouter её не трогает. У Claude меток в запросе не больше 4 (правило Anthropic): лишние снимаются в теле
 *   запроса перед отправкой (`openrouter-cache-mark-limit`).
 *   Прочитанное приходит в usage. Метка живёт 5 минут; час — у моделей с `cacheTtl: "1h"` в профиле (Claude Haiku 5.5)
 *   или по настройке `createOpenRouterProvider({ cacheTtl, cacheTtlByModel })` (запись дороже: у Anthropic 2× цены
 *   входа вместо 1.25×, чтение то же; выгодно, когда между ходами больше 5 минут; цена записи — по сроку).
 * - Заголовок `x-session-id` с номером чата: запросы одного чата идут на один сервер OpenRouter, и кэш не теряется
 *   при переходе между серверами (так делает и Pi). Сервер, которому заголовок не нужен, его пропускает.
 *   Приватность: номер чата уходит в OpenRouter как идентификатор сессии (обычный номер как есть, необычный — свёрткой).
 * - Шифр рассуждений GPT и подпись Gemini провайдер SDK кладёт только в итог шага; обёртка модели возвращает их
 *   на текст ответа и на сообщение запроса (см. `openrouter-reasoning-details`).
 * - Хранение запросов у хозяев модели — по настройкам OpenRouter; запретить его можно `createOpenRouterProvider`.
 * - Потолок цены, сортировка и липкость к хозяину — тоже `createOpenRouterProvider({ maxPrice, sort, stickyProvider })`.
 * - Через прокси — `createOpenRouterProvider({ baseURL, headers })` или правка каталога `connectProviders`.
 */
export const openrouterProvider: ProviderDescription = createOpenRouterProvider();
