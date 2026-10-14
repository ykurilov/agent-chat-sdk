import { Button } from "@tandem/ui";
import type { FlowTestChatFrameProps } from "@ykurilov/agent-chat-flows/react";
import { useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { Clock, RotateCcw, Sunrise, X } from "lucide-react";
import { IconButton } from "./flow-parts";

/** Тестовый чат в панели рядом с доской: где агент, часы чата с перемоткой и сам чат приложения. */
export function TandemFlowTestChatFrame(props: FlowTestChatFrameProps) {
  const labels = useFlowLabels().testChat;
  return (
    <section aria-label={labels.title} data-flow-test-chat="" className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-2 border-b border-[var(--border)] px-5 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--foreground-subtle)]">{labels.title}</p>
          <p className="mt-1 text-xs text-[var(--foreground-muted)]">{labels.state}</p>
          <h2 data-flow-test-state="" className="break-words text-lg font-semibold text-[var(--foreground)]">
            {props.stateTitle}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label={labels.reset} onClick={props.onReset} disabled={props.busy}>
            <RotateCcw aria-hidden="true" className="size-4" />
          </IconButton>
          <IconButton label={labels.close} onClick={props.onClose}>
            <X aria-hidden="true" className="size-4" />
          </IconButton>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-5 py-2.5 text-sm">
        <Clock aria-hidden="true" className="size-4 text-[var(--foreground-subtle)]" />
        <span className="text-[var(--foreground-muted)]">{labels.clock}:</span>
        <span data-flow-test-clock="" className="mr-auto font-medium tabular-nums text-[var(--foreground)]">
          {props.clock}
        </span>
        {props.day && (
          <span data-flow-test-day="" className="w-full text-xs font-medium text-[var(--warm-text)] sm:order-first sm:w-auto">
            {props.day}
          </span>
        )}
        {props.advanceSteps.map((step) => (
          <Button key={step.ms} variant="secondary" size="sm" disabled={props.busy} onClick={() => props.onAdvance(step.ms)}>
            {labels.advance(step.label)}
          </Button>
        ))}
        {props.onNextDay && (
          <Button variant="secondary" size="sm" disabled={props.busy} onClick={props.onNextDay}>
            <Sunrise aria-hidden="true" className="size-3.5" />
            {labels.nextDay}
          </Button>
        )}
      </div>
      {props.failed && (
        <p role="alert" className="mx-5 mt-2 rounded-[var(--radius-small)] bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] px-3 py-2 text-xs text-[var(--destructive-text)]">
          {labels.failed}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{props.children}</div>
    </section>
  );
}
