import { Button, Textarea } from "@ykurilov/ds-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import type { ChatSkin } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./primitives/dialog";

/** Use the skin-owned portal: embedded.css deliberately excludes unmarked host DOM. */
export function OduvanchikAnswerTextEditor(p: ComponentProps<NonNullable<ChatSkin["AnswerTextEditor"]>>) {
  const labels = useChatLabels();
  return <Dialog open onOpenChange={open => { if (!open && !p.saving) p.onCancel(); }}>
    <DialogContent className="oduvanchik-chat flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{labels.editAnswer}</DialogTitle></DialogHeader>
      <DialogBody className="grid gap-4">
        <Textarea label={labels.editAnswer} value={p.value} onChange={e => p.onValueChange(e.target.value)} rows={8} disabled={p.saving} maxLength={100000} />
        {p.fields}
        {p.error && <p role="alert">{p.error}</p>}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="sm" disabled={p.saving} onClick={p.onCancel}>{labels.cancelEdit}</Button>
        <Button size="sm" disabled={!p.canSave || p.saving} onClick={p.onSave}>{labels.answerEditSave}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
