import { Button } from "@tandem/ui";
import type { MemorySkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Pencil, Trash2 } from "lucide-react";
import type { ComponentProps } from "react";

type MemoryNoteRowProps = ComponentProps<MemorySkin["MemoryNoteRow"]>;

/** Запись памяти: текст (переносится по словам) и две кнопки-значка «Изменить» и «Удалить». */
export function TandemMemoryNoteRow({ content, onEdit, onDelete }: MemoryNoteRowProps) {
  const labels = useChatLabels();
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-[var(--radius-control)] px-3 py-1 transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-hover)]">
      <p className="min-w-0 flex-1 break-words py-2 text-sm leading-6 text-[var(--foreground)]">{content}</p>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon" aria-label={labels.memoryEditNote(content)} disabled={!onEdit} onClick={onEdit}>
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon" aria-label={labels.memoryDeleteNote(content)} disabled={!onDelete} onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}
