import { Badge, Button, Field, Textarea, cn } from "@tandem/ui";
import type { SandboxSkin } from "@ykurilov/agent-chat-sandbox/react";
import { useSandboxLabels } from "@ykurilov/agent-chat-sandbox/react";
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import type { ComponentProps } from "react";

/** Инструкция песочного чата: свёрнута в строку над чатом; раскрытая — поле правки и боевая инструкция для сравнения. */
export function TandemInstructionEditor({
  value,
  onValueChange,
  appInstructions,
  edited,
  dirty,
  onSave,
  canSave,
  saving,
  onReset,
  open,
  onOpenChange,
  error,
  maxLength,
}: ComponentProps<SandboxSkin["InstructionEditor"]>) {
  const labels = useSandboxLabels();
  const bodyId = useId();
  return (
    <div className="text-sm">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onOpenChange(!open)}
        className="h-9 gap-2 px-2 font-medium [&_svg]:size-3.5"
      >
        {labels.instructionEditor}
        {edited && <Badge variant="cool">{labels.instructionsEdited}</Badge>}
        <ChevronDown aria-hidden="true" className={cn("transition-transform duration-[var(--motion-fast)]", open && "rotate-180")} />
      </Button>
      <div id={bodyId} hidden={!open} className="flex flex-col gap-2 px-2 pb-2 pt-1">
        {open && (
          <>
          <Field label={labels.instructionText}>
            <Textarea value={value} onChange={(event) => onValueChange(event.target.value)} rows={6} className="font-mono text-xs" />
          </Field>
          <span className={cn("self-end text-xs", value.length > maxLength ? "text-[var(--destructive-text)]" : "text-[var(--foreground-subtle)]")}>
            {`${value.length} / ${maxLength}`}
          </span>
          {error && (
            <p role="alert" className="text-xs text-[var(--destructive-text)]">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onSave} disabled={!canSave || saving || !dirty}>
              {saving ? labels.instructionsSaving : labels.instructionsSave}
            </Button>
            {onReset && (
              <Button variant="ghost" size="sm" onClick={onReset} disabled={saving}>
                {labels.instructionsReset}
              </Button>
            )}
          </div>
          <details className="text-xs">
            <summary className="tandem-focus cursor-pointer text-[var(--foreground-muted)]">{labels.appInstructions}</summary>
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-small)] bg-[var(--canvas)] p-2 font-mono leading-5 text-[var(--foreground-muted)]">
              {appInstructions}
            </pre>
          </details>
          </>
        )}
      </div>
    </div>
  );
}
