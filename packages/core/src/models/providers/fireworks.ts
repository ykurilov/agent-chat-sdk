import { createFireworks } from "@ai-sdk/fireworks";
import type { ProviderConnection, ProviderDescription } from "../model-catalog";
import { checkedConnection, connectable, connectionField, hiddenField, silenceField } from "./provider-connection";
import { sdkReasoningRequest } from "./sdk-reasoning";
import { withToolResultImages } from "./tool-result-images";
import { sessionHeaderValue } from "./session-header";

/** Fireworks напрямую или через прокси (`baseURL`, `headers`): все запросы провайдера идут по этому подключению. */
export function createFireworksProvider(connectionOptions: ProviderConnection = {}): ProviderDescription {
  const connection = checkedConnection("Fireworks", connectionOptions);
  return connectable({
    id: "fireworks",
    displayName: "Fireworks",
    apiKeyEnv: "FIREWORKS_API_KEY",
    createLanguageModel: (providerModelId, apiKey, options) =>
      createFireworks({ apiKey, fetch: withToolResultImages(options?.fetch), ...connection })(providerModelId),
    reasoningRequest: (level) => sdkReasoningRequest(level),
    requestOptions: ({ chatId }) => ({
      providerOptions: {
        fireworks: { promptCacheKey: chatId, reasoningHistory: "preserved" },
      },
      headers: { "x-session-affinity": sessionHeaderValue(chatId) },
    }),
    toolResultImages: true,
    ...connectionField(connection),
    ...silenceField("Fireworks", connectionOptions),
    ...hiddenField("Fireworks", connectionOptions),
  }, (next) => createFireworksProvider(next));
}

export const fireworksProvider: ProviderDescription = createFireworksProvider();
