import { getToolName, isToolUIPart } from "ai";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import type { ImagesClient } from "../agent-chat-extensions";
import type { AgentChatMessage } from "../chat-types";
import type { GeneratedImagesView } from "../skin-contract";
import type { MediaViewerItem } from "./media-viewer-types";

/** Вид картинок агента для части ответа; `undefined` — это не вызов картинок, он остаётся строкой инструмента. */
export type DescribeGeneratedImages = (part: ToolUIPart | DynamicToolUIPart) => GeneratedImagesView | undefined;

const noOpen = () => undefined;

/**
 * Картинки агента (`images` страницы): вызов `images.toolName` → вид для скина. Нет `open` (у скина нет окна
 * просмотра) — клик по картинке ничего не делает.
 */
export function describeGeneratedImages(
  images: ImagesClient,
  call: { api: string; chatId: string; open?: ((key: string, trigger: HTMLElement) => void) | undefined },
): DescribeGeneratedImages {
  const openImage = call.open ?? noOpen;
  return (part) => (getToolName(part) === images.toolName ? images.describe({ part, api: call.api, chatId: call.chatId, openImage }) : undefined);
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
