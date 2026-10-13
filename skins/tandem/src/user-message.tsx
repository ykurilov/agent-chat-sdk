import { AgentMessage, Button, Tooltip } from "@tandem/ui";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Pencil } from "lucide-react";
import type { ComponentProps } from "react";
import { TandemMessageAttachments } from "./message-attachments";

/**
 * Реплика собеседника. Поправка, которую агент ещё не взял (`pending`), — с пометкой под пузырём. Вложения стоят над текстом справа: миниатюры картинок и плашки файлов.
 * Под пузырём строка с переключателем веток и карандашом: она занимает прежний промежуток до следующего сообщения (24 px),
 * поэтому высота сообщения не меняется и лента не подпрыгивает, когда правка недоступна.
 */
export function TandemUserMessage({ text, attachments, branchSwitcher, onEdit, pending }: ComponentProps<ChatSkin["UserMessage"]>) {
  const labels = useChatLabels();
  return (
    <div className="flex flex-col items-end">
      <div className="flex w-full flex-col items-end gap-2">
        {attachments && <TandemMessageAttachments attachments={attachments} />}
        {(!attachments || text.trim().length > 0) && (
          <div data-user-text="" className="flex w-full flex-col items-end">
            <AgentMessage side="user" className="whitespace-pre-line">
              {text}
            </AgentMessage>
          </div>
        )}
      </div>
      <div className="flex h-6 items-center">
        {pending && (
          <span data-steering-pending="" className="text-xs text-[var(--foreground-subtle)]">
            {labels.steeringPending}
          </span>
        )}
        {branchSwitcher}
        {onEdit && (
          <Tooltip label={labels.editMessage} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              aria-label={labels.editMessage}
              onClick={onEdit}
              className="size-6 rounded-[var(--radius-small)] text-[var(--foreground-subtle)] [&_svg]:size-3.5"
            >
              <Pencil />
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
