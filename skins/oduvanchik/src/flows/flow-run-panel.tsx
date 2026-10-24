import { Button, Input, cn } from "./controls";
import type { FlowRunPanelProps } from "@ykurilov/agent-chat-flows/react";
import { useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { ArrowRightIcon as ArrowRight, ChatCircleDotsIcon as MessageCircleQuestion, ArrowCounterClockwiseIcon as RotateCcw, ArrowUUpLeftIcon as Undo2 } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { IconButton, KindIcon, PanelShell, SectionTitle } from "./flow-parts";

/** Поле «что агент знает»: пишется по уходу с поля или Enter, чтобы прогон не прыгал на каждую букву. */
function KnownInput({ value, label, placeholder, onChange }: { value: string | null; label: string; placeholder: string; onChange(value: string): void }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  return (
    <Input
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== (value ?? "") && onChange(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="h-9"
    />
  );
}

/** Прогон: где агент, «что произошло?» с целями от движка, «ничего из этого», что агент знает, путь. */
export function OduvanchikFlowRunPanel(props: FlowRunPanelProps) {
  const labels = useFlowLabels().editor;
  const run = labels.runPanel;
  return (
    <PanelShell
      eyebrow={run.step(props.path.length)}
      title={run.current}
      label={run.title}
      actions={
        <>
          <IconButton label={run.back} onClick={props.onBack} disabled={!props.canGoBack}>
            <Undo2 aria-hidden="true" className="size-4" />
          </IconButton>
          <IconButton label={run.restart} onClick={props.onRestart}>
            <RotateCcw aria-hidden="true" className="size-4" />
          </IconButton>
        </>
      }
    >
      <div data-run-current={props.current.stateId} className="rounded-[var(--yk-radius-lg)] border border-[var(--yk-accent)] bg-[var(--yk-accent-soft)] p-4">
        <p className="break-words text-lg font-semibold text-[var(--yk-text)]">{props.current.title}</p>
        {props.current.goal && <p className="mt-1 break-words text-sm text-[var(--yk-muted)]">{props.current.goal}</p>}
      </div>

      <section className="flex flex-col gap-2" aria-label={run.whatHappened}>
        <SectionTitle>{run.whatHappened}</SectionTitle>
        <ul className="flex flex-col gap-1.5">
          {props.choices.map((choice) => (
            <li key={choice.exitId}>
              <Button variant="ghost" size="sm"
                type="button"
                onClick={choice.onChoose}
                disabled={choice.target === null}
                data-choice={choice.exitId}
                className="h-auto whitespace-normal flex w-full items-start gap-3 rounded-[var(--yk-radius-lg)] border border-[var(--yk-border)] bg-[var(--yk-surface)] p-3 text-left hover:border-[var(--yk-accent)] hover:bg-[var(--yk-surface-2)] disabled:cursor-not-allowed disabled:opacity-55"
              >
                <KindIcon kind={choice.kind} className="mt-0.5 size-4" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="break-words text-sm text-[var(--yk-text)]">{choice.text}</span>
                  <span className={cn("inline-flex items-center gap-1 text-xs", choice.target === null ? "text-[var(--yk-danger)]" : "text-[var(--yk-muted)]")}>
                    <ArrowRight aria-hidden="true" className="size-3" />
                    {choice.target ?? run.wontFire}
                  </span>
                </span>
              </Button>
            </li>
          ))}
          <li>
            <Button variant="ghost" size="sm"
              type="button"
              onClick={props.onNothing}
              className="h-auto whitespace-normal flex w-full items-start gap-3 rounded-[var(--yk-radius-lg)] border border-dashed border-[var(--yk-border-strong)] bg-[var(--yk-surface)] p-3 text-left hover:bg-[var(--yk-surface-2)]"
            >
              <ArrowRight aria-hidden="true" className="mt-0.5 size-4 text-[var(--yk-muted)]" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm text-[var(--yk-text)]">{run.nothing}</span>
                <span className="text-xs text-[var(--yk-muted)]"><ArrowRight aria-hidden="true" className="inline size-3" /> {run.stay}</span>
              </span>
            </Button>
          </li>
        </ul>
      </section>

      {props.nextQuestion && (
        <p className="flex items-start gap-2 rounded-[var(--yk-radius-lg)] bg-[var(--yk-surface-2)] p-3 text-sm text-[var(--yk-muted)]">
          <MessageCircleQuestion aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {run.nextQuestion}: <strong className="font-semibold">{props.nextQuestion}</strong>
          </span>
        </p>
      )}

      {props.known.length > 0 && (
        <section className="flex flex-col gap-2" aria-label={run.known}>
          <SectionTitle>{run.known}</SectionTitle>
          <ul className="flex flex-col gap-1.5">
            {props.known.map((field) => (
              <li key={field.fieldId} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-2">
                <span className={cn("truncate text-sm", field.stale ? "text-[var(--yk-accent-text)]" : "text-[var(--yk-text)]")}>{field.name}</span>
                <KnownInput value={field.value} label={field.name} placeholder={run.notYet} onChange={field.onChange} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2" aria-label={run.path}>
        <SectionTitle>{run.path}</SectionTitle>
        <ol className="flex flex-col gap-1 text-sm">
          {props.path.map((step, index) => (
            <li key={`${step.stateId}-${index}`} className="flex min-w-0 items-baseline gap-2">
              <span className="w-5 shrink-0 text-right font-mono tabular-nums text-xs text-[var(--yk-muted)]">{index + 1}</span>
              <span className="min-w-0 break-words">
                <span className="text-[var(--yk-text)]">{step.title}</span>
                {step.via && <span className="text-xs text-[var(--yk-muted)]"> · {step.via}</span>}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <Button variant="secondary" onClick={props.onFinish} className="self-start">
        {run.finish}
      </Button>
    </PanelShell>
  );
}
