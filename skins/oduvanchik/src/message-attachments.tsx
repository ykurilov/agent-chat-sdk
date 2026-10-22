import type { MessageAttachmentItem, MessageAttachmentsView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { FileText } from "./icons";

const attachmentBorder = "rounded-[var(--radius-nested)] border border-[var(--border)]";

function AttachmentThumbnail({ item }: { item: MessageAttachmentItem }) {
  const labels = useChatLabels();
  // Есть окно просмотра (версия 13): миниатюра открывает картинку во весь экран, а не новую вкладку.
  if (item.onOpen) {
    const open = item.onOpen;
    return (
      <button
        type="button"
        aria-label={`${labels.images.open}: ${item.name}`}
        onClick={(event) => open(event.currentTarget)}
        className={`tandem-focus block cursor-zoom-in overflow-hidden ${attachmentBorder}`}
      >
        <img src={item.url} alt="" loading="lazy" className="h-24 max-w-48 object-cover" />
      </button>
    );
  }
  return (
    <a href={item.url} target="_blank" rel="noreferrer" className={`tandem-focus block overflow-hidden ${attachmentBorder}`}>
      <img src={item.url} alt={item.name} loading="lazy" className="h-24 max-w-48 object-cover" />
    </a>
  );
}

function AttachmentFile({ item }: { item: MessageAttachmentItem }) {
  return (
    <a
      href={item.url}
      download={item.name}
      className={`tandem-focus flex h-14 max-w-60 items-center gap-2.5 bg-[var(--surface)] pl-2 pr-3 text-[var(--foreground)] ${attachmentBorder}`}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-small)] bg-[var(--cool-soft)] text-[var(--cool-text)]">
        <FileText className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">{item.name}</span>
        {item.caption && <span className="block text-[11px] text-[var(--foreground-subtle)]">{item.caption}</span>}
      </span>
    </a>
  );
}

/** Файлы сообщения справа: миниатюры картинок и плашки. Общий вид для ленты и для правки. */
export function OduvanchikMessageAttachments({ attachments }: { attachments: MessageAttachmentsView }) {
  return (
    <ul aria-label={attachments.label} className="flex max-w-[75%] flex-wrap justify-end gap-2">
      {attachments.items.map((item) => (
        <li key={item.id}>{item.kind === "image" ? <AttachmentThumbnail item={item} /> : <AttachmentFile item={item} />}</li>
      ))}
    </ul>
  );
}
