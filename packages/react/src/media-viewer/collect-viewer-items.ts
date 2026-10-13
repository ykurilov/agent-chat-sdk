import type { MessageAttachmentsView } from "../attachments-contract";
import type { AgentChatMessage } from "../chat-types";
import type { MediaViewerItem } from "./media-viewer-types";

export interface CollectViewerItemsInput {
  /** Сообщения текущей ветки по порядку ленты. */
  messages: readonly AgentChatMessage[];
  /** `describe` плагина вложений; нет — у человека картинок нет. */
  describeAttachments?: ((message: AgentChatMessage) => MessageAttachmentsView | undefined) | undefined;
  /** Свои элементы сообщения (картинки агента): встают на место сообщения в ленте, после его вложений. */
  extraItems?: ((message: AgentChatMessage) => readonly MediaViewerItem[]) | undefined;
}

/**
 * Карусель окна просмотра: все картинки текущей ветки по порядку ленты. Одна картинка в нескольких сообщениях
 * (то же вложение) — один элемент на первом месте: `key` по ней возвращает фокус и должен быть единственным.
 */
export function collectViewerItems({ messages, describeAttachments, extraItems }: CollectViewerItemsInput): MediaViewerItem[] {
  const items: MediaViewerItem[] = [];
  const seen = new Set<string>();
  const add = (item: MediaViewerItem) => {
    if (seen.has(item.key)) return;
    seen.add(item.key);
    items.push(item);
  };
  for (const message of messages) {
    // Вложения и у человека, и в ответе агента (импорт переписки).
    if (describeAttachments) {
      for (const file of describeAttachments(message)?.items ?? []) {
        if (file.kind === "image") add({ kind: "image", key: file.id, src: file.url, alt: file.name });
      }
    }
    for (const item of extraItems?.(message) ?? []) add(item);
  }
  return items;
}
