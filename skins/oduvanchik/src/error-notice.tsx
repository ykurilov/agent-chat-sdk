import { Alert, Button } from "@tandem/ui";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { RotateCcw } from "./icons";
import type { ComponentProps } from "react";

/** Понятная ошибка ответа: тёплое предупреждение с действием «повторить». Текст отказа сервера — вместо общей надписи. */
export function OduvanchikErrorNotice({ kind, text, onRetry }: ComponentProps<ChatSkin["ErrorNotice"]>) {
  const labels = useChatLabels();
  return (
    <Alert
      variant="warm"
      title={text ?? labels.errors[kind]}
      data-error-kind={kind}
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
