import { createTogetherAI } from "@ai-sdk/togetherai";
import type { ProviderConnection, ProviderDescription, ProviderOptionsByProvider } from "../model-catalog";
import { checkedConnection, connectable, connectionField, hiddenField, silenceField } from "./provider-connection";
import { sdkReasoningRequest } from "./sdk-reasoning";

/**
 * Together AI (`api.together.xyz`), совместим с OpenAI.
 * - Рассуждения приходят полем `reasoning_content` (и в потоке, и целым ответом); пакет провайдера
 *   читает его как рассуждение и возвращает модели в том же поле.
 * - Уровень рассуждения не задаётся: у модели один режим по умолчанию.
 *   Выключить рассуждения можно полем `reasoning: { enabled: false }`; ядро этого не делает.
 * - Кэш начала запроса Together ведёт сам, ключа кэша и привязки к сессии у него нет.
 *   Кэшируется неизменный префикс, поэтому инструкция и инструменты идут первыми.
 *   Прочитанное из кэша приходит в `usage.prompt_tokens_details.cached_tokens`.
 * - Модели «только для выделенного сервера» (в каталоге у них нулевая цена) по обычному ключу не вызываются.
 * - Обрезку хвоста (`sampling.minP` модели) принимает полем `min_p`; пакет провайдера читает опции под ключом
 *   `togetherai` и кладёт незнакомые поля в тело запроса.
 * - Через прокси (`baseURL`, `headers`) идут все запросы провайдера.
 */
export function createTogetherProvider(connectionOptions: ProviderConnection = {}): ProviderDescription {
  const connection = checkedConnection("Together AI", connectionOptions);
  return connectable({
    id: "together",
    displayName: "Together AI",
    apiKeyEnv: "TOGETHER_API_KEY",
    createLanguageModel: (providerModelId, apiKey, options) =>
      createTogetherAI({ apiKey, fetch: options?.fetch, ...connection })(providerModelId),
    reasoningRequest: (level) => sdkReasoningRequest(level),
    samplingRequest: ({ minP }): ProviderOptionsByProvider => (minP === undefined ? {} : { togetherai: { min_p: minP } }),
    requestOptions: () => ({}),
    ...connectionField(connection),
    ...silenceField("Together AI", connectionOptions),
    ...hiddenField("Together AI", connectionOptions),
  }, (next) => createTogetherProvider(next));
}

export const togetherProvider: ProviderDescription = createTogetherProvider();
