import { effectiveReasoningLevel } from "./reasoning-level";
import { modelAcceptsImages } from "./model-catalog";
import type { ModelCatalog, ReasoningLevelId } from "./model-catalog";

type Env = Record<string, string | undefined>;

/** Выбор собеседника: модель, провайдер и уровень рассуждений (если у модели есть уровни). */
export interface ModelChoice {
  modelId: string;
  providerId: string;
  reasoning?: string;
}

export interface ModelMenu {
  providers: Array<{
    id: string;
    displayName: string;
    models: Array<{
      id: string;
      displayName: string;
      /** Видит ли модель картинки у этого провайдера: от этого зависит, дойдёт ли прикреплённая картинка. */
      acceptsImages: boolean;
      reasoning: { levels: ReasoningLevelId[]; defaultLevel: ReasoningLevelId | null };
    }>;
  }>;
  defaultChoice: {
    modelId: string;
    providerId: string;
    reasoning: string | null;
    /**
     * Только когда выбор по умолчанию у скрытого провайдера (`hiddenFromMenu`): его нет в `providers`, и экрану
     * нужны названия и уровни, чтобы показать текущую модель.
     */
    details?: {
      providerName: string;
      modelName: string;
      acceptsImages: boolean;
      reasoning: { levels: ReasoningLevelId[]; defaultLevel: ReasoningLevelId | null };
    };
  };
}

/** Выбор не подходит: модели или провайдера нет, провайдер её не даёт, нет ключа или уровня. */
export class InvalidModelChoiceError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidModelChoiceError";
  }
}

/** Проверяет выбор; уровень, которого нет в запросе, становится уровнем по умолчанию модели. */
export function validateModelChoice(
  catalog: ModelCatalog,
  env: Env,
  choice: ModelChoice,
  { requireKey = true, allowHidden = false }: { requireKey?: boolean; allowHidden?: boolean } = {},
): ModelChoice {
  const profile = catalog.models.find((model) => model.id === choice.modelId);
  if (!profile) throw new InvalidModelChoiceError(`Модели «${choice.modelId}» нет в каталоге`);
  const provider = catalog.providers.find((candidate) => candidate.id === choice.providerId);
  // Скрытый из меню провайдер человеку недоступен — отказ как на неизвестного. Выбор приложения (allowHidden) его видит.
  if (!provider || (provider.hiddenFromMenu && !allowHidden)) throw new InvalidModelChoiceError(`Провайдера «${choice.providerId}» нет в каталоге`);
  if (!profile.providerModelIds[provider.id]) {
    throw new InvalidModelChoiceError(`Провайдер «${provider.id}» не обслуживает модель «${profile.id}»`);
  }
  if (requireKey && !env[provider.apiKeyEnv]) throw new InvalidModelChoiceError(`У провайдера «${provider.id}» нет ключа на сервере`);

  const levels = profile.reasoning.levels ?? [];
  if (levels.length === 0) {
    if (choice.reasoning !== undefined) throw new InvalidModelChoiceError(`У модели «${profile.id}» нет уровней рассуждений`);
    return { modelId: profile.id, providerId: provider.id };
  }
  if (choice.reasoning !== undefined && !levels.some((level) => level === choice.reasoning)) {
    throw new InvalidModelChoiceError(`У модели «${profile.id}» нет уровня «${choice.reasoning}»`);
  }
  return { modelId: profile.id, providerId: provider.id, reasoning: effectiveReasoningLevel(profile, choice.reasoning)! };
}

/**
 * Заданный приложением выбор; иначе или если его нет в каталоге — первая модель у первого провайдера с ключом.
 * Нет ключа у заданного выбора — не повод его менять: это ошибка настройки сервера, она скажется при ответе.
 */
export function resolveDefaultChoice(
  catalog: ModelCatalog,
  env: Env,
  configured: ModelChoice | undefined,
  logError: (message: string) => void,
): ModelChoice {
  if (configured) {
    try {
      return validateModelChoice(catalog, env, configured, { requireKey: false, allowHidden: true });
    } catch (error) {
      logError(
        `Выбор модели по умолчанию «${configured.modelId}» у «${configured.providerId}» не подходит: ${(error as Error).message}. Взята первая доступная модель.`,
      );
    }
  }
  return firstAvailableChoice(catalog, env);
}

function firstAvailableChoice(catalog: ModelCatalog, env: Env): ModelChoice {
  // Видимые провайдеры раньше скрытых: скрытый берётся, только если больше взять нечего.
  const providers = [...catalog.providers.filter((provider) => !provider.hiddenFromMenu), ...catalog.providers.filter((provider) => provider.hiddenFromMenu)];
  for (const model of catalog.models) {
    for (const provider of providers) {
      if (!model.providerModelIds[provider.id] || !env[provider.apiKeyEnv]) continue;
      return validateModelChoice(catalog, env, { modelId: model.id, providerId: provider.id }, { allowHidden: true });
    }
  }
  // Ключей нет нигде: чат создаётся, ошибка про ключ придёт при ответе.
  for (const model of catalog.models) {
    const provider = providers.find((candidate) => model.providerModelIds[candidate.id]);
    if (!provider) continue;
    const level = effectiveReasoningLevel(model);
    return { modelId: model.id, providerId: provider.id, ...(level && { reasoning: level }) };
  }
  throw new Error("В каталоге нет ни одной модели с провайдером");
}

/** Выбор, на котором пойдёт ответ: сохранённый в чате, если доступен, иначе замена. История не меняется. */
export function effectiveChoiceOfChat(
  catalog: ModelCatalog,
  env: Env,
  chat: { modelId: string; providerId: string; reasoning?: string | null },
  fallback: ModelChoice,
): ModelChoice {
  const saved = { modelId: chat.modelId, providerId: chat.providerId };
  try {
    return validateModelChoice(catalog, env, { ...saved, ...(chat.reasoning && { reasoning: chat.reasoning }) });
  } catch {
    // Уровень могли убрать из профиля: тогда та же модель на уровне по умолчанию.
  }
  try {
    return validateModelChoice(catalog, env, saved);
  } catch {
    return fallback;
  }
}

/** Список для меню: без скрытых провайдеров, ключей, имён переменных окружения и адресов. */
export function buildModelMenu(catalog: ModelCatalog, env: Env, defaultChoice: ModelChoice): ModelMenu {
  const providers = catalog.providers
    .filter((provider) => env[provider.apiKeyEnv] && !provider.hiddenFromMenu)
    .map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      models: catalog.models
        .filter((model) => model.providerModelIds[provider.id])
        .map((model) => ({
          id: model.id,
          displayName: model.displayName,
          acceptsImages: modelAcceptsImages(model, provider.id),
          reasoning: {
            levels: [...(model.reasoning.levels ?? [])],
            defaultLevel: effectiveReasoningLevel(model),
          },
        })),
    }))
    .filter((provider) => provider.models.length > 0);
  return {
    providers,
    defaultChoice: {
      modelId: defaultChoice.modelId,
      providerId: defaultChoice.providerId,
      reasoning: defaultChoice.reasoning ?? null,
      ...hiddenDefaultDetails(catalog, defaultChoice),
    },
  };
}

function hiddenDefaultDetails(catalog: ModelCatalog, choice: ModelChoice): Pick<ModelMenu["defaultChoice"], "details"> {
  const provider = catalog.providers.find((candidate) => candidate.id === choice.providerId);
  const model = catalog.models.find((candidate) => candidate.id === choice.modelId);
  if (!provider?.hiddenFromMenu || !model) return {};
  return {
    details: {
      providerName: provider.displayName,
      modelName: model.displayName,
      acceptsImages: modelAcceptsImages(model, provider.id),
      reasoning: { levels: [...(model.reasoning.levels ?? [])], defaultLevel: effectiveReasoningLevel(model) },
    },
  };
}

/** Выбор скрытого провайдера (`hiddenFromMenu`): человеку и переносимым чатам он недоступен, чат идёт на выборе по умолчанию. */
export function isHiddenChoice(catalog: ModelCatalog, choice: ModelChoice): boolean {
  return catalog.providers.some((provider) => provider.id === choice.providerId && provider.hiddenFromMenu === true);
}
