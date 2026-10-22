import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@tandem/ui";
import type { MemorySkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";

type MemoryConfirmProps = ComponentProps<MemorySkin["MemoryConfirm"]>;

/** Подтверждение удаления записи или стирания всей памяти. Escape и закрытие окна — отмена. */
export function OduvanchikMemoryConfirm({ target, pending, error, onConfirm, onCancel }: MemoryConfirmProps) {
  const labels = useChatLabels();
  const single = target.kind === "note";
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{single ? labels.memoryDeleteTitle : labels.memoryClearTitle}</DialogTitle>
          <DialogDescription className="break-words">
            {target.kind === "note" ? labels.memoryDeleteBody(target.content) : labels.memoryClearBody(target.total)}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="break-words px-1 text-sm text-[var(--destructive-text)]">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            {labels.memoryConfirmCancel}
          </Button>
          <Button variant="destructive" loading={pending} disabled={pending} onClick={onConfirm}>
            {single ? labels.memoryConfirmDelete : labels.memoryConfirmClear}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
