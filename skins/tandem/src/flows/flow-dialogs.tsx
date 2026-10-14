import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@tandem/ui";
import type { FlowJsonDialogProps } from "@ykurilov/agent-chat-flows/react";
import { useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { Check, Copy, Download, Upload } from "lucide-react";
import { useRef, useState } from "react";

/** Окно JSON: показ, копия, скачивание и загрузка файла или вставленного текста с ошибками разбора. */
export function TandemFlowJsonDialog(props: FlowJsonDialogProps) {
  const labels = useFlowLabels().editor.jsonDialog;
  const [text, setText] = useState(props.json);
  const [copied, setCopied] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const edited = text !== props.json;

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[min(760px,calc(100vw-24px))] max-w-none flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>
        <textarea
          aria-label={labels.title}
          spellCheck={false}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="min-h-[320px] w-full flex-1 resize-none rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface-muted)] p-3 font-mono text-xs leading-relaxed text-[var(--foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        />
        {props.errors.length > 0 && (
          <ul role="alert" className="max-h-32 overflow-y-auto rounded-[var(--radius-small)] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] p-3 text-xs text-[var(--destructive-text)]">
            {props.errors.map((error) => (
              <li key={error} className="break-words font-mono">
                {error}
              </li>
            ))}
          </ul>
        )}
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (event) => {
            const chosen = event.target.files?.[0];
            if (!chosen) return;
            const content = await chosen.text();
            setText(content);
            props.onLoad(content);
            event.target.value = "";
          }}
        />
        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              props.onCopy();
              setCopied(true);
            }}
          >
            {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
            {copied ? labels.copied : labels.copy}
          </Button>
          <Button variant="secondary" onClick={props.onDownload}>
            <Download aria-hidden="true" className="size-4" />
            {labels.download}
          </Button>
          <Button variant={edited ? "primary" : "secondary"} onClick={() => (edited ? props.onLoad(text) : file.current?.click())}>
            <Upload aria-hidden="true" className="size-4" />
            {labels.load}
          </Button>
          <Button variant="ghost" onClick={props.onClose}>
            {labels.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Рамка тестового чата живёт в `test-chat.tsx`. */
export { TandemFlowTestChatFrame } from "./test-chat";
