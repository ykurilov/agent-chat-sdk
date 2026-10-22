import { Button, Field, Input, Textarea } from "@tandem/ui";
import type { MemorySkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { useEffect, useRef } from "react";
import type { ComponentProps, KeyboardEvent } from "react";

type MemoryNoteEditorProps = ComponentProps<MemorySkin["MemoryNoteEditor"]>;

/**
 * Форма записи: раздел (уровни через «/») и текст. Enter в разделе и Ctrl/⌘+Enter в тексте сохраняют (в тексте
 * обычный Enter — новая строка), Escape отменяет. При открытии фокус в разделе, а при правке — в конце текста.
 */
export function OduvanchikMemoryNoteEditor({
  mode,
  path,
  content,
  onPathChange,
  onContentChange,
  onSave,
  onCancel,
  canSave,
  pending,
  errors,
}: MemoryNoteEditorProps) {
  const labels = useChatLabels();
  const pathRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (mode === "create") {
      pathRef.current?.focus();
      return;
    }
    const field = contentRef.current;
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
    // Только при открытии: дальше фокус ведёт человек.
  }, []);

  const save = () => {
    if (canSave && !pending) onSave();
  };
  const keys = (saveOn: (event: KeyboardEvent) => boolean) => (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      // Escape закрывает только форму: окно вокруг неё (если есть) остаётся.
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing && saveOn(event)) {
      event.preventDefault();
      save();
    }
  };

  return (
    <div
      role="group"
      aria-label={mode === "create" ? labels.memoryNewNoteTitle : labels.memoryEditNoteTitle}
      className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface)] p-3"
    >
      <p className="text-sm font-semibold text-[var(--foreground)]">{mode === "create" ? labels.memoryNewNoteTitle : labels.memoryEditNoteTitle}</p>
      <Field label={labels.memoryPathField} hint={labels.memoryPathHint} {...(errors.path && { error: errors.path })}>
        <Input ref={pathRef} value={path} onChange={(event) => onPathChange(event.target.value)} onKeyDown={keys(() => true)} className="w-full" />
      </Field>
      <Field label={labels.memoryContentField} {...(errors.content && { error: errors.content })}>
        <Textarea
          ref={contentRef}
          value={content}
          rows={3}
          onChange={(event) => onContentChange(event.target.value)}
          onKeyDown={keys((event) => event.ctrlKey || event.metaKey)}
          className="w-full"
        />
      </Field>
      {errors.form && (
        <p role="alert" className="break-words text-sm text-[var(--destructive-text)]">
          {errors.form}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {labels.memoryCancel}
        </Button>
        <Button size="sm" loading={pending} disabled={!canSave || pending} onClick={save}>
          {labels.memorySave}
        </Button>
      </div>
    </div>
  );
}
