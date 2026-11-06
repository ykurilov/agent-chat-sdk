import { useEffect, useRef, useState } from "react";
import type { AgentChatMessage } from "../chat-types";
import { messageText } from "../chat-types";
import { useChatLabels } from "../labels";
import type { ChatSkin } from "../skin-contract";
import type { AnswerTextEditing } from "./answer-editing";

export function AnswerTextEditor({ skin, message, options, save, onSaved, onCancel }: {
  skin: ChatSkin;
  message: AgentChatMessage;
  options: AnswerTextEditing;
  save: (text: string, data: Record<string, unknown>, signal: AbortSignal) => Promise<string | null>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const labels = useChatLabels();
  const original = messageText(message);
  const [value, setValue] = useState(original);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const lifetime = useRef(new AbortController());
  const active = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const canSave = !saving && value.trim().length > 0 && value !== original && value.length <= 100_000;
  async function submit() {
    if (!canSave || active.current) return;
    active.current = true; setSaving(true); setError(undefined);
    const signal = lifetime.current.signal;
    try {
      const id = await save(value, data, signal);
      if (!signal.aborted && id) onSaved();
      else if (!signal.aborted) setError(labels.answerEditFailed);
    } catch { if (!signal.aborted) setError(labels.answerEditFailed); }
    finally { active.current = false; if (!signal.aborted) setSaving(false); }
  }
  const Editor = skin.AnswerTextEditor;
  if (!Editor) return null;
  return <Editor value={value} onValueChange={setValue} onSave={() => void submit()} onCancel={onCancel} canSave={canSave} saving={saving} {...(error && { error })}
    {...(options.renderFields && { fields: options.renderFields({ message, data, setData, disabled: saving }) })} />;
}
