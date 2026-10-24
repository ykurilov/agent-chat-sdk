import { Button } from "./controls";
import { Dialog } from "@ykurilov/ds-react";
import type { FlowJsonDialogProps } from "@ykurilov/agent-chat-flows/react";
import { useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { CheckIcon as Check, CopyIcon as Copy, DownloadSimpleIcon as Download, UploadSimpleIcon as Upload } from "@phosphor-icons/react";
import { useRef, useState } from "react";

/** Окно JSON: показ, копия, скачивание и загрузка файла или вставленного текста с ошибками разбора. */
export function OduvanchikFlowJsonDialog(props: FlowJsonDialogProps) {
  const labels = useFlowLabels().editor.jsonDialog;
  const [text, setText] = useState(props.json);
  const [copied, setCopied] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const edited = text !== props.json;

  return (
    <Dialog open title={labels.title} onClose={props.onClose}>
      <div className="oduvanchik-flow oduvanchik-flow-dialog">
        
        <textarea
          aria-label={labels.title}
          readOnly={props.readOnly}
          spellCheck={false}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="min-h-[320px] w-full flex-1 resize-none rounded-[var(--yk-radius-lg)] border border-[var(--yk-border)] bg-[var(--yk-surface-2)] p-3 font-mono text-xs leading-relaxed text-[var(--yk-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--yk-accent)]"
        />
        {props.errors.length > 0 && (
          <ul role="alert" className="max-h-32 overflow-y-auto rounded-[var(--yk-radius-sm)] bg-[color-mix(in_oklab,var(--yk-danger)_10%,transparent)] p-3 text-xs text-[var(--yk-danger)]">
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
        <footer className="flex flex-wrap gap-2">
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
          {!props.readOnly && (
            <Button variant={edited ? "primary" : "secondary"} onClick={() => (edited ? props.onLoad(text) : file.current?.click())}>
              <Upload aria-hidden="true" className="size-4" />
              {labels.load}
            </Button>
          )}
          <Button variant="ghost" onClick={props.onClose}>
            {labels.close}
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}

/** Рамка тестового чата живёт в `test-chat.tsx`. */
export { OduvanchikFlowTestChatFrame } from "./test-chat";
