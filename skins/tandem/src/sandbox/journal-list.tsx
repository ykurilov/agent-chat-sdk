import { Badge, Button, cn } from "@tandem/ui";
import type { JournalModelRowView, JournalRowView, JournalToolRowView, SandboxSkin } from "@ykurilov/agent-chat-sandbox/react";
import { useSandboxLabels } from "@ykurilov/agent-chat-sandbox/react";
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import type { ComponentProps, ReactNode } from "react";

/** Журнал хода или всего чата: выбор хода и строки обращений и вызовов, каждая раскрывается кнопкой. */
export function TandemJournalList({ state, rows, onRetry, turns, currentTurnId, onTurnChange }: ComponentProps<SandboxSkin["JournalList"]>) {
  const labels = useSandboxLabels();
  return (
    <div className="flex flex-col gap-2 p-3 text-xs">
      {turns.length > 0 && (
        <select
          aria-label={labels.turnPicker}
          value={currentTurnId ?? ""}
          onChange={(event) => onTurnChange(event.target.value === "" ? null : event.target.value)}
          className="tandem-focus h-9 rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--foreground)]"
        >
          {turns.map((turn) => (
            <option key={turn.id ?? ""} value={turn.id ?? ""}>
              {turn.label}
            </option>
          ))}
        </select>
      )}
      {state === "loading" && (
        <p aria-live="polite" className="py-2 text-[var(--foreground-muted)]">
          {labels.journalLoading}
        </p>
      )}
      {state === "failed" && (
        <div role="alert" className="flex items-center gap-2 py-2 text-[var(--destructive-text)]">
          {labels.journalFailed}
          {onRetry && (
            <Button variant="ghost" size="sm" onClick={onRetry} className="h-7 px-2">
              {labels.retry}
            </Button>
          )}
        </div>
      )}
      {state === "empty" && <p className="py-2 text-[var(--foreground-muted)]">{labels.journalEmpty}</p>}
      {state === "ready" && (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.id}>
              <JournalRow row={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function JournalRow({ row }: { row: JournalRowView }) {
  const detailsId = useId();
  return (
    <div className="rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface)]">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={row.open}
        aria-controls={detailsId}
        onClick={() => row.onOpenChange(!row.open)}
        className="h-auto min-h-9 w-full flex-wrap items-center justify-start gap-x-2 gap-y-1 rounded-[var(--radius-nested)] px-3 py-1.5 text-left text-xs font-normal"
      >
        {row.kind === "model" ? <ModelRowSummary row={row} /> : <ToolRowSummary row={row} />}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "ml-auto size-3.5 shrink-0 text-[var(--foreground-subtle)] transition-transform duration-[var(--motion-fast)]",
            row.open && "rotate-180",
          )}
        />
      </Button>
      <div id={detailsId} hidden={!row.open} className="border-t border-[var(--border)] px-3 py-2.5">
        {row.open && row.details}
      </div>
    </div>
  );
}

function ModelRowSummary({ row }: { row: JournalModelRowView }) {
  const labels = useSandboxLabels();
  return (
    <>
      <Badge variant={row.status === "complete" ? "neutral" : "warm"} className="shrink-0 py-0.5">
        {labels.purposes[row.purpose]}
      </Badge>
      <span className="min-w-0 truncate font-medium text-[var(--foreground)]">{row.modelId}</span>
      {row.status !== "complete" && <Badge variant="warm">{labels.modelCallStatus[row.status]}</Badge>}
      {row.attempt > 1 && <Meta>{labels.attempt(row.attempt)}</Meta>}
      {row.instructionsChanged && <Badge variant="cool">{labels.instructionsChanged}</Badge>}
      <span className="flex w-full flex-wrap gap-x-2 text-[var(--foreground-muted)]">
        <Meta>{row.time}</Meta>
        <Meta>{labels.durationMs(row.durationMs)}</Meta>
        {row.firstChunkMs !== null && <Meta>{labels.firstChunk(row.firstChunkMs)}</Meta>}
        {row.inputTokens !== null && <Meta>{labels.tokens(row.inputTokens, row.cachedInputTokens ?? 0, row.outputTokens ?? 0)}</Meta>}
        <Meta>{row.cost ?? labels.costUnknown}</Meta>
      </span>
    </>
  );
}

function ToolRowSummary({ row }: { row: JournalToolRowView }) {
  const labels = useSandboxLabels();
  return (
    <>
      <Badge variant={row.status === "complete" ? "success" : "warm"} className="shrink-0 py-0.5">
        {row.title ?? row.toolName}
      </Badge>
      {row.source === "message" && <Badge variant="neutral">{labels.fromMessage}</Badge>}
      {row.outputEdited && <Badge variant="cool">{labels.outputEdited}</Badge>}
      {row.status === "error" && <Meta>{labels.error}</Meta>}
      <span className="flex w-full flex-wrap gap-x-2 text-[var(--foreground-muted)]">
        <Meta>{row.time}</Meta>
        {row.durationMs !== null && <Meta>{labels.durationMs(row.durationMs)}</Meta>}
      </span>
    </>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return <span className="text-[var(--foreground-muted)]">{children}</span>;
}
