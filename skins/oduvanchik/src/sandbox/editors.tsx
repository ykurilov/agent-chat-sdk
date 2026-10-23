import { Button, Dialog, Textarea } from "@ykurilov/ds-react";
import { FileTextIcon, LockOpenIcon } from "@phosphor-icons/react";
import { useChatReopenLabels, useSandboxLabels } from "@ykurilov/agent-chat-sandbox/react";
import type { SandboxSkin } from "@ykurilov/agent-chat-sandbox/react";
import type { ComponentProps } from "react";

export function OduvanchikInstructionEditor(p: ComponentProps<SandboxSkin["InstructionEditor"]>) {
  const labels = useSandboxLabels();
  return <>
    <Button variant="ghost" size="sm" icon={FileTextIcon} aria-expanded={p.open} onClick={() => p.onOpenChange(true)}>{labels.instructionEditor}{p.edited && <span className="oduvanchik-label">{labels.instructionsEdited}</span>}</Button>
    <Dialog open={p.open} onClose={() => p.onOpenChange(false)} title={labels.instructionEditor}>
      <div className="oduvanchik-chat oduvanchik-sandbox-editor">
        <Textarea label={labels.instructionText} value={p.value} onChange={(event) => p.onValueChange(event.target.value)} rows={6} hint={`${p.value.length} / ${p.maxLength}`} />
        {p.error && <p role="alert">{p.error}</p>}
        <div className="oduvanchik-sandbox-actions"><Button size="sm" onClick={p.onSave} disabled={!p.canSave || p.saving || !p.dirty}>{p.saving ? labels.instructionsSaving : labels.instructionsSave}</Button>{p.onReset && <Button variant="ghost" size="sm" onClick={p.onReset} disabled={p.saving}>{labels.instructionsReset}</Button>}<Button variant="ghost" size="sm" onClick={() => p.onOpenChange(false)}>{labels.answerEditCancel}</Button></div>
        <details><summary>{labels.appInstructions}</summary><pre className="oduvanchik-journal-code">{p.appInstructions}</pre></details>
      </div>
    </Dialog>
  </>;
}
export function OduvanchikAnswerEditor(p: ComponentProps<SandboxSkin["AnswerEditor"]>) {
  const labels = useSandboxLabels();
  return <section aria-label={labels.answerEditor} className="oduvanchik-sandbox-editor">
    <Textarea label={labels.answerText} error={p.textError} value={p.text} onChange={(event) => p.onTextChange(event.target.value)} rows={6} />
    {p.toolOutputs.map((output) => <div key={output.toolCallId}><Textarea label={labels.toolOutputJson(output.title ?? output.toolName)} error={output.error} value={output.value} onChange={(event) => output.onValueChange(event.target.value)} rows={4} />{output.edited && !output.error && <p className="oduvanchik-label">{labels.outputEdited}</p>}</div>)}
    {p.error && <p role="alert">{p.error}</p>}
    <div className="oduvanchik-sandbox-actions"><Button size="sm" onClick={p.onSave} disabled={!p.canSave || p.saving}>{p.saving ? labels.answerEditSaving : labels.answerEditSave}</Button><Button size="sm" variant="ghost" onClick={p.onCancel} disabled={p.saving}>{labels.answerEditCancel}</Button></div>
  </section>;
}
export function OduvanchikChatReopen({ onReopen, pending, error }: ComponentProps<NonNullable<SandboxSkin["ChatReopen"]>>) {
  const labels = useChatReopenLabels();
  return <div><Button size="sm" variant="ghost" icon={LockOpenIcon} disabled={pending} onClick={onReopen}>{pending ? labels.reopening : labels.reopen}</Button>{error && <p role="alert">{error}</p>}</div>;
}
