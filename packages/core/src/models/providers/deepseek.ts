import { createDeepSeek } from "@ai-sdk/deepseek";
import type { ProviderConnection, ProviderDescription, ReasoningRequest } from "../model-catalog";
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
    // Direct Chat Completions: thinking отдельно от reasoning_effort (официальные docs, 24.10.2026).
    // Старые off/on сохраняют прежние байты; выбор силы включается профилем приложения.
    reasoningRequest: (level): ReasoningRequest => {
      if (level === "off") return { providerOptions: { deepseek: { thinking: { type: "disabled" } } } };
      if (level === "on") return { providerOptions: { deepseek: { thinking: { type: "enabled" } } } };
      const effort = level === "minimal" ? "low" : level === "medium" ? "high" : level;
      if (effort === "low" || effort === "high" || effort === "max") {
        return { providerOptions: { deepseek: { thinking: { type: "enabled" }, reasoningEffort: effort } } };
      }
      throw new Error(`DeepSeek: неизвестный уровень рассуждений «${level}»`);
    },
    // Обрезки хвоста (`min_p`) в API DeepSeek нет (api-docs.deepseek.com: только temperature и top_p), а пакет провайдера
    // незнакомые поля не шлёт: `samplingRequest` нет, `sampling.minP` модели сюда не уходит.
    // Кончившиеся деньги DeepSeek описывает телом ответа; код бывает не только 402.
    errorHints: [{ match: /insufficient balance/i, kind: "insufficient_funds" }],
    toolResultImages: true,
    ...connectionField(connection),
    ...silenceField("DeepSeek", connectionOptions),
    ...hiddenField("DeepSeek", connectionOptions),
  }, (next) => createDeepSeekProvider(next));
}

export const deepseekProvider: ProviderDescription = createDeepSeekProvider();
