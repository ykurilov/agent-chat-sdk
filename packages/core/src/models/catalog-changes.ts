import { createModelCatalog } from "./model-catalog";
import type { ModelCatalog, ModelProfile, ProviderConnection, ProviderDescription } from "./model-catalog";
import { silenceField } from "./providers/provider-connection";

export interface CatalogChange {
  /** Модели уходят у всех провайдеров. Порядок правок: убрать → добавить → закрепить. */
  removeModels?: string[];
  /** Провайдер уходит из каталога; модель, которую больше никто не обслуживает, уходит вместе с ним. */
  removeProviders?: string[];
  addModels?: ModelProfile[];
  addProviders?: ProviderDescription[];
  /** Закрепление версии: `{ модель: { провайдер: "id модели у провайдера" } }`. */
  pinModelVersions?: Record<string, Record<string, string>>;
  /**
   * Провайдеры через прокси: `{ openrouter: { baseURL, headers: { "X-Proxy-Token": … } } }`. Провайдер остаётся на своём
   * месте и с прежними настройками, меняется только подключение. Применяется после `addProviders`.
   */
  connectProviders?: Record<string, ProviderConnection>;
}

/** Каталог с правками приложения; исходный каталог не меняется. Несогласованная правка — ошибка настройки. */
export function extendCatalog(base: ModelCatalog, change: CatalogChange): ModelCatalog {
  const withoutProviders = removeProviders(base, change.removeProviders ?? []);
  const removedModels = new Set(change.removeModels ?? []);
  const addedModels = change.addModels ?? [];
  const addedModelIds = new Set(addedModels.map((model) => model.id));
  const addedProviders = change.addProviders ?? [];
  // Провайдер, собранный вручную, мимо фабрики: срок молчания проверяется так же, как в фабриках.
  for (const provider of addedProviders) silenceField(provider.id, { modelSilenceTimeout: provider.modelSilenceTimeout });
  const addedProviderIds = new Set(addedProviders.map((provider) => provider.id));
  const extended = {
    models: [
      ...withoutProviders.models.filter((model) => !removedModels.has(model.id) && !addedModelIds.has(model.id)),
      ...addedModels,
    ],
    providers: connectProviders(
      [...withoutProviders.providers.filter((provider) => !addedProviderIds.has(provider.id)), ...addedProviders],
      change.connectProviders ?? {},
    ),
  };
  return createModelCatalog(pinVersions(extended, change.pinModelVersions ?? {}));
}

function connectProviders(providers: ProviderDescription[], connections: Record<string, ProviderConnection>): ProviderDescription[] {
  for (const providerId of Object.keys(connections)) {
    const provider = providers.find((candidate) => candidate.id === providerId);
    if (!provider) throw new Error(`Подключить через прокси нечего: провайдера «${providerId}» нет в каталоге`);
    if (!provider.connect) throw new Error(`Провайдер «${providerId}» не умеет подключаться через прокси: соберите его сами со своим адресом`);
  }
  return providers.map((provider) => {
    const connection = connections[provider.id];
    // Срок молчания и скрытость заданы при создании провайдера, а не прокси: новое подключение их не теряет.
    const kept = {
      ...(provider.modelSilenceTimeout !== undefined && { modelSilenceTimeout: provider.modelSilenceTimeout }),
      ...(provider.hiddenFromMenu && { hiddenFromMenu: true }),
    };
    return connection ? provider.connect!({ ...kept, ...connection }) : provider;
  });
}

function removeProviders(catalog: ModelCatalog, providerIds: string[]): ModelCatalog {
  for (const providerId of providerIds) {
    if (!catalog.providers.some((provider) => provider.id === providerId)) {
      throw new Error(`Убрать нечего: провайдера «${providerId}» нет в каталоге`);
    }
  }
  const removed = new Set(providerIds);
  return {
    providers: catalog.providers.filter((provider) => !removed.has(provider.id)),
    models: catalog.models
      .map((model) => ({
        ...model,
        providerModelIds: withoutRemoved(model.providerModelIds, removed),
        ...(model.pricing ? { pricing: withoutRemoved(model.pricing, removed) } : {}),
        ...(model.acceptsImagesByProvider ? { acceptsImagesByProvider: withoutRemoved(model.acceptsImagesByProvider, removed) } : {}),
      }))
      .filter((model) => Object.keys(model.providerModelIds).length > 0),
  };
}

function withoutRemoved<Value>(byProvider: Record<string, Value>, removed: Set<string>): Record<string, Value> {
  return Object.fromEntries(Object.entries(byProvider).filter(([providerId]) => !removed.has(providerId)));
}

function pinVersions(catalog: ModelCatalog, pins: Record<string, Record<string, string>>): ModelCatalog {
  for (const [modelId, byProvider] of Object.entries(pins)) {
    const model = catalog.models.find((candidate) => candidate.id === modelId);
    if (!model) throw new Error(`Закрепить нечего: модели «${modelId}» нет в каталоге`);
    for (const [providerId, providerModelId] of Object.entries(byProvider)) {
      const provider = catalog.providers.find((candidate) => candidate.id === providerId);
      if (!provider) {
        throw new Error(`Нельзя закрепить версию модели «${modelId}»: провайдера «${providerId}» нет в каталоге`);
      }
      const routeSource = provider.servesModelsOf;
      if (!model.providerModelIds[providerId] && !(routeSource !== undefined && model.providerModelIds[routeSource])) {
        throw new Error(`Нельзя закрепить версию модели «${modelId}»: провайдер «${providerId}» её не обслуживает`);
      }
      if (!providerModelId.trim()) throw new Error(`Закреплённый id модели «${modelId}» у провайдера «${providerId}» пуст`);
    }
  }
  return {
    providers: catalog.providers,
    models: catalog.models.map((model) => {
      const byProvider = pins[model.id];
      return byProvider ? { ...model, providerModelIds: { ...model.providerModelIds, ...inheritedPins(model, byProvider, catalog.providers), ...byProvider } } : model;
    }),
  };
}

/** Закреплённая версия провайдера переходит на его маршруты (`servesModelsOf`), если у маршрута не своя запись модели. */
function inheritedPins(model: ModelProfile, byProvider: Record<string, string>, providers: ProviderDescription[]): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const route of providers) {
    const source = route.servesModelsOf;
    if (source === undefined || !(source in byProvider)) continue;
    const current = model.providerModelIds[route.id];
    if (current === undefined || current === model.providerModelIds[source]) inherited[route.id] = byProvider[source]!;
  }
  return inherited;
}
