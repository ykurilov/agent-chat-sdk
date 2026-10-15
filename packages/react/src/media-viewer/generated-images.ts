import { getToolName, isToolUIPart } from "ai";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import type { ImagesClient } from "../agent-chat-extensions";
import type { AgentChatMessage } from "../chat-types";
import type { GeneratedImagesView } from "../skin-contract";
import type { MediaViewerItem } from "./media-viewer-types";

/** Вид картинок агента для части ответа; `undefined` — это не вызов картинок, он остаётся строкой инструмента. */
export type DescribeGeneratedImages = (part: ToolUIPart | DynamicToolUIPart) => GeneratedImagesView | undefined;

const noOpen = () => undefined;

/** `images` страницы — всегда списком: один клиент или несколько. */
export const imageClientsOf = (images: ImagesClient | readonly ImagesClient[] | undefined): readonly ImagesClient[] =>
  images === undefined ? [] : Array.isArray(images) ? images : [images as ImagesClient];

/**
 * Картинки агента (`images` страницы): вызов инструмента одного из клиентов → вид для скина; клиент выбирается по имени
 * инструмента. Нет `open` (у скина нет окна просмотра) — клик по картинке ничего не делает.
 */
export function describeGeneratedImages(
  images: ImagesClient | readonly ImagesClient[],
  call: { api: string; chatId: string; open?: ((key: string, trigger: HTMLElement) => void) | undefined },
): DescribeGeneratedImages {
  const openImage = call.open ?? noOpen;
  const byTool = new Map(imageClientsOf(images).map((client) => [client.toolName, client]));
  return (part) => byTool.get(getToolName(part))?.describe({ part, api: call.api, chatId: call.chatId, openImage });
}

/** Готовые картинки агента в сообщении — элементы карусели окна просмотра, по порядку частей. */
export function generatedViewerItems(describe: DescribeGeneratedImages): (message: AgentChatMessage) => MediaViewerItem[] {
  return (message) => {
    if (message.role !== "assistant") return [];
    return message.parts.flatMap((part) =>
      isToolUIPart(part)
        ? (describe(part)?.items ?? []).flatMap((item): MediaViewerItem[] =>
            item.state === "ready"
              ? [
                  {
                    kind: "image",
                    key: item.key,
                    src: item.src,
                    alt: item.alt,
                    ...(item.width !== undefined && { width: item.width }),
                    ...(item.height !== undefined && { height: item.height }),
                  },
                ]
              : [],
          )
        : [],
    );
  };
}
