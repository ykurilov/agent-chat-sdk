import type { AgentToolsModel, AgentToolsSource } from "@ykurilov/agent-chat-core";
import { realOwnerOf } from "./sandbox-owner";

/**
 * Инструменты, чьи файлы и траты принадлежат песочному чату: картинка ложится во вложения песочного владельца
 * (её открывает только этот админ), расход — на него же, а не в боевой лимит.
 */
export const SANDBOX_CHAT_OWNED_TOOLS: readonly string[] = ["generate_images"];

/** Модель хода для инструментов приложения: настоящий id админа, чат — песочный. */
export function withRealOwner(model: AgentToolsModel): AgentToolsModel {
  return { ...model, ownerId: realOwnerOf(model.ownerId) };
}

/**
 * Инструменты приложения в песочнице: функция получает настоящий `ownerId` админа (в копии чата человека — id
 * человека, см. `toolsModel`), а инструменты из `chatOwned` — песочного владельца. Описания и схемы те же, поэтому
 * запрос к модели побайтно как у боевого чата. Набор-объект от владельца не зависит.
 */
export function sandboxTools(
  tools: AgentToolsSource | undefined,
  chatOwned: readonly string[] = SANDBOX_CHAT_OWNED_TOOLS,
  toolsModel: (model: AgentToolsModel) => AgentToolsModel = withRealOwner,
): AgentToolsSource | undefined {
  if (typeof tools !== "function") return tools;
  return (model) => {
    const real = tools(toolsModel(model));
    const owned = chatOwned.filter((name) => name in real);
    if (owned.length === 0) return real;
    const ofSandbox = tools(model);
    return { ...real, ...Object.fromEntries(owned.flatMap((name) => (ofSandbox[name] ? [[name, ofSandbox[name]]] : []))) };
  };
}
