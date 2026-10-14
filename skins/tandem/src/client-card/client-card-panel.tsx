import { Alert, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@tandem/ui";
import type { ClientCardFieldView, ClientCardPanelProps } from "@ykurilov/agent-chat-flows/react";
import { useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { Trash2, UserRound } from "lucide-react";
import { useId, useState } from "react";

function FieldRow({ field }: { field: ClientCardFieldView }) {
  const labels = useFlowLabels().clientCard;
  return (
    <li className="flex min-w-0 items-start gap-3 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="break-words text-xs font-medium text-[var(--foreground-subtle)]">{field.name}</span>
        <span className="break-words text-sm leading-6 text-[var(--foreground)]">{field.value}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--foreground-muted)]">
          <span>{labels.updatedAt(field.updatedAt)}</span>
          {field.stale && (
            <Badge variant="warm" className="py-0 text-[11px]">
              {labels.stale}
            </Badge>
          )}
        </span>
      </div>
      <Button variant="ghost" size="sm" aria-label={`${labels.forgetField}: ${field.name}`} disabled={field.busy} loading={field.busy} onClick={field.onForget}>
        <Trash2 aria-hidden="true" />
        {labels.forgetField}
      </Button>
    </li>
  );
}

/**
 * Экран карточки клиента: «Что агент знает о вас». Поля по порядку важности, у каждого значение, дата записи, пометка
 * «может быть уже не так» и «Стереть»; «Стереть всё» спрашивает подтверждение. Всё переносится по строкам: на телефоне
 * нет горизонтальной прокрутки.
 */
export function TandemClientCardPanel({ state, fields, forgettingAll, onForgetAll, onRetry }: ClientCardPanelProps) {
  const labels = useFlowLabels().clientCard;
  const headingId = useId();
  const [confirming, setConfirming] = useState(false);
  const ready = state === "ready";

  return (
    <section aria-labelledby={headingId} className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h2 id={headingId} className="min-w-0 text-lg font-semibold text-[var(--foreground)]">
          {labels.title}
        </h2>
        {ready && fields.length > 0 && (
          <Button variant="secondary" size="md" disabled={forgettingAll} loading={forgettingAll} onClick={() => setConfirming(true)}>
            <Trash2 aria-hidden="true" />
            {labels.forgetAll}
          </Button>
        )}
      </header>
      {state === "loading" && <p className="text-sm text-[var(--foreground-muted)]">{labels.loading}</p>}
      {state === "failed" && (
        <Alert
          variant="warm"
          title={labels.failed}
          className="w-full"
          action={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {labels.retry}
            </Button>
          }
        />
      )}
      {ready && fields.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <UserRound aria-hidden="true" className="size-8 text-[var(--foreground-muted)]" />
          <p className="max-w-prose break-words text-sm text-[var(--foreground-muted)]">{labels.empty}</p>
        </div>
      )}
      {ready && fields.length > 0 && (
        <ul className="flex min-w-0 flex-col gap-2">
          {fields.map((field) => (
            <FieldRow key={field.fieldId} field={field} />
          ))}
        </ul>
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.forgetAll}</DialogTitle>
            <DialogDescription className="break-words">{labels.forgetAllConfirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {labels.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                onForgetAll();
              }}
            >
              {labels.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
