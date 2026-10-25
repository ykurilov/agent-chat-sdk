import type { ImageFailureKind } from "./image-failure";
import { kieProvider } from "./kie-provider";
import { runwareProvider } from "./runware-provider";

/** Пропорции, которые модель может заказать у `generate_images`. */
export type AspectRatio = "1:1" | "3:2" | "2:3" | "16:9" | "9:16";

export const aspectRatios: readonly AspectRatio[] = ["1:1", "3:2", "2:3", "16:9", "9:16"];

/** Качество GPT Image у Runware. */
export type ImageQuality = "low" | "medium" | "high" | "auto";

export const imageQualities: readonly ImageQuality[] = ["low", "medium", "high", "auto"];

/** Размер картинки: `default` — размер модели по умолчанию (`aspectRatios`), `1k` — длинная сторона около 1024. */
export type ImageSize = "default" | "1k";

export const imageSizes: readonly ImageSize[] = ["default", "1k"];

/** Стороны картинки для каждой пропорции. */
export type ImageSizesByAspectRatio = Record<AspectRatio, { width: number; height: number }>;

/** Размер модели, кроме размера по умолчанию: стороны и цена картинки в нём. */
export interface ImageSizeOption {
  aspectRatios: ImageSizesByAspectRatio;
  /** Цена картинки этого размера в качестве по умолчанию; нет — `pricePerImageUsd` модели. */
  pricePerImageUsd?: number;
}

/** Формат файла картинки. */
export type ImageFileFormat = "png" | "jpeg" | "webp";

/** Заказ одной картинки провайдеру. */
export interface ImageGenerationRequest {
  /** Id задачи у провайдера: свой у каждой картинки. */
  taskUUID: string;
  /** Id модели у этого провайдера (`ImageModelProfile.providerModelIds[provider.id]`). */
  providerModelId: string;
  prompt: string;
  width: number;
  height: number;
  /** Пропорция для провайдеров, которые принимают её строкой (KIE): `ImageModelProfile.aspectRatioValues` или своя. */
  aspectRatio?: string;
  /** Исходная картинка для моделей правки (разделение на слои): адрес готовой картинки предыдущего шага. */
  imageUrl?: string;
  /** Формат файла; не указан — формат провайдера по умолчанию (у Runware JPG). Прозрачному фону нужен `png`. */
  outputFormat?: ImageFileFormat;
  /** Настройки модели у провайдера из профиля (`ImageModelProfile.providerSettings`) с качеством и фоном приложения. */
  providerSettings?: Record<string, unknown>;
  /** «Стоп» хода. */
  abortSignal?: AbortSignal;
  /** Срок одной генерации. */
  timeoutMs: number;
}

/** Как достучаться до провайдера: ключ из окружения сервера, адрес и заголовки подключения (прокси). */
export interface ImageProviderConnection {
  apiKey: string;
  baseURL?: string;
  headers?: Record<string, string>;
  fetch: typeof globalThis.fetch;
}

/** Результат одной задачи: адрес готовой картинки и цена, если провайдер её сообщил. */
export interface ImageGenerationResult {
  url: string;
  costUsd?: number;
}

/** Состояние задачи в очереди провайдера. `costUsd` провала — если провайдер сообщил, сколько списал. */
export type ImageTaskState =
  | { status: "pending" }
  | { status: "ready"; results: ImageGenerationResult[] }
  | { status: "failed"; reason: string; costUsd?: number; failureKind?: ImageFailureKind; providerCode?: string };

/**
 * Очередь провайдера (KIE и подобные): задача отправляется и проверяется отдельно. Так генерация переживает срок
 * вызова: опрос продолжается в фоне, а повтор того же вызова сначала проверяет старую задачу, а не платит за новую.
 * Отказ отправки — `ImageGenerationError` (как у `generate`). Сбой проверки: `ImageGenerationError` — проверять дальше
 * бессмысленно (неверный ключ), любая другая ошибка — временная, опрос повторит.
 */
export interface ImageTaskQueue {
  /** Отправить задачу; ответ — id задачи у провайдера. */
  submit(request: ImageGenerationRequest, connection: ImageProviderConnection): Promise<string>;
  check(taskId: string, connection: ImageProviderConnection, abortSignal?: AbortSignal): Promise<ImageTaskState>;
}

/**
 * Провайдер картинок (Runware и подобные). Сбой задачи — `ImageGenerationError`: его причина уходит модели, а
 * `refusedBeforeWork` говорит, что провайдер отказал до работы и расхода нет. Любая другая ошибка — «провайдер
 * недоступен», текст её наружу не идёт (в нём могут оказаться ключ или адрес).
 */
export interface ImageProviderDescription {
  id: string;
  displayName: string;
  /** Имя переменной окружения с ключом: `RUNWARE_API_KEY`. */
  apiKeyEnv: string;
  /** Адрес по умолчанию: `https://api.runware.ai/v1`. */
  baseURL?: string;
  headers?: Record<string, string>;
  /** Задача целиком: отправка и ожидание результата не дольше `request.timeoutMs`. */
  generate(request: ImageGenerationRequest, connection: ImageProviderConnection): Promise<ImageGenerationResult[]>;
  /** Есть у провайдеров с очередью: тогда `createImageGeneration` ведёт задачу сам (фоновый опрос, безопасный повтор). */
  queue?: ImageTaskQueue;
}

/** Профиль модели картинок. */
export interface ImageModelProfile {
  /** `gpt-image-2`. */
  id: string;
  displayName: string;
  /** Id модели у провайдера: `{ runware: "openai:gpt-image@2" }`. */
  providerModelIds: Record<string, string>;
  /** Размер по умолчанию для каждой пропорции. */
  aspectRatios: ImageSizesByAspectRatio;
  /** Другие размеры, которые приложение выбирает настройкой `size`. */
  sizes?: Partial<Record<Exclude<ImageSize, "default">, ImageSizeOption>>;
  /** Поля задачи для этой модели у провайдера: у Runware `providerSettings` или `settings` с качеством, у KIE — поля `input`. */
  providerSettings?: Record<string, unknown>;
  /**
   * Где в `providerSettings` лежат качество и фон: у Runware GPT Image 2 — `["providerSettings", "openai"]`, у 2.5 —
   * `["settings"]`. Нет — модель не принимает `quality`, и настройка с ним — ошибка.
   */
  settingsPath?: readonly string[];
  /** Модель умеет прозрачный фон (`background: "transparent"` по `settingsPath`). */
  transparentBackground?: boolean;
  /** Пропорция у провайдера, если она не совпадает с заказанной: z-image не знает 3:2 — берётся 4:3. */
  aspectRatioValues?: Partial<Record<AspectRatio, string>>;
  /** Модель правит готовую картинку (разделение на слои): ей нужен `imageUrl`, сама по себе она не рисует. */
  needsSourceImage?: boolean;
  /** Первый адрес ответа — основа (фон без предмета), а не результат: сохраняется следующий. */
  firstResultIsBase?: boolean;
  /**
   * Цена картинки размера по умолчанию в качестве по умолчанию. По ней (с размером и качеством) заказ бронируется в
   * лимитах, и она же записывается, если провайдер не сообщил цену или человек нажал «Стоп». С запасом: лучше записать лишнее.
   */
  pricePerImageUsd: number;
  /** Во сколько раз дороже картинка в другом качестве, чем в качестве по умолчанию; нет — так же. */
  qualityPriceFactors?: Partial<Record<ImageQuality, number>>;
}

/** Каталог моделей и провайдеров картинок; правится `extendImageCatalog`, как каталог моделей ядра. */
export interface ImageCatalog {
  providers: ImageProviderDescription[];
  models: ImageModelProfile[];
}

/** Подключение провайдера через прокси, как у провайдеров моделей ядра. */
export interface ImageProviderConnectionChange {
  baseURL?: string;
  headers?: Record<string, string>;
}

export interface ImageCatalogChange {
  removeModels?: string[];
  addModels?: ImageModelProfile[];
  addProviders?: ImageProviderDescription[];
  connectProviders?: Record<string, ImageProviderConnectionChange>;
}

/**
 * Наименьший размер GPT Image у Runware: стороны кратны 16, площадь не меньше 655 360 пикселей,
 * пропорция точнее 1 %.
 */
const gptImageSizes: ImageSizesByAspectRatio = {
  "1:1": { width: 816, height: 816 },
  "3:2": { width: 1008, height: 672 },
  "2:3": { width: 672, height: 1008 },
  "16:9": { width: 1088, height: 608 },
  "9:16": { width: 608, height: 1088 },
};

/**
 * GPT Image в 1K: длинная сторона около 1024 при тех же условиях Runware. Кроме 1:1 совпадает с наименьшим размером:
 * 1024×576 для 16:9 Runware отвергает (меньше 655 360 пикселей).
 */
const gptImage1kSizes: ImageSizesByAspectRatio = { ...gptImageSizes, "1:1": { width: 1024, height: 1024 } };

/**
 * Seedream 5.0 в разрешении 1K: площадь от 0,92 Мп. Проверено живым запросом 3 октября 2026: Runware принимает `width` и `height`
 * из этой таблицы без отдельного поля разрешения (1024×1024, цена $0.0193 в ответе), поэтому профиль без `providerSettings`.
 */
const seedreamSizes: ImageSizesByAspectRatio = {
  "1:1": { width: 1024, height: 1024 },
  "3:2": { width: 1248, height: 832 },
  "2:3": { width: 832, height: 1248 },
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
};

/**
 * z-image у KIE: размер задаётся пропорцией, 1:1 — 1024×1024 (живой запрос 5 октября 2026). Остальные стороны —
 * примерные для заглушки на экране: настоящий размер берётся из скачанного PNG.
 */
const zImageSizes: ImageSizesByAspectRatio = {
  "1:1": { width: 1024, height: 1024 },
  "3:2": { width: 1152, height: 864 },
  "2:3": { width: 864, height: 1152 },
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
};

const lowQualityGpt2 = { providerSettings: { openai: { quality: "low" } } };
const lowQualityGpt25 = { settings: { quality: "low" } };
/**
 * Цена GPT Image растёт с качеством примерно как у OpenAI: medium вчетверо дороже low, high — в 16 раз. `auto` может
 * выбрать high — бронируется как high.
 */
const gptQualityPriceFactors = { medium: 4, high: 16, auto: 16 };
/**
 * Цены — замер Runware 5 октября 2026 (цена из ответа, low): 1024×1024 — $0.00602 у 2 и 2.5 Flare, $0.00599 у 2.5 Sunburst,
 * с прозрачным фоном так же. Наименьший размер — по площади (816² ≈ 0,64 от 1024²), с запасом.
 */
const gptPrices = { pricePerImageUsd: 0.005, qualityPriceFactors: gptQualityPriceFactors, sizes: { "1k": { aspectRatios: gptImage1kSizes, pricePerImageUsd: 0.007 } } };
/** GPT Image 2 у Runware не умеет прозрачный фон: на `background: "transparent"` — `invalidOpenAiBackground` (только opaque и auto). */
const gpt2Settings = { providerSettings: lowQualityGpt2, settingsPath: ["providerSettings", "openai"], ...gptPrices };
const gpt25Settings = { providerSettings: lowQualityGpt25, settingsPath: ["settings"], transparentBackground: true, ...gptPrices };
/** Seedream и z-image рисуют в 1K и так: размер 1K у них — размер по умолчанию. */
const sizes1k = (aspectRatios: ImageSizesByAspectRatio) => ({ sizes: { "1k": { aspectRatios } } });
/** Seedream у KIE: 1K и PNG (разделению на слои PNG нужен и для основы). */
const kieSeedreamSettings = { size: "1K", output_format: "png" };

/**
 * Runware и пять моделей (research.md, раздел 9); каждая в наименьшем разрешении и низшем качестве. KIE — три модели:
 * z-image (дешёвая картинка без текста), Seedream 5.0 Flash (держит надписи) и разделение готовой картинки на слои
 * (предмет без фона). Цены KIE — живые запросы 5 октября 2026, с запасом.
 */
export const standardImageCatalog: ImageCatalog = {
  providers: [runwareProvider, kieProvider],
  models: [
    {
      id: "gpt-image-2",
      displayName: "GPT Image 2",
      providerModelIds: { runware: "openai:gpt-image@2" },
      aspectRatios: gptImageSizes,
      ...gpt2Settings,
    },
    {
      id: "gpt-image-2.5-flare",
      displayName: "GPT Image 2.5 Flare",
      providerModelIds: { runware: "openai:gpt-image@2.5-flare" },
      aspectRatios: gptImageSizes,
      ...gpt25Settings,
    },
    {
      id: "gpt-image-2.5-sunburst",
      displayName: "GPT Image 2.5 Sunburst",
      providerModelIds: { runware: "openai:gpt-image@2.5-sunburst" },
      aspectRatios: gptImageSizes,
      ...gpt25Settings,
    },
    {
      id: "seedream-5-flash",
      displayName: "Seedream 5.0 Flash",
      providerModelIds: { runware: "bytedance:seedream@5.0-flash" },
      aspectRatios: seedreamSizes,
      ...sizes1k(seedreamSizes),
      pricePerImageUsd: 0.02,
    },
    {
      id: "seedream-5-lite",
      displayName: "Seedream 5.0 Lite",
      providerModelIds: { runware: "bytedance:seedream@5.0-lite" },
      aspectRatios: seedreamSizes,
      ...sizes1k(seedreamSizes),
      pricePerImageUsd: 0.04,
    },
    {
      id: "z-image",
      displayName: "Z-Image",
      providerModelIds: { kie: "z-image" },
      aspectRatios: zImageSizes,
      ...sizes1k(zImageSizes),
      aspectRatioValues: { "3:2": "4:3", "2:3": "3:4" },
      // 0,8 кредита = $0.004.
      pricePerImageUsd: 0.005,
    },
    {
      id: "seedream-5-flash-kie",
      displayName: "Seedream 5.0 Flash (KIE)",
      providerModelIds: { kie: "seedream/5-flash-text-to-image" },
      aspectRatios: seedreamSizes,
      ...sizes1k(seedreamSizes),
      providerSettings: kieSeedreamSettings,
      // 3,24 кредита = $0.0162 за 1K.
      pricePerImageUsd: 0.02,
    },
    {
      id: "seedream-5-flash-layers",
      displayName: "Seedream 5.0 Flash: разделение на слои",
      providerModelIds: { kie: "seedream/5-flash-layer-decomposition" },
      aspectRatios: seedreamSizes,
      ...sizes1k(seedreamSizes),
      providerSettings: kieSeedreamSettings,
      needsSourceImage: true,
      firstResultIsBase: true,
      // Основа и один слой — 6,48 кредита ($0.032); без подсказки слоёв больше и дороже ($0.065).
      pricePerImageUsd: 0.07,
    },
  ],
};

/** Каталог с правками приложения; исходный каталог не меняется. Несогласованная правка — ошибка настройки. */
export function extendImageCatalog(base: ImageCatalog, change: ImageCatalogChange): ImageCatalog {
  for (const id of change.removeModels ?? []) {
    if (!base.models.some((model) => model.id === id)) throw new Error(`Убрать нечего: модели картинок «${id}» нет в каталоге`);
  }
  const removed = new Set(change.removeModels ?? []);
  const added = change.addModels ?? [];
  const addedIds = new Set(added.map((model) => model.id));
  const models = [...base.models.filter((model) => !removed.has(model.id) && !addedIds.has(model.id)), ...added];

  const addedProviders = change.addProviders ?? [];
  const addedProviderIds = new Set(addedProviders.map((provider) => provider.id));
  const providers = [...base.providers.filter((provider) => !addedProviderIds.has(provider.id)), ...addedProviders];
  const connections = change.connectProviders ?? {};
  for (const providerId of Object.keys(connections)) {
    if (!providers.some((provider) => provider.id === providerId)) {
      throw new Error(`Подключить через прокси нечего: провайдера картинок «${providerId}» нет в каталоге`);
    }
  }
  const connected = providers.map((provider) => {
    const connection = connections[provider.id];
    if (!connection) return provider;
    return {
      ...provider,
      ...(connection.baseURL !== undefined && { baseURL: connection.baseURL }),
      ...(connection.headers !== undefined && { headers: { ...connection.headers } }),
    };
  });

  const providerIds = new Set(connected.map((provider) => provider.id));
  for (const model of added) {
    const unknown = Object.keys(model.providerModelIds).filter((providerId) => !providerIds.has(providerId));
    if (unknown.length > 0) throw new Error(`Модель картинок «${model.id}»: провайдера ${unknown.map((id) => `«${id}»`).join(", ")} нет в каталоге`);
  }
  return { providers: connected, models };
}
