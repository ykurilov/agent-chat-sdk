import { Alert, Button } from "@tandem/ui";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { RotateCcw } from "./icons";
import type { ComponentProps } from "react";

/**
 * Состояние связи. «Переподключаемся…» — тихая строка со спокойной пульсацией, как у идущего
 * инструмента; «Нет связи с сервером» — тёплое предупреждение с действием «повторить».
 */
export function OduvanchikConnectionNotice({ state, onRetry }: ComponentProps<ChatSkin["ConnectionNotice"]>) {
  const labels = useChatLabels();
  if (state === "reconnecting") {
    return (
      <p
        role="status"
        data-connection-state="reconnecting"
        className="flex items-center gap-2 px-1 text-sm text-[var(--foreground-muted)]"
      >
        <span aria-hidden="true" className="size-1.5 shrink-0 animate-pulse rounded-full bg-current" />
        {labels.reconnecting}
      </p>
    );
  }
  return (
    <Alert
      variant="warm"
      title={labels.connectionLost}
      data-connection-state="offline"
      className="w-full"
      {...(onRetry && {
        action: (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            {labels.retry}
          </Button>
        ),
      })}
    />
  );
}
