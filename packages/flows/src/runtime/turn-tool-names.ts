import type { AgentToolsModel, AgentToolsSource, ContextBlocksInput, ModelCatalog } from "@ykurilov/agent-chat-core";

/**
 * Имена инструментов приложения у модели хода: тот же набор, что ядро соберёт для запроса. Набор зависит от модели и
 * провайдера, а не от хода (например, `person_link_view` выдаётся не всем моделям) — текст по нему стабилен, кэш цел.
 * Сборка набора — без побочных действий (так же её зовёт ядро на каждой попытке). Модели нет в каталоге, каталога нет
 * или сборка бросила — `undefined`: набор неизвестен.
 */
export function turnToolNames(source: AgentToolsSource | undefined, catalog: ModelCatalog | undefined, input: ContextBlocksInput): ReadonlySet<string> | undefined {
  if (!source) return new Set();
  if (typeof source !== "function") return new Set(Object.keys(source));
  const profile = catalog?.models.find((model) => model.id === input.modelId);
  if (!profile) return undefined;
  const values = input.state ?? {};
  const model: AgentToolsModel = {
    profile,
    providerId: input.providerId,
    chatId: input.chatId,
    ownerId: input.ownerId,
    place: null,
    turnId: input.messageId,
    messageId: input.messageId,
    channel: input.channel,
    audience: input.audience,
    notifyDataChanged: () => {},
    chat: input.chat,
    ...(input.subject && { subject: input.subject }),
    ...(input.staff && { staff: input.staff }),
    ...(input.viewer && { viewer: input.viewer }),
    state: { get: (path?: string) => (path === undefined ? values : values[path]), set: () => {}, unset: () => {} },
  } as AgentToolsModel;
  try {
    return new Set(Object.keys(source(model)));
  } catch {
    return undefined;
  }
}
