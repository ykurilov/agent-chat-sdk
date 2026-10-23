import { Button, ScrollArea, Select, Sphere } from "@ykurilov/ds-react";
import { CaretDownIcon, CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { useSandboxLabels } from "@ykurilov/agent-chat-sandbox/react";
import type { JournalRowView, SandboxSkin } from "@ykurilov/agent-chat-sandbox/react";
import { useId } from "react";
import type { ComponentProps } from "react";

/** Timeline of actual model/tool calls; it never fabricates workflow stages. */
export function OduvanchikJournalList({ state, rows, busy, onRetry, turns, currentTurnId, onTurnChange }: ComponentProps<SandboxSkin["JournalList"]>) {
  const labels = useSandboxLabels();
  const chatLabels = useChatLabels();
  return <div className="oduvanchik-journal">
    {turns.length > 0 && <Select size="sm" aria-label={labels.turnPicker} value={currentTurnId ?? ""} onChange={(event) => onTurnChange(event.target.value || null)}>{turns.map((turn) => <option key={turn.id ?? ""} value={turn.id ?? ""}>{turn.label}</option>)}</Select>}
    <ScrollArea label={labels.journalPanel} className="oduvanchik-journal-scroll">
      {busy && <p role="status" className="oduvanchik-journal-working"><Sphere size={18} />{chatLabels.reasoningRunning}</p>}
      {state === "loading" && <p role="status">{labels.journalLoading}</p>}
      {state === "failed" && <div role="alert"><p>{labels.journalFailed}</p>{onRetry && <Button variant="ghost" size="sm" onClick={onRetry}>{labels.retry}</Button>}</div>}
      {state === "empty" && !busy && <div className="oduvanchik-journal-empty"><span>{labels.journalEmpty}</span></div>}
      {state === "ready" && <ol className="oduvanchik-journal-events">{rows.map((row) => <JournalRow key={row.id} row={row} />)}</ol>}
    </ScrollArea>
  </div>;
}

function JournalRow({ row }: { row: JournalRowView }) {
  const labels = useSandboxLabels();
  const id = useId();
  const success = row.status === "complete";
  return <li className="oduvanchik-journal-event" data-journal-kind={row.kind}>
    {success ? <CheckCircleIcon className="oduvanchik-journal-icon" aria-hidden /> : <WarningCircleIcon className="oduvanchik-journal-icon" aria-hidden />}
    <button type="button" className="oduvanchik-journal-summary" aria-expanded={row.open} aria-controls={id} onClick={() => row.onOpenChange(!row.open)}>
      <span className="oduvanchik-label">{row.time}</span>
      <strong>{row.kind === "model" ? `${labels.purposes[row.purpose]} · ${row.modelId}` : row.title ?? row.toolName}</strong>
      <span className="oduvanchik-journal-meta">{row.durationMs !== null && labels.durationMs(row.durationMs)}{row.kind === "model" && <> · {row.cost ?? labels.costUnknown}{row.inputTokens !== null && ` · ${labels.tokens(row.inputTokens, row.cachedInputTokens ?? 0, row.outputTokens ?? 0)}`}{row.firstChunkMs !== null && ` · ${labels.firstChunk(row.firstChunkMs)}`}{row.attempt > 1 && ` · ${labels.attempt(row.attempt)}`}</>}</span>
      {row.kind === "model" && row.instructionsChanged && <span>{labels.instructionsChanged}</span>}
      {row.kind === "tool" && row.outputEdited && <span>{labels.outputEdited}</span>}
      {row.kind === "tool" && row.source === "message" && <span>{labels.fromMessage}</span>}
      {!success && <span>{row.kind === "model" ? labels.modelCallStatus[row.status] : labels.error}</span>}
      <span className="oduvanchik-journal-disclosure">{labels.settings}<CaretDownIcon aria-hidden size={14} /></span>
    </button>
    <div id={id} hidden={!row.open} className="oduvanchik-journal-details">{row.open && row.details}</div>
  </li>;
}
