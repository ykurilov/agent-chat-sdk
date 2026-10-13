import { Alert, Button } from "@tandem/ui";
import type { SandboxSkin } from "@ykurilov/agent-chat-sandbox/react";
import { useChatReopenLabels } from "@ykurilov/agent-chat-sandbox/react";
import { LockOpen } from "lucide-react";
import type { ComponentProps } from "react";

/** «Открыть чат снова» под инструкцией: чат закрыт инструментом, админ продолжает проверку. */
export function TandemChatReopen({ onReopen, pending, error }: ComponentProps<NonNullable<SandboxSkin["ChatReopen"]>>) {
  const labels = useChatReopenLabels();
  return (
    <div className="mt-1.5 flex flex-col items-start gap-1.5">
      <Button variant="secondary" size="sm" onClick={onReopen} disabled={pending} className="h-9 gap-1.5 [&_svg]:size-4">
        <LockOpen aria-hidden="true" />
        {pending ? labels.reopening : labels.reopen}
      </Button>
      {error && <Alert role="alert" variant="warm" title={error} className="w-full" />}
    </div>
  );
}
