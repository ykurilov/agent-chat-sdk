import { Button } from "@tandem/ui";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { useEffect, useRef } from "react";
import type { ComponentProps } from "react";
import { OduvanchikMessageAttachments } from "./message-attachments";

/** Правка отправленного сообщения на месте пузыря: Enter отправляет, Shift+Enter — новая строка, Esc отменяет. */
export function OduvanchikMessageEditor({ value, onValueChange, onSave, onCancel, canSave, error, attachments }: ComponentProps<ChatSkin["MessageEditor"]>) {
  const labels = useChatLabels();
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const field = fieldRef.current;
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }, []);

  return (
    <div className="flex flex-col items-end gap-2 pb-6">
      {attachments && <OduvanchikMessageAttachments attachments={attachments} />}
      <div className="oduvanchik-message-editor ml-auto w-full max-w-[75%] rounded-[18px] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-2 shadow-[var(--shadow-xs)]">
        <textarea
          ref={fieldRef}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSave) onSave();
            }
          }}
          aria-label={labels.editMessage}
          rows={1}
          className="block max-h-60 min-h-10 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-6 text-[var(--foreground)] outline-none [field-sizing:content]"
        />
        {error && (
          <p role="alert" className="px-2 pt-1 text-sm text-[var(--destructive-text)]">
            {error}
          </p>
        )}
        <div className="mt-1 flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {labels.cancelEdit}
          </Button>
          <Button size="sm" disabled={!canSave} onClick={onSave}>
            {labels.saveEdit}
          </Button>
        </div>
      </div>
    </div>
  );
}
