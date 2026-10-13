import { createDeepSeek } from "@ai-sdk/deepseek";
import type { ProviderConnection, ProviderDescription } from "../model-catalog";
import { checkedConnection, connectable, connectionField, hiddenField, silenceField } from "./provider-connection";

/** DeepSeek напрямую или через прокси (`baseURL`, `headers`): все запросы провайдера идут по этому подключению. */
export function createDeepSeekProvider(connectionOptions: ProviderConnection = {}): ProviderDescription {
  const connection = checkedConnection("DeepSeek", connectionOptions);
  return connectable({
    id: "deepseek",
    displayName: "DeepSeek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    createLanguageModel: (providerModelId, apiKey, options) =>
      createDeepSeek({ apiKey, fetch: options?.fetch, ...connection })(providerModelId),
    // DeepSeek кэширует начало запроса сам.
    requestOptions: () => ({}),
    // Рассуждения у DeepSeek только включаются и выключаются полем `thinking`; силы у них нет.
    reasoningRequest: (level) => {
      if (level === "off") return { providerOptions: { deepseek: { thinking: { type: "disabled" } } } };
      if (level === "on") return { providerOptions: { deepseek: { thinking: { type: "enabled" } } } };
      throw new Error(`DeepSeek не задаёт силу рассуждений (уровень «${level}»), только «off» и «on»`);
    },
    // Кончившиеся деньги DeepSeek описывает телом ответа; код бывает не только 402.
    errorHints: [{ match: /insufficient balance/i, kind: "insufficient_funds" }],
    ...connectionField(connection),
    ...silenceField("DeepSeek", connectionOptions),
    ...hiddenField("DeepSeek", connectionOptions),
  }, (next) => createDeepSeekProvider(next));
}

export const deepseekProvider: ProviderDescription = createDeepSeekProvider();
