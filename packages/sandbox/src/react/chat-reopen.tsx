import { useState } from "react";
import type { SandboxClient } from "./sandbox-client";
import { useChatReopenLabels } from "./sandbox-labels";
import type { SandboxSkin } from "./sandbox-skin";

/** «Открыть чат снова» у закрытого чата песочницы: запрос на сервер, а что показать, решает скин (или простая кнопка). */
export function ChatReopenControl({ skin, client, chatId, onReopened }: { skin: SandboxSkin; client: SandboxClient; chatId: string; onReopened: () => void }) {
  const labels = useChatReopenLabels();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const reopen = async () => {
    setPending(true);
    setFailed(false);
    try {
      await client.reopenChat(chatId);
      onReopened();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  const error = failed ? labels.failed : undefined;
  if (skin.ChatReopen) return <skin.ChatReopen onReopen={() => void reopen()} pending={pending} {...(error && { error })} />;
  return (
    <div>
      <button type="button" disabled={pending} onClick={() => void reopen()}>
        {pending ? labels.reopening : labels.reopen}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
