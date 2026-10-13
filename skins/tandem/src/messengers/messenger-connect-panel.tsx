import { Alert, Badge, Button } from "@tandem/ui";
import { useMessengersLabels } from "@ykurilov/agent-chat-messengers/react";
import type { MessengerConnectPanelProps, MessengerConnectRowView } from "@ykurilov/agent-chat-messengers/react";
import { Check, ExternalLink } from "lucide-react";

const accountName = ({ name, username }: NonNullable<MessengerConnectRowView["connected"]>) => (username ? `${name} (@${username})` : name);

/** Один мессенджер: название, «Подключено» с именем и «Отвязать» — или «Подключить» и ссылка с кодом. */
function MessengerRow({ row }: { row: MessengerConnectRowView }) {
  const labels = useMessengersLabels();
  const title = labels.messengerNames[row.messenger];
  return (
    <li
      role="group"
      aria-label={title}
      data-messenger={row.messenger}
      className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-[var(--foreground)]">{title}</span>
        {row.connected && (
          <Badge variant="success" className="shrink-0 gap-1 py-0.5 font-medium">
            <Check aria-hidden="true" className="size-3" />
            {labels.connected}
          </Badge>
        )}
        {row.connected ? (
          <Button variant="ghost" size="sm" className="ml-auto shrink-0" loading={row.busy} disabled={row.busy} onClick={row.onDisconnect}>
            {labels.disconnect}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" className="ml-auto shrink-0" loading={row.busy} disabled={row.busy} onClick={row.onConnect}>
            {labels.connect}
          </Button>
        )}
      </div>
      {row.connected && <p className="min-w-0 truncate text-xs text-[var(--foreground-muted)]">{accountName(row.connected)}</p>}
      {row.offer && (
        <div className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-small)] bg-[var(--surface-muted)] p-2.5 text-xs">
          <p className="break-words text-[var(--foreground-muted)]">{labels.openLinkHint}</p>
          <Button asChild size="sm" className="self-start">
            <a href={row.offer.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" className="size-3.5" />
              {labels.openLink}
            </a>
          </Button>
          <p className="flex flex-wrap items-center gap-x-2 text-[var(--foreground-muted)]">
            <span className="font-mono text-[var(--foreground)]">{labels.codeLabel(row.offer.code)}</span>
            <span>{row.offer.expiresAt}</span>
          </p>
        </div>
      )}
      {row.failed && (
        <p role="alert" className="break-words text-xs text-[var(--destructive-text)]">
          {labels.failed}
        </p>
      )}
    </li>
  );
}

/** Панель «Подключить мессенджер»: строка на каждый мессенджер приложения. */
export function TandemMessengerConnectPanel({ state, rows, onRetry }: MessengerConnectPanelProps) {
  const labels = useMessengersLabels();
  return (
    <section aria-label={labels.title} className="flex min-w-0 flex-col gap-3">
      <h3 className="text-sm font-semibold text-[var(--foreground)]">{labels.title}</h3>
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
      {state === "ready" && (
        <ul className="flex min-w-0 flex-col gap-2">
          {rows.map((row) => (
            <MessengerRow key={row.messenger} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
