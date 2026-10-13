import type { MessageAttachmentItem, MessageAttachmentsView } from "../attachments-contract";
import type { AgentChatMessage } from "../chat-types";
import type { GeneratedImagesView } from "../skin-contract";

const noOpen = () => {};

/** Размеров картинки вложения клиент не знает: заглушка держит квадрат, готовая картинка — свои пропорции. */
const UNKNOWN_ASPECT_RATIO = "1:1";

/** Как показать часть `file` ответа агента: группой картинок или строкой со ссылкой на файл (текст ответа). */
export type AnswerFileView = { kind: "images"; view: GeneratedImagesView } | { kind: "file"; markdown: string };

/**
 * Файлы в ответе агента (импорт переписки). Часть узнаётся по адресу (`MessageAttachmentItem.partUrl`), не по порядку.
 * С `withImages` подряд идущие картинки — одна группа `GeneratedImages` на месте первой; ключ — номер части, `null` —
 * часть уже в группе выше. Остальное (не картинка, неизвестная плагину часть, скин без `GeneratedImages`) — строкой
 * «📎 имя» со ссылкой, если адрес известен: файл не пропадает молча.
 */
export function answerFileViews(
  message: AgentChatMessage,
  describe: ((message: AgentChatMessage) => MessageAttachmentsView | undefined) | undefined,
  withImages: boolean,
): Map<number, AnswerFileView | null> {
  const views = new Map<number, AnswerFileView | null>();
  if (!message.parts.some((part) => part.type === "file")) return views;
  const byPartUrl = new Map<string, MessageAttachmentItem>();
  for (const item of describe?.(message)?.items ?? []) if (item.partUrl !== undefined) byPartUrl.set(item.partUrl, item);
  let open: GeneratedImagesView | null = null;
  message.parts.forEach((part, index) => {
    if (part.type !== "file") {
      open = null;
      return;
    }
    const file = byPartUrl.get(part.url);
    if (!withImages || file?.kind !== "image") {
      open = null;
      const name = file?.name ?? part.filename ?? part.mediaType;
      views.set(index, { kind: "file", markdown: file ? `📎 [${escapeLinkText(name)}](<${file.url}>)` : `📎 ${name}` });
      return;
    }
    const item = { state: "ready" as const, key: file.id, src: file.url, alt: file.name, onOpen: file.onOpen ?? noOpen };
    if (open) {
      open.items.push(item);
      open.ordered++;
      views.set(index, null);
    } else {
      open = { ordered: 1, aspectRatio: UNKNOWN_ASPECT_RATIO, items: [item], stopped: false };
      views.set(index, { kind: "images", view: open });
    }
  });
  return views;
}

function escapeLinkText(text: string): string {
  return text.replace(/[\\[\]]/g, (char) => `\\${char}`);
}
