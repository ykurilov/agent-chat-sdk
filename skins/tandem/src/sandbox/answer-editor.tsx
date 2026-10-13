import { Badge, Button, Field, Textarea } from "@tandem/ui";
import type { SandboxSkin } from "@ykurilov/agent-chat-sandbox/react";
import { useSandboxLabels } from "@ykurilov/agent-chat-sandbox/react";
import type { ComponentProps } from "react";

/** Правка ответа агента на его месте в ленте: текст и JSON результата у каждого обычного вызова. */
export function TandemAnswerEditor({
  text,
  onTextChange,
  textError,
  toolOutputs,
  onSave,
  onCancel,
  canSave,
  saving,
  error,
}: ComponentProps<SandboxSkin["AnswerEditor"]>) {
  const labels = useSandboxLabels();
  return (
    <section
      aria-label={labels.answerEditor}
      className="mb-6 flex max-w-[650px] flex-col gap-3 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] p-3"
    >
      <Field label={labels.answerText} error={textError}>
        <Textarea value={text} onChange={(event) => onTextChange(event.target.value)} rows={6} />
      </Field>
      {toolOutputs.map((output) => (
        <div key={output.toolCallId} className="flex flex-col gap-1">
          <Field label={labels.toolOutputJson(output.title ?? output.toolName)} error={output.error}>
            <Textarea value={output.value} onChange={(event) => output.onValueChange(event.target.value)} rows={4} className="font-mono text-xs" />
          </Field>
          {output.edited && !output.error && <Badge variant="cool" className="self-start">{labels.outputEdited}</Badge>}
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-[var(--destructive-text)]">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={!canSave || saving}>
          {saving ? labels.answerEditSaving : labels.answerEditSave}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          {labels.answerEditCancel}
        </Button>
      </div>
    </section>
  );
}
