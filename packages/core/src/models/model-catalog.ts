import type { JSONValue, LanguageModel } from "ai";
import type { ChatErrorKind, TokenUsage } from "../conversation/types";
import type { ModelSilenceSetting } from "../provider-errors/model-silence";
import { peakHoursProblem } from "../usage/peak-hours";
import { hiddenField } from "./providers/provider-connection";

/** Опции запроса по провайдерам: `{ fireworks: { promptCacheKey: "…" } }`. */
export type ProviderOptionsByProvider = Record<string, Record<string, JSONValue>>;

/** Уровень рассуждений. Названия для экрана — в надписях интерфейса, не здесь. */
export type ReasoningLevelId = "off" | "on" | "minimal" | "low" | "medium" | "high" | "max";

/** Как включить и настроить рассуждения одним запросом: параметр SDK и/или опции провайдера. */
export interface ReasoningRequest {
  /** Общий параметр SDK `reasoning`. */
  reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "provider-default";
  providerOptions?: ProviderOptionsByProvider;
}

/** Цены за миллион токенов, доллары США. Рассуждения идут по цене выхода. */
export interface ModelPriceRates {
  inputPerMillion: number;
  outputPerMillion: number;
  /** Вход, прочитанный из кэша. Нет — считается по цене входа. */
  cachedInputPerMillion?: number;
  /** Вход, записанный в кэш на 5 минут (обычная метка). Нет — считается по цене входа. */
  cacheWritePerMillion?: number;
  /**
   * Вход, записанный в кэш на час (метка `ttl: "1h"`, у Anthropic дороже пятиминутной). Берётся, когда модель у этого
   * провайдера пишет кэш на час (`ModelPrice.cacheWriteTtl`); нет — запись идёт по `cacheWritePerMillion`.
   */
  cacheWrite1hPerMillion?: number;
}

/** Срок жизни кэша по метке `cache_control`: 5 минут (метка без срока) или час. */
export type CacheTtl = "5m" | "1h";

const CACHE_TTLS: readonly CacheTtl[] = ["5m", "1h"];

export function isCacheTtl(value: unknown): value is CacheTtl {
  return CACHE_TTLS.includes(value as CacheTtl);
}

/** Ступень цены: запрос, у которого вход (вместе с кэшем) больше порога, целиком идёт по её ценам. */
export interface ModelPriceTier extends ModelPriceRates {
  inputTokensAbove: number;
}

/** Окно часов пик: дни недели (1 — понедельник … 7 — воскресенье) и часы `from`–`to` («ЧЧ:ММ», `to` не входит). */
export interface ModelPeakWindow {
  days: number[];
  from: string;
  /** Раньше `from` — окно идёт через полночь и кончается на следующий день. */
  to: string;
}

/**
 * Часы пик: запрос, начатый в одно из окон, стоит дороже в `multiplier` раз. Цены профиля — вне пика. Пример —
 * DeepSeek: по будням 01–04 и 06–10 UTC всё вдвое дороже, включая попадания в кэш.
 */
export interface ModelPeakHours {
  /** Пояс IANA, по часам которого заданы окна. По умолчанию UTC. */
  timeZone?: string;
  windows: ModelPeakWindow[];
  /** Множитель цен входа, выхода и записи в кэш. */
  multiplier: number;
  /** Множитель цены входа из кэша. Нет — тот же `multiplier`. */
  cachedInputMultiplier?: number;
  /** Даты по поясу окон (`ГГГГ-ММ-ДД`), когда пика нет: праздники провайдера. */
  exceptDates?: string[];
}

/** Цена модели у одного провайдера. */
export interface ModelPrice extends ModelPriceRates {
  /** Ступени по длине контекста (как `tiers` в pi-mono): действует ступень с самым высоким пройденным порогом. */
  tiers?: ModelPriceTier[];
  /** Часы пик: цена по времени запроса. Нет — цена одна в любое время. */
  peakHours?: ModelPeakHours;
  /**
   * С каким сроком модель пишет кэш у этого провайдера: `"1h"` — запись по `cacheWrite1hPerMillion`. Нет часовой цены (у
   * цены или у её ступени) — запись по `cacheWritePerMillion`: так приложения до 0.43 клали туда часовую цену, и расход
   * у них остаётся прежним. Служба чата при запуске пишет об этом предупреждение (`cachePriceWarnings`). Ставит каталог
   * (`createModelCatalog`, `extendCatalog`) по провайдеру (`cacheTtlFor`), в профиле задавать не нужно: что поставлено
   * руками, каталог перепишет.
   */
  cacheWriteTtl?: "1h";
}

export interface ModelProfile {
  id: string;
  displayName: string;
  contextWindowTokens: number;
  /**
   * Потолок вывода модели за один запрос (рассуждения и ответ вместе), например 128 000 у Claude Haiku 5.5 (OpenRouter,
   * `max_completion_tokens`). Есть — уходит в каждом запросе к модели как `maxOutputTokens`, если приложение не задало
   * свой предел (`agent.maxOutputTokens`): ответ обрывается только на настоящем потолке, а не на пределе провайдера по
   * умолчанию. От него же считаются бюджет рассуждений (`reasoning.tokenBudget`) и уровень с запасом на ответ
   * (`reasoning.effortShareOfOutput`). Нет — предела в запросе нет, как раньше.
   */
  maxOutputTokens?: number;
  /** Видит ли модель картинку в сообщении. У отдельного провайдера ответ может быть другим: `acceptsImagesByProvider`. */
  acceptsImages: boolean;
  /**
   * Зрение у отдельных провайдеров: `{ together: false }` — модель видит картинки, но через Together нет. Отметка
   * провайдера главнее `acceptsImages`; нет отметки — как `acceptsImages`. Читать через `modelAcceptsImages`.
   */
  acceptsImagesByProvider?: Record<string, boolean>;
  /**
   * Провайдеры, через которых модель видит картинку в результате инструмента (по проверке вживую). Нет или пусто —
   * не видит: картинка в сообщении собеседника от этого не зависит. Ядро отметку не читает, её читают инструменты приложения.
   */
  toolResultImageProviders?: string[];
  reasoning: {
    /** Возвращать ли рассуждения прошлых ходов. Внутри хода — всегда. */
    replayPastTurns: boolean;
    /** Уровни для выбора, от малого к большому. Нет или пусто — выбора уровня нет. */
    levels?: ReasoningLevelId[];
    /** Обязателен, если есть уровни, и входит в них. */
    defaultLevel?: ReasoningLevelId;
    /** Рассуждения приходят зашифрованными: у провайдера просят пересказ, человеку виден только он. */
    encrypted?: boolean;
    /**
     * Модель держит жёсткий бюджет рассуждений (у OpenRouter — `reasoning.max_tokens`: Claude до 4.6 с `budget_tokens`,
     * Gemini 2.5, часть Qwen). Уровни идут бюджетом от потолка вывода запроса вместо силы рассуждений, ответу остаётся
     * запас (`reasoningBudgetTokens`). Ставить только по проверке вживую: Claude Haiku 5.5 бюджет не держит (просили
     * 2 000 — рассуждал 6 082). Нет — уровни идут силой рассуждений (`effort`).
     */
    tokenBudget?: boolean;
    /**
     * Сила рассуждений у модели — доля потолка вывода (шкала OpenRouter для Claude: `xhigh` — 95 %, `high` — 80 %,
     * `medium` — 50 %, `low` — 20 %, `minimal` — 10 %). Тогда уровень выбирается с запасом на ответ
     * (`effortWithAnswerReserve`): «Максимум» — самый глубокий уровень, после доли которого ответу остаётся запас; при
     * потолке 128 000 это `high`. Нет потолка вывода — уровень как раньше. С `tokenBudget` не нужен: бюджет главнее.
     */
    effortShareOfOutput?: boolean;
  };
  /** Id модели у каждого провайдера. Провайдеры вне списка модель не обслуживают. */
  providerModelIds: Record<string, string>;
  /** Опции провайдера именно для этой модели, если нужны. */
  providerOptions?: ProviderOptionsByProvider;
  /** Цены по провайдерам. Читает расширение лимитов расходов; ядро деньги не считает. */
  pricing?: Record<string, ModelPrice>;
  /**
   * Срок кэша этой модели у провайдеров с явными метками кэша (OpenRouter): `"1h"` — метки с `ttl: "1h"`. Нет — 5 минут.
   * Срок, заданный провайдеру приложением (`createOpenRouterProvider({ cacheTtl, cacheTtlByModel })`), главнее.
   */
  cacheTtl?: CacheTtl;
}

export interface ProviderRequestOptions {
  providerOptions?: ProviderOptionsByProvider;
  /** Опции сообщения-инструкции: метка кэша, если провайдер читает кэш только по ней. */
  instructionsProviderOptions?: ProviderOptionsByProvider;
  /**
   * Опции последнего сообщения истории: скользящая метка кэша, чтобы кэшировалась и переписка. Есть они — со второго
   * шага хода такая же метка стоит и на конце шага, до снимка и пометок. Нет — провайдер кэширует сам, меток в запросе нет.
   */
  lastMessageProviderOptions?: ProviderOptionsByProvider;
  headers?: Record<string, string>;
}

export interface ProviderConnectionOptions {
  /** Свой `fetch` — для записи запросов в живых проверках. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Подключение к провайдеру не напрямую, а через обратный прокси (с российского сервера зарубежные провайдеры недоступны).
 * Через него идут все запросы провайдера: ход, фоновые вызовы памяти и сжатия, сверка расхода.
 */
export interface ProviderConnection {
  /** Адрес API вместо стандартного, `http(s)://…`, например `https://proxy.example.com/openrouter/api/v1`. */
  baseURL?: string;
  /** Заголовки к каждому запросу, например `{ "X-Proxy-Token": process.env.PROXY_TOKEN }`. Значения — секреты: вычищаются из ошибок и журналов. */
  headers?: Record<string, string>;
  /**
   * Свои сроки молчания потока этого провайдера, мс, в том же виде, что `agent.modelSilenceTimeout`: заданные поля
   * перекрывают общие, пропущенные берутся из общих, `false` — без сроков. Действует на каждую попытку у этого
   * провайдера, в том числе после перехода на него запасным (`providerFallback`). Запрос к модели не меняет.
   */
  modelSilenceTimeout?: ModelSilenceSetting;
  /**
   * Скрыть провайдера из меню выбора модели: его и его моделей нет в `getModelMenu` (`GET /models`), человек не может
   * выбрать его в чате. Как маршрут по умолчанию (`defaultChoice`) и запасной (`providerFallback`) он работает обычно.
   */
  hiddenFromMenu?: boolean;
}

export interface ProviderDescription {
  id: string;
  displayName: string;
  /** Ключ читается из окружения сервера по этому имени. */
  apiKeyEnv: string;
  createLanguageModel(providerModelId: string, apiKey: string, options?: ProviderConnectionOptions): LanguageModel;
  /**
   * Поля под кэш и прочие постоянные опции запроса. `profile` — модель запроса (ядро передаёт всегда): по ней провайдер
   * может выбрать срок кэша (`cacheTtlFor`).
   */
  requestOptions(context: { chatId: string; profile?: ModelProfile }): ProviderRequestOptions;
  /**
   * Срок, с которым метки кэша провайдера держат кэш этой модели. По нему каталог выбирает цену записи
   * (`ModelPrice.cacheWriteTtl`). Нет метода — 5 минут.
   */
  cacheTtlFor?(profile: ModelProfile): CacheTtl;
  /**
   * Перевод уровня рассуждений в запрос. Бросает ошибку на уровень, которого провайдер не умеет.
   * Без метода провайдер обслуживает только модели без уровней.
   */
  reasoningRequest?(
    level: ReasoningLevelId,
    model: {
      profile: ModelProfile;
      providerModelId: string;
      /** Предел вывода, с которым уйдёт запрос (приложения или потолок модели). Нет — запрос без предела. */
      maxOutputTokens?: number;
    },
  ): ReasoningRequest;
  /** Подсказки для вида ошибки по телу ответа, если кода HTTP мало. */
  errorHints?: Array<{ match: RegExp; kind: ChatErrorKind }>;
  /**
   * Настоящий расход генерации по её номеру (FR-058). Без него оборванный «Стопом» или сбоем шаг остаётся оценкой.
   * Нужен провайдерам, у которых отменённый запрос дорабатывает и оплачивается (OpenRouter у части моделей).
   */
  generationUsage?: GenerationUsage;
  /** Подключение через прокси, если задано: по нему вычищаются секреты заголовков. */
  connection?: ProviderConnection;
  /** Свои сроки молчания провайдера (`ProviderConnection.modelSilenceTimeout`); нет — общие сроки агента. */
  modelSilenceTimeout?: ModelSilenceSetting;
  /** Скрыт из меню выбора модели (`ProviderConnection.hiddenFromMenu`); нет — виден. */
  hiddenFromMenu?: boolean;
  /** Тот же провайдер с другим подключением; есть у встроенных. Нужен правке каталога `connectProviders`. */
  connect?(connection: ProviderConnection): ProviderDescription;
  /**
   * Провайдер — другой маршрут к тем же моделям, что у провайдера с этим id (например, маршрут OpenRouter к одному
   * хозяину модели). Каталог сам даёт ему id моделей, цены и отметку картинки в результате инструмента того провайдера;
   * своя запись модели главнее.
   */
  servesModelsOf?: string;
}

/** Как узнать у провайдера настоящий расход одной генерации (одного запроса к модели) после её конца. */
export interface GenerationUsage {
  /** Номер генерации по заголовкам ответа на запрос (имена — строчными буквами); нет номера — `undefined`. */
  generationId(headers: Record<string, string | undefined> | undefined): string | undefined;
  /**
   * Расход генерации: вход с кэшем, выход с рассуждениями. Провайдер ещё не знает его — `null` (спросят позже);
   * другой сбой — ошибка.
   */
  lookup(request: { generationId: string; apiKey: string; fetch?: typeof globalThis.fetch; signal?: AbortSignal }): Promise<TokenUsage | null>;
}

export interface ModelCatalog {
  models: ModelProfile[];
  providers: ProviderDescription[];
}

/** Собирает каталог и отказывает на несогласованных профилях и провайдерах. */
export function createModelCatalog(catalog: ModelCatalog): ModelCatalog {
  assertUnique(catalog.models.map((model) => model.id), "модель");
  assertUnique(catalog.providers.map((provider) => provider.id), "провайдер");
  for (const provider of catalog.providers) hiddenField(provider.id, { hiddenFromMenu: provider.hiddenFromMenu });
  const providers = new Map(catalog.providers.map((provider) => [provider.id, provider]));
  const models = withCacheWriteTtl(withRouteModels(catalog.models, catalog.providers), providers);
  for (const model of models) {
    const unknown = Object.keys(model.providerModelIds).filter((providerId) => !providers.has(providerId));
    if (unknown.length > 0) {
      throw new Error(`Профиль модели «${model.id}» ссылается на провайдеров, которых нет в каталоге: ${unknown.join(", ")}`);
    }
    if (model.cacheTtl !== undefined && !isCacheTtl(model.cacheTtl)) {
      throw new Error(`У модели «${model.id}» неверный cacheTtl — "5m" или "1h": ${JSON.stringify(model.cacheTtl)}`);
    }
    assertReasoningLevels(model, providers);
    assertPricing(model);
    assertImageProviders(model);
    assertMaxOutputTokens(model);
  }
  return { models, providers: [...catalog.providers] };
}

/** Модели с записями маршрутов (`servesModelsOf`): id модели, цена, отметки картинки — как у провайдера-образца. */
function withRouteModels(models: ModelProfile[], providers: ProviderDescription[]): ModelProfile[] {
  const routes = providers.filter((provider) => provider.servesModelsOf !== undefined);
  for (const route of routes) {
    if (!providers.some((provider) => provider.id === route.servesModelsOf && provider.servesModelsOf === undefined)) {
      throw new Error(`Провайдер «${route.id}» обслуживает модели провайдера «${route.servesModelsOf}», а его нет в каталоге`);
    }
  }
  if (routes.length === 0) return [...models];
  return models.map((model) => {
    const providerModelIds = { ...model.providerModelIds };
    const pricing = model.pricing && { ...model.pricing };
    const imageProviders = model.toolResultImageProviders && [...model.toolResultImageProviders];
    const imagesByProvider = model.acceptsImagesByProvider && { ...model.acceptsImagesByProvider };
    for (const route of routes) {
      const source = route.servesModelsOf!;
      if (!model.providerModelIds[source]) continue;
      providerModelIds[route.id] ??= model.providerModelIds[source];
      if (pricing?.[source] && !pricing[route.id]) pricing[route.id] = pricing[source];
      if (imageProviders?.includes(source) && !imageProviders.includes(route.id)) imageProviders.push(route.id);
      if (imagesByProvider && source in imagesByProvider && !(route.id in imagesByProvider)) imagesByProvider[route.id] = imagesByProvider[source]!;
    }
    return {
      ...model,
      providerModelIds,
      ...(pricing && { pricing }),
      ...(imageProviders && { toolResultImageProviders: imageProviders }),
      ...(imagesByProvider && { acceptsImagesByProvider: imagesByProvider }),
    };
  });
}

/**
 * Цены, по которым запись в кэш посчитается не так, как, вероятно, задумано (служба чата пишет их в журнал при запуске):
 * - у цены есть `cacheWrite1hPerMillion`, а у ступени нет — часовая запись в ступени пойдёт по её `cacheWritePerMillion`;
 * - модель пишет кэш на час (`cacheWriteTtl: "1h"`), а часовой цены нет — запись по `cacheWritePerMillion`.
 */
export function cachePriceWarnings(catalog: ModelCatalog): string[] {
  const warnings: string[] = [];
  for (const model of catalog.models) {
    for (const [providerId, price] of Object.entries(model.pricing ?? {})) {
      const where = `Цена модели «${model.id}» у провайдера «${providerId}»`;
      if (price.cacheWrite1hPerMillion === undefined) {
        if (price.cacheWriteTtl === "1h") {
          warnings.push(`${where}: модель пишет кэш на час, а цены часовой записи (cacheWrite1hPerMillion) нет — запись посчитается по cacheWritePerMillion (цене 5 минут)`);
        }
        continue;
      }
      for (const tier of price.tiers ?? []) {
        if (tier.cacheWrite1hPerMillion === undefined) {
          warnings.push(`${where}: у ступени выше ${tier.inputTokensAbove} токенов нет cacheWrite1hPerMillion — часовая запись в ней посчитается по cacheWritePerMillion ступени`);
        }
      }
    }
  }
  return warnings;
}

/**
 * Отметка срока записи кэша в ценах: у провайдера, который пишет кэш модели на час, — `cacheWriteTtl: "1h"`, у других
 * отметки нет. Считается заново при каждой сборке каталога: смена срока у провайдера меняет и цену. Цена без перемен —
 * тот же объект.
 */
function withCacheWriteTtl(models: ModelProfile[], providers: Map<string, ProviderDescription>): ModelProfile[] {
  return models.map((model) => {
    if (!model.pricing) return model;
    let changed = false;
    const pricing = Object.fromEntries(
      Object.entries(model.pricing).map(([providerId, price]) => {
        const hour = providers.get(providerId)?.cacheTtlFor?.(model) === "1h";
        if (hour === (price.cacheWriteTtl === "1h")) return [providerId, price];
        changed = true;
        const { cacheWriteTtl: _previous, ...rest } = price;
        return [providerId, hour ? { ...rest, cacheWriteTtl: "1h" as const } : rest];
      }),
    );
    return changed ? { ...model, pricing } : model;
  });
}

function assertUnique(ids: string[], what: string): void {
  const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (repeated !== undefined) throw new Error(`В каталоге дважды ${what} «${repeated}»`);
}

/** Видит ли модель картинку в сообщении у этого провайдера: отметка провайдера, иначе отметка модели. */
export function modelAcceptsImages(profile: Pick<ModelProfile, "acceptsImages" | "acceptsImagesByProvider">, providerId: string): boolean {
  return profile.acceptsImagesByProvider?.[providerId] ?? profile.acceptsImages;
}

function assertMaxOutputTokens(model: ModelProfile): void {
  const { maxOutputTokens } = model;
  if (maxOutputTokens === undefined || (Number.isSafeInteger(maxOutputTokens) && maxOutputTokens >= 1)) return;
  throw new Error(`Потолок вывода модели «${model.id}» (maxOutputTokens) должен быть целым числом токенов от 1: ${maxOutputTokens}`);
}

function assertImageProviders(model: ModelProfile): void {
  for (const providerId of Object.keys(model.acceptsImagesByProvider ?? {})) {
    if (!(providerId in model.providerModelIds)) {
      throw new Error(`У модели «${model.id}» есть отметка зрения у провайдера «${providerId}», который её не обслуживает`);
    }
  }
}

function assertPricing(model: ModelProfile): void {
  for (const [providerId, price] of Object.entries(model.pricing ?? {})) {
    if (!(providerId in model.providerModelIds)) {
      throw new Error(`У модели «${model.id}» есть цена у провайдера «${providerId}», который её не обслуживает`);
    }
    const tiers = price.tiers ?? [];
    const amounts = [price, ...tiers].flatMap((rates) => [rates.inputPerMillion, rates.outputPerMillion, rates.cachedInputPerMillion, rates.cacheWritePerMillion, rates.cacheWrite1hPerMillion]);
    if (amounts.some((amount) => amount !== undefined && !(Number.isFinite(amount) && amount >= 0))) {
      throw new Error(`Цена модели «${model.id}» у провайдера «${providerId}» должна состоять из неотрицательных чисел`);
    }
    const thresholds = tiers.map((tier) => tier.inputTokensAbove);
    if (thresholds.some((threshold) => !(Number.isInteger(threshold) && threshold > 0)) || new Set(thresholds).size !== thresholds.length) {
      throw new Error(`Пороги ступеней цены модели «${model.id}» у провайдера «${providerId}» должны быть разными целыми числами больше нуля`);
    }
    if (price.peakHours) {
      const problem = peakHoursProblem(price.peakHours);
      if (problem) throw new Error(`Часы пик цены модели «${model.id}» у провайдера «${providerId}»: ${problem}`);
    }
  }
}

function assertReasoningLevels(model: ModelProfile, providers: Map<string, ProviderDescription>): void {
  const levels = model.reasoning.levels ?? [];
  if (levels.length === 0) return;
  const { defaultLevel } = model.reasoning;
  if (!defaultLevel) throw new Error(`У модели «${model.id}» есть уровни рассуждений, но нет уровня по умолчанию`);
  if (!levels.includes(defaultLevel)) {
    throw new Error(`Уровень по умолчанию «${defaultLevel}» модели «${model.id}» не входит в её уровни`);
  }
  for (const [providerId, providerModelId] of Object.entries(model.providerModelIds)) {
    const provider = providers.get(providerId)!;
    if (!provider.reasoningRequest) {
      throw new Error(`Провайдер «${providerId}» не переводит уровни рассуждений, а у модели «${model.id}» они есть`);
    }
    for (const level of levels) {
      try {
        provider.reasoningRequest(level, { profile: model, providerModelId });
      } catch (error) {
        throw new Error(
          `Провайдер «${providerId}» не умеет уровень «${level}» модели «${model.id}»: ${(error as Error).message}`,
        );
      }
    }
  }
}

/** В окружении сервера нет ключа провайдера. В тексте — имя переменной, значений нет. */
export class MissingProviderKeyError extends Error {
  constructor(
    readonly providerId: string,
    readonly apiKeyEnv: string,
  ) {
    super(`Нет ключа провайдера «${providerId}»: задайте переменную окружения ${apiKeyEnv}`);
    this.name = "MissingProviderKeyError";
  }
}

export interface ResolvedModel {
  profile: ModelProfile;
  provider: ProviderDescription;
  providerModelId: string;
}

export function findModel(catalog: ModelCatalog, modelId: string, providerId: string): ResolvedModel {
  const profile = catalog.models.find((model) => model.id === modelId);
  if (!profile) throw new Error(`Модели «${modelId}» нет в каталоге`);
  const provider = catalog.providers.find((candidate) => candidate.id === providerId);
  if (!provider) throw new Error(`Провайдера «${providerId}» нет в каталоге`);
  const providerModelId = profile.providerModelIds[providerId];
  if (!providerModelId) throw new Error(`Провайдер «${providerId}» не обслуживает модель «${modelId}»`);
  return { profile, provider, providerModelId };
}

export function resolveLanguageModel(
  { provider, providerModelId }: ResolvedModel,
  env: Record<string, string | undefined>,
  fetch?: typeof globalThis.fetch,
): LanguageModel {
  const apiKey = env[provider.apiKeyEnv];
  if (!apiKey) throw new MissingProviderKeyError(provider.id, provider.apiKeyEnv);
  return provider.createLanguageModel(providerModelId, apiKey, { fetch });
}
