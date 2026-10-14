import { cn } from "@tandem/ui";
import type {
  FlowAnyStateNodeProps,
  FlowEdgeProps,
  FlowExitRowView,
  FlowLegendProps,
  FlowStateNodeProps,
  FlowZoomControlsProps,
} from "@ykurilov/agent-chat-flows/react";
import { useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { Clock, Flag, Maximize, Minus, MoonStar, Plus, Shuffle, Tag } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { IssueBadge, KIND_COLOR, KIND_DASH, KindIcon } from "./flow-parts";

// Доска: узлы, стрелки, легенда, масштаб. Ручки и пути стрелок приходят от слоя поведения готовыми.

const activate = (handler: () => void) => (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handler();
  }
};

function ExitRow({ exit, index, handle }: { exit: FlowExitRowView; index: number; handle: ReactNode }) {
  const labels = useFlowLabels().editor;
  const broken = exit.issues.errors > 0;
  return (
    <li className="relative flex min-w-0 items-start gap-1.5 py-1 pl-3 pr-4 text-[11px] leading-snug" data-exit={exit.exitId}>
      <span className="w-3 shrink-0 tabular-nums text-[var(--foreground-subtle)]">{index + 1}</span>
      <KindIcon kind={exit.kind} className="mt-px size-3" />
      <span className={cn("min-w-0 flex-1 break-words", broken ? "text-[var(--destructive-text)]" : "text-[var(--foreground)]")}>
        {exit.text}
        {exit.target === null ? (
          <span className="ml-1 italic text-[var(--destructive-text)]">· {labels.board.noTarget}</span>
        ) : exit.kind === "return" ? (
          <span className="ml-1 text-[var(--foreground-subtle)]">↩ {labels.returnKind.toLocaleLowerCase()}</span>
        ) : null}
      </span>
      {handle}
    </li>
  );
}

function NodeCard({
  selected,
  dimmed,
  run,
  muted,
  onSelect,
  label,
  children,
}: {
  selected: boolean;
  dimmed: boolean;
  run: FlowStateNodeProps["run"];
  muted?: boolean;
  onSelect(): void;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      data-run={run ?? undefined}
      onClick={onSelect}
      onKeyDown={activate(onSelect)}
      className={cn(
        "relative w-[264px] rounded-[var(--radius-panel)] border bg-[var(--surface)] text-left shadow-[var(--shadow-sm)] outline-none transition-[opacity,box-shadow] duration-150",
        muted && "border-dashed bg-[var(--surface-muted)]",
        selected ? "border-[var(--action)] ring-2 ring-[var(--focus-ring)]" : "border-[var(--border)]",
        run === "current" && "border-[var(--warm)] ring-2 ring-[var(--warm-border)] shadow-[var(--shadow-warm)]",
        run === "visited" && "bg-[var(--cool-soft)]",
        dimmed && "opacity-35",
        "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
      )}
    >
      {children}
    </div>
  );
}

export function TandemFlowStateNode(props: FlowStateNodeProps) {
  const labels = useFlowLabels().editor;
  return (
    <NodeCard selected={props.selected} dimmed={props.dimmed} run={props.run} onSelect={props.onSelect} label={props.title}>
      {props.renderInputHandle()}
      <div className="flex flex-col gap-1 px-3 pb-2 pt-2.5">
        {(props.start || props.final || props.tags.length > 0) && (
          <div className="flex flex-wrap items-center gap-1">
            {props.start && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--cool-soft)] px-1.5 py-px text-[10px] font-medium text-[var(--cool-text)]">
                <Flag aria-hidden="true" className="size-2.5" />
                {labels.board.start}
              </span>
            )}
            {props.final && (
              <span className="rounded-full bg-[var(--surface-muted)] px-1.5 py-px text-[10px] font-medium text-[var(--foreground-muted)]">{labels.board.final}</span>
            )}
            {props.tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-[var(--warm-soft)] px-1.5 py-px text-[10px] text-[var(--warm-text)]">
                <Tag aria-hidden="true" className="size-2.5" />
                {tag}
              </span>
            ))}
          </div>
        )}
        <p className="break-words text-[13px] font-semibold leading-tight text-[var(--foreground)]">{props.title}</p>
        {props.goal && <p className="line-clamp-2 break-words text-[11px] leading-snug text-[var(--foreground-muted)]">{props.goal}</p>}
        {props.timing && (
          <p data-flow-node-timing="" className="inline-flex items-center gap-1 text-[10px] text-[var(--warm-text)]">
            <Clock aria-hidden="true" className="size-2.5 shrink-0" />
            <span className="truncate">{props.timing}</span>
          </p>
        )}
        {(props.noSideQuestions || props.issues.errors + props.issues.warnings > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--foreground-subtle)]">
            {props.noSideQuestions && (
              <span className="inline-flex items-center gap-1">
                <MoonStar aria-hidden="true" className="size-2.5" />
                {labels.board.noSideQuestions}
              </span>
            )}
            <IssueBadge issues={props.issues} className="text-[10px]" />
          </div>
        )}
      </div>
      {props.exits.length > 0 && (
        <ul className="border-t border-[var(--border)] py-1">
          {props.exits.map((exit, index) => (
            <ExitRow key={exit.exitId} exit={exit} index={index} handle={props.renderExitHandle(exit.exitId)} />
          ))}
        </ul>
      )}
    </NodeCard>
  );
}

export function TandemFlowAnyStateNode(props: FlowAnyStateNodeProps) {
  const labels = useFlowLabels().editor;
  return (
    <NodeCard selected={props.selected} dimmed={props.dimmed} run={null} muted onSelect={props.onSelect} label={labels.board.anyState}>
      <div className="flex flex-col gap-1 px-3 pb-2 pt-2.5">
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--foreground-subtle)]">
          <Shuffle aria-hidden="true" className="size-2.5" />
          {labels.anyStatePanel.title}
        </span>
        <p className="text-[13px] font-semibold leading-tight text-[var(--foreground)]">{labels.board.anyState}</p>
        {props.except.length > 0 && (
          <p className="break-words text-[11px] leading-snug text-[var(--foreground-muted)]">
            {labels.anyStatePanel.except}: {props.except.join(", ")}
          </p>
        )}
        <IssueBadge issues={props.issues} className="text-[10px]" />
      </div>
      {props.exits.length > 0 && (
        <ul className="border-t border-[var(--border)] py-1">
          {props.exits.map((exit, index) => (
            <ExitRow key={exit.exitId} exit={exit} index={index} handle={props.renderExitHandle(exit.exitId)} />
          ))}
        </ul>
      )}
    </NodeCard>
  );
}

/** Стрелка: цвет и пунктир по виду; широкая невидимая линия ловит щелчок и касание. */
export function TandemFlowEdge(props: FlowEdgeProps) {
  const color = KIND_COLOR[props.kind];
  const width = props.selected ? 3 : props.traversed ? 2.75 : 1.6;
  return (
    <g data-edge={props.edgeId} data-kind={props.kind} data-traversed={props.traversed || undefined} style={{ opacity: props.dimmed ? 0.18 : 1 }}>
      <path d={props.path} fill="none" stroke={color} strokeWidth={width} strokeDasharray={KIND_DASH[props.kind]} strokeLinecap="round" />
      <path
        d={props.path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        style={{ pointerEvents: "stroke", cursor: "pointer" }}
        onClick={props.onSelect}
      >
        <title>{props.label}</title>
      </path>
    </g>
  );
}

export function TandemFlowLegend({ kinds }: FlowLegendProps) {
  const labels = useFlowLabels().editor;
  return (
    <div className="w-[320px] rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] p-3 text-xs shadow-[var(--shadow-sm)]">
      <p className="mb-1.5 font-semibold text-[var(--foreground)]">{labels.overview.exits}</p>
      <ul className="flex flex-col gap-1">
        {kinds.map((kind) => (
          <li key={kind} className="flex items-center gap-2 text-[var(--foreground-muted)]">
            <svg aria-hidden="true" width="28" height="6" className="shrink-0">
              <line x1="1" y1="3" x2="27" y2="3" stroke={KIND_COLOR[kind]} strokeWidth="2" strokeDasharray={KIND_DASH[kind]} />
            </svg>
            {kind === "return" ? `${labels.returnKind} — ${labels.returnTarget}` : labels.conditionKindHints[kind]}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TandemFlowZoomControls({ zoom, onZoomIn, onZoomOut, onFit }: FlowZoomControlsProps) {
  const labels = useFlowLabels().editor;
  const button =
    "inline-flex size-9 items-center justify-center rounded-[var(--radius-small)] text-[var(--foreground-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]";
  return (
    <div className="flex items-center gap-0.5 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-sm)]">
      <button type="button" className={button} onClick={onZoomOut} aria-label={labels.board.zoomOut} title={labels.board.zoomOut}>
        <Minus aria-hidden="true" className="size-4" />
      </button>
      <span className="w-12 text-center text-xs tabular-nums text-[var(--foreground)]">{Math.round(zoom * 100)}%</span>
      <button type="button" className={button} onClick={onZoomIn} aria-label={labels.board.zoomIn} title={labels.board.zoomIn}>
        <Plus aria-hidden="true" className="size-4" />
      </button>
      <button type="button" className={button} onClick={onFit} aria-label={labels.board.fit} title={labels.board.fit}>
        <Maximize aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
