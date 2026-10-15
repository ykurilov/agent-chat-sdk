import { Alert, Button, Card, Field, Input, Textarea, cn } from "@tandem/ui";
import type { MouseEvent } from "react";
import { SKILL_STATUSES, useSkillsLabels } from "@ykurilov/agent-chat-skills/react";
import type { SkillEditorProps } from "@ykurilov/agent-chat-skills/react";
import { SafeMarkdown } from "../safe-markdown";
import { SkillStatusBadge } from "./skill-status-badge";

function Counter({ length, max }: { length: number; max: number }) {
  const labels = useSkillsLabels();
  return (
    <span className={cn("text-xs tabular-nums", length > max ? "text-[var(--destructive-text)]" : "text-[var(--foreground-subtle)]")}>
      {labels.counter(length, max)}
    </span>
  );
}

/**
 * Ссылка предпросмотра, которая открылась бы в этой же вкладке, не срабатывает: обезвреженная (`javascript:` — пустой
 * адрес) перезагрузила бы страницу, внутренняя увела бы с экрана, и черновик пропал бы. Внешние открываются в новой вкладке.
 */
function keepDraftOnLinkClick(event: MouseEvent) {
  const link = (event.target as Element).closest("a");
  if (link && link.target !== "_blank") event.preventDefault();
}

/**
 * Форма навыка: имя (только у нового), статус, «когда брать», указания с предпросмотром, сохранение и удаление.
 * Предпросмотр — `SafeMarkdown`: сырой HTML не исполняется, опасные ссылки вырезаны.
 */
export function TandemSkillEditor(props: SkillEditorProps) {
  const labels = useSkillsLabels();
  const { mode, preview } = props;
  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {mode === "edit" ? (
          <>
            <h2 className="min-w-0 truncate font-mono text-base font-semibold">{props.name}</h2>
            <SkillStatusBadge status={props.status} />
            {props.version !== undefined && <span className="text-xs text-[var(--foreground-muted)]">{labels.versionLabel(props.version)}</span>}
            {props.updated && <span className="text-xs text-[var(--foreground-subtle)]">{props.updated}</span>}
          </>
        ) : (
          <h2 className="text-base font-semibold">{labels.create}</h2>
        )}
      </div>

      {props.onNameChange && (
        <Field label={labels.name} hint={labels.nameHint}>
          <Input value={props.name} onChange={(event) => props.onNameChange!(event.target.value)} className="font-mono" autoComplete="off" spellCheck={false} />
        </Field>
      )}

      <div role="radiogroup" aria-label={labels.status} className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm text-[var(--foreground-muted)]">{labels.status}</span>
        {SKILL_STATUSES.map((status) => (
          <Button
            key={status}
            role="radio"
            aria-checked={props.status === status}
            variant={props.status === status ? "primary" : "secondary"}
            size="sm"
            disabled={props.statusBusy}
            onClick={() => props.status !== status && props.onStatusChange(status)}
          >
            {labels.statuses[status]}
          </Button>
        ))}
      </div>

      <Field label={labels.whenToUse} hint={labels.whenToUseHint}>
        <Input value={props.whenToUse} onChange={(event) => props.onWhenToUseChange(event.target.value)} />
      </Field>
      <div className="-mt-3 self-end">
        <Counter length={props.whenToUse.length} max={props.maxWhenToUseChars} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{labels.body}</span>
          <div role="tablist" className="ml-auto flex gap-1">
            <Button role="tab" aria-selected={!preview} variant={preview ? "ghost" : "secondary"} size="sm" onClick={() => props.onPreviewChange(false)}>
              {labels.edit}
            </Button>
            <Button role="tab" aria-selected={preview} variant={preview ? "secondary" : "ghost"} size="sm" onClick={() => props.onPreviewChange(true)}>
              {labels.preview}
            </Button>
          </div>
        </div>
        {preview ? (
          <div
            data-testid="skill-preview"
            onClickCapture={keepDraftOnLinkClick}
            className="min-h-60 overflow-auto rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
          >
            {props.body.trim() === "" ? <p className="text-[var(--foreground-subtle)]">{labels.previewEmpty}</p> : <SafeMarkdown markdown={props.body} />}
          </div>
        ) : (
          <Textarea
            aria-label={labels.body}
            value={props.body}
            onChange={(event) => props.onBodyChange(event.target.value)}
            rows={16}
            spellCheck={false}
            className="font-mono text-xs leading-5"
          />
        )}
        <div className="self-end">
          <Counter length={props.body.length} max={props.maxBodyChars} />
        </div>
      </div>

      {props.error && (
        <p role="alert" className="text-sm text-[var(--destructive-text)]">
          {props.error}
        </p>
      )}
      {props.conflict && (
        <Alert
          variant="warm"
          title={labels.conflict}
          action={
            props.onReloadLatest && (
              <Button variant="secondary" size="sm" onClick={props.onReloadLatest}>
                {labels.reloadLatest}
              </Button>
            )
          }
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={props.onSave} disabled={!props.canSave || props.saving || !props.dirty} loading={props.saving}>
          {props.saving ? labels.saving : labels.save}
        </Button>
        {props.onCancel && (
          <Button variant="ghost" size="sm" onClick={props.onCancel} disabled={props.saving}>
            {labels.cancel}
          </Button>
        )}
        {props.onDelete && !props.confirmingDelete && (
          <Button variant="ghost" size="sm" className="ml-auto text-[var(--destructive-text)]" onClick={props.onDelete}>
            {labels.delete}
          </Button>
        )}
      </div>
      {props.confirmingDelete && (
        <Alert
          variant="danger"
          title={labels.deleteConfirm(props.name)}
          action={
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" onClick={props.onConfirmDelete} disabled={props.deleting} loading={props.deleting}>
                {props.deleting ? labels.deleting : labels.deleteYes}
              </Button>
              <Button variant="ghost" size="sm" onClick={props.onCancelDelete} disabled={props.deleting}>
                {labels.cancel}
              </Button>
            </div>
          }
        />
      )}
      {props.discardingDraft && (
        <Alert
          variant="warm"
          title={labels.discardWarning}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={props.onConfirmDiscard}>
                {labels.discardYes}
              </Button>
              <Button variant="ghost" size="sm" onClick={props.onCancelDiscard}>
                {labels.stay}
              </Button>
            </div>
          }
        />
      )}
    </Card>
  );
}
