import { useState } from "react";
import type { AgentChatMessage } from "@ykurilov/agent-chat-react";
import type { AnswerEditMark } from "../types";
import { answerEditDraft, answerEditRequest, checkAnswerEditDraft } from "./answer-edit-draft";
import type { AnswerEditDraft } from "./answer-edit-draft";
import type { SandboxClient } from "./sandbox-client";
import { useSandboxLabels } from "./sandbox-labels";
import type { SandboxSkin } from "./sandbox-skin";

/** Редактор ответа на месте ответа: черновик текста и JSON результатов, проверка, отправка только изменённого. */
export function AnswerEditorHost({
  skin,
  client,
  chatId,
  message,
  onSaved,
  onCancel,
}: {
  skin: SandboxSkin;
  client: SandboxClient;
  chatId: string;
  message: AgentChatMessage;
  onSaved: (newMessageId: string, mark: AnswerEditMark) => void;
  onCancel: () => void;
}) {
  const labels = useSandboxLabels();
  const [draft, setDraft] = useState<AnswerEditDraft>(() => answerEditDraft(message));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const check = checkAnswerEditDraft(draft);

  const save = async () => {
    if (!check.canSave || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const saved = await client.editAnswer(chatId, message.id, answerEditRequest(draft));
      onSaved(saved.messageId, saved.mark);
    } catch {
      setError(labels.answerEditFailed);
      setSaving(false);
    }
  };

  return (
    <skin.AnswerEditor
      text={draft.text}
      onTextChange={(text) => setDraft((current) => ({ ...current, text }))}
      {...(check.textError && { textError: labels.answerTextEmpty })}
      toolOutputs={draft.toolOutputs.map((output) => {
        const outputError = check.outputErrors[output.toolCallId];
        return {
          toolCallId: output.toolCallId,
          toolName: output.toolName,
          ...(output.title !== undefined && { title: output.title }),
          value: output.value,
          onValueChange: (value: string) =>
            setDraft((current) => ({
              ...current,
              toolOutputs: current.toolOutputs.map((item) => (item.toolCallId === output.toolCallId ? { ...item, value } : item)),
            })),
          ...(outputError && { error: outputError === "invalid" ? labels.toolOutputInvalidJson : labels.toolOutputTooLarge }),
          edited: output.value !== output.original,
        };
      })}
      onSave={() => void save()}
      onCancel={onCancel}
      canSave={check.canSave && !saving}
      saving={saving}
      {...(error && { error })}
    />
  );
}
