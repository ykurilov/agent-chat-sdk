import { hideSecrets } from "./hide-secrets";
import { imageQualities, imageSizes, standardImageCatalog } from "./image-catalog";
import type { ImageCatalog, ImageFileFormat, ImageModelProfile, ImageProviderConnection, ImageProviderDescription, ImageQuality, ImageSize, ImageSizesByAspectRatio } from "./image-catalog";
import { checkImageOutput } from "./postprocess-image";
import type { ImageOutputOptions } from "./postprocess-image";

const DEFAULT_MODEL = "gpt-image-2";
/** Подсказка разделению на слои: предмет целиком одним слоем, без тени (живой запрос 5 октября 2026: 2 адреса, $0.032). */
export const DEFAULT_REMOVE_BACKGROUND_PROMPT = "Separate the whole main subject, without its shadow, into a single layer.";

/** Шаг «убрать фон»: модель правки (разделение на слои) по готовой картинке. */
export interface ImageBackgroundRemoval {
  /** Модель с `needsSourceImage`: `seedream-5-flash-layers`. */
  model: string;
  provider?: string;
  /** Подсказка модели правки; по умолчанию — предмет целиком одним слоем. */
  prompt?: string;
}

/** Назначение картинки: агент выбирает его параметром `purpose`, приложение задаёт модель и настройки. */
export interface ImagePurpose {
  /** Когда выбирать это назначение — для агента, попадает в описание инструмента. */
  description: string;
  model: string;
  provider?: string;
  quality?: ImageQuality;
  /** Размер картинки: `1k` — длинная сторона около 1024; по умолчанию — размер модели. */
  size?: ImageSize;
  transparentBackground?: boolean;
  output?: ImageOutputOptions;
  /** Сначала картинка, потом её же без фона: сохраняется предмет, фон убран. */
  removeBackground?: ImageBackgroundRemoval;
}

/** Общие настройки модели: для одной модели или по умолчанию для всех назначений. */
export interface ImageModelChoice {
  catalog?: ImageCatalog;
  model?: string;
  provider?: string;
  quality?: ImageQuality;
  size?: ImageSize;
  transparentBackground?: boolean;
  output?: ImageOutputOptions;
  purposes?: Record<string, ImagePurpose>;
  env: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
}

/** Один шаг задачи: модель, провайдер, подключение и поля запроса. */
export interface ImageStep {
  profile: ImageModelProfile;
  provider: ImageProviderDescription;
  providerModelId: string;
  connection: ImageProviderConnection;
  /** Стороны выбранного размера для каждой пропорции. */
  sizes: ImageSizesByAspectRatio;
  /** Цена картинки шага по профилю — с размером и качеством: по ней бронь в лимитах и запись без цены провайдера. */
  priceUsd: number;
  providerSettings?: Record<string, unknown>;
  outputFormat?: ImageFileFormat;
  /** Своя подсказка шага (разделение на слои); нет — описание картинки от агента. */
  prompt?: string;
  /** Сайт подключения из настройки (свой прокси, поддельный провайдер): с него картинку можно скачать и по http. */
  trustedOrigin?: string;
  /** Свой `fetch` приложения для скачивания картинки; нет — закреплённый `fetch` (download-image). */
  downloadFetch?: typeof globalThis.fetch;
}

/** Как создаётся картинка одного назначения (или единственной модели). */
export interface ImageSetup {
  /** Имя назначения; без назначений — нет. */
  purpose?: string;
  description?: string;
  steps: ImageStep[];
  output?: ImageOutputOptions;
  /** Цена всех шагов: так задача бронируется в лимите. */
  priceUsd: number;
}

export interface ImageSetups {
  /** Назначения по имени в порядке настройки; без назначений — одно, под ключом `""`. */
  byPurpose: Map<string, ImageSetup>;
  /** Есть назначения: в схеме инструмента появляется `purpose`. */
  hasPurposes: boolean;
  /** Ключ и заголовки всех подключений спрятаны. */
  hideSecrets(text: string): string;
}

/** Сумма в долларах без хвоста двоичной дроби. */
const roundUsd = (value: number) => Math.round(value * 1e9) / 1e9;

/** Поля качества и фона по пути профиля (`["settings"]`), поверх полей профиля; профиль не меняется. */
function withSettings(base: Record<string, unknown> | undefined, path: readonly string[], fields: Record<string, unknown>): Record<string, unknown> {
  const root: Record<string, unknown> = { ...base };
  let node = root;
  for (const key of path) {
    const next = node[key];
    node[key] = { ...(typeof next === "object" && next !== null ? (next as Record<string, unknown>) : {}) };
    node = node[key] as Record<string, unknown>;
  }
  Object.assign(node, fields);
  return root;
}

/**
 * Настройка картинок целиком: модели, провайдеры, ключи, качество, фон и назначения. Ошибка — исключение сразу, при
 * создании, с именем поля или модели в тексте.
 */
export function resolveImageSetups(choice: ImageModelChoice): ImageSetups {
  const catalog = choice.catalog ?? standardImageCatalog;
  const connections = new Map<string, ImageProviderConnection>();

  function connect(provider: ImageProviderDescription): ImageProviderConnection {
    const existing = connections.get(provider.id);
    if (existing) return existing;
    const apiKey = choice.env[provider.apiKeyEnv]?.trim();
    if (!apiKey) throw new Error(`Картинки: нет ключа провайдера ${provider.displayName} в переменной окружения ${provider.apiKeyEnv}`);
    const connection: ImageProviderConnection = {
      apiKey,
      ...(provider.baseURL !== undefined && { baseURL: provider.baseURL }),
      ...(provider.headers !== undefined && { headers: provider.headers }),
      fetch: choice.fetch ?? globalThis.fetch,
    };
    connections.set(provider.id, connection);
    return connection;
  }

  function step(modelId: string, providerId: string | undefined, where: string, settings: { quality?: ImageQuality; size?: ImageSize; transparentBackground?: boolean } = {}): ImageStep {
    const profile = catalog.models.find((model) => model.id === modelId);
    if (!profile) throw new Error(`Картинки: ${where}модели ${modelId} нет в каталоге`);
    const chosen = providerId ?? Object.keys(profile.providerModelIds)[0];
    if (!chosen || profile.providerModelIds[chosen] === undefined) throw new Error(`Картинки: ${where}у модели ${modelId} нет провайдера ${chosen ?? ""}`.trim());
    const provider = catalog.providers.find((item) => item.id === chosen);
    if (!provider) throw new Error(`Картинки: ${where}провайдера ${chosen} нет в каталоге`);

    const fields: Record<string, unknown> = {};
    if (settings.quality !== undefined) {
      if (!imageQualities.includes(settings.quality)) throw new Error(`Картинки: ${where}quality — одно из ${imageQualities.join(", ")}`);
      if (!profile.settingsPath) throw new Error(`Картинки: ${where}модель ${modelId} не умеет выбирать качество`);
      fields.quality = settings.quality;
    }
    let sizes = profile.aspectRatios;
    let sizePriceUsd = profile.pricePerImageUsd;
    if (settings.size !== undefined && settings.size !== "default") {
      if (!imageSizes.includes(settings.size)) throw new Error(`Картинки: ${where}size — одно из ${imageSizes.join(", ")}`);
      const option = profile.sizes?.[settings.size];
      if (!option) throw new Error(`Картинки: ${where}модель ${modelId} не умеет размер ${settings.size}`);
      sizes = option.aspectRatios;
      sizePriceUsd = option.pricePerImageUsd ?? profile.pricePerImageUsd;
    }
    const qualityFactor = settings.quality !== undefined ? (profile.qualityPriceFactors?.[settings.quality] ?? 1) : 1;
    if (settings.transparentBackground) {
      if (!profile.transparentBackground || !profile.settingsPath) throw new Error(`Картинки: ${where}модель ${modelId} не умеет прозрачный фон`);
      fields.background = "transparent";
    }
    const providerSettings = profile.settingsPath && Object.keys(fields).length > 0 ? withSettings(profile.providerSettings, profile.settingsPath, fields) : profile.providerSettings;
    return {
      profile,
      provider,
      providerModelId: profile.providerModelIds[chosen]!,
      connection: connect(provider),
      sizes,
      priceUsd: roundUsd(sizePriceUsd * qualityFactor),
      ...(provider.baseURL !== undefined && { trustedOrigin: new URL(provider.baseURL).origin }),
      ...(choice.fetch && { downloadFetch: choice.fetch }),
      ...(providerSettings && { providerSettings }),
      ...(settings.transparentBackground && { outputFormat: "png" as const }),
    };
  }

  function setup(purpose: Omit<ImagePurpose, "description"> & { description?: string }, where: string, name?: string): ImageSetup {
    const quality = purpose.quality ?? choice.quality;
    const size = purpose.size ?? choice.size;
    const transparentBackground = purpose.transparentBackground ?? choice.transparentBackground;
    const output = purpose.output ?? choice.output;
    checkImageOutput(output, where);
    const base = step(purpose.model, purpose.provider, where, { ...(quality !== undefined && { quality }), ...(size !== undefined && { size }), ...(transparentBackground && { transparentBackground }) });
    if (base.profile.needsSourceImage) throw new Error(`Картинки: ${where}модель ${base.profile.id} правит готовую картинку — ей нужна исходная, она годится только для removeBackground`);
    const steps = [base];
    if (purpose.removeBackground) {
      const removal = step(purpose.removeBackground.model, purpose.removeBackground.provider, `${where}removeBackground: `);
      if (!removal.profile.needsSourceImage) throw new Error(`Картинки: ${where}removeBackground: модель ${removal.profile.id} не правит исходную картинку`);
      steps.push({ ...removal, prompt: purpose.removeBackground.prompt ?? DEFAULT_REMOVE_BACKGROUND_PROMPT });
    }
    if ((transparentBackground || purpose.removeBackground) && output?.format === "jpeg") throw new Error(`Картинки: ${where}прозрачный фон не сохранится в jpeg — выбери png или webp`);
    return {
      ...(name !== undefined && { purpose: name, description: purpose.description }),
      steps,
      ...(output && { output }),
      priceUsd: roundUsd(steps.reduce((total, item) => total + item.priceUsd, 0)),
    };
  }

  const byPurpose = new Map<string, ImageSetup>();
  if (choice.purposes === undefined) {
    byPurpose.set("", setup({ model: choice.model ?? DEFAULT_MODEL, ...(choice.provider !== undefined && { provider: choice.provider }) }, ""));
  } else {
    if (choice.model !== undefined || choice.provider !== undefined) throw new Error("Картинки: purposes задают модель каждому назначению — model и provider рядом с ними не нужны");
    const entries = Object.entries(choice.purposes);
    if (entries.length === 0) throw new Error("Картинки: purposes пуст — нужно хотя бы одно назначение");
    for (const [name, purpose] of entries) {
      if (!/^[a-z][a-z0-9_-]{0,39}$/.test(name)) throw new Error(`Картинки: имя назначения «${name}» — латиница, цифры, «-» и «_», до 40 знаков`);
      if (!purpose.description?.trim()) throw new Error(`Картинки: у назначения ${name} пустое описание для агента`);
      byPurpose.set(name, setup(purpose, `назначение ${name}: `, name));
    }
  }

  const all = [...connections.values()];
  return {
    byPurpose,
    hasPurposes: choice.purposes !== undefined,
    hideSecrets: (text) => all.reduce((result, connection) => hideSecrets(result, connection), text),
  };
}
