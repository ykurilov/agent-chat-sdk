import { Button, cn } from "./controls";
import type {
  FlowAnyStateNodeProps,
  FlowEdgeProps,
  FlowExitRowView,
  FlowBoardToggleProps,
  FlowLegendProps,
  FlowStateNodeProps,
  FlowZoomControlsProps,
} from "@ykurilov/agent-chat-flows/react";
import { useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { QuestionIcon as CircleHelp, ClockIcon as Clock, FlagIcon as Flag, MapTrifoldIcon as MapIcon, ArrowsOutIcon as Maximize, MinusIcon as Minus, MoonStarsIcon as MoonStar, SidebarSimpleIcon as PanelRightClose, SidebarSimpleIcon as PanelRightOpen, PlusIcon as Plus, ShuffleIcon as Shuffle, TagIcon as Tag } from "@phosphor-icons/react";
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
      <span className="w-3 shrink-0 font-mono tabular-nums text-[var(--yk-muted)]">{index + 1}</span>
      <KindIcon kind={exit.kind} className="mt-px size-3" />
      <span className={cn("min-w-0 flex-1 break-words", broken ? "text-[var(--yk-danger)]" : "text-[var(--yk-text)]")}>
        {exit.text}
        {exit.target === null ? (
          <span className="ml-1 italic text-[var(--yk-danger)]">· {labels.board.noTarget}</span>
        ) : exit.kind === "return" ? (
          <span className="ml-1 text-[var(--yk-muted)]"><KindIcon kind="return" /> {labels.returnKind.toLocaleLowerCase()}</span>
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
        "relative w-[264px] rounded-[var(--yk-radius-lg)] border bg-[var(--yk-surface)] text-left shadow-none outline-none transition-[opacity,box-shadow] duration-150",
        muted && "border-dashed bg-[var(--yk-surface-2)]",
        selected ? "border-[var(--yk-accent)] ring-2 ring-[var(--yk-accent)]" : "border-[var(--yk-border)]",
        run === "current" && "border-[var(--yk-accent)] ring-2 ring-[var(--yk-accent)] shadow-none",
        run === "visited" && "bg-[var(--yk-surface-2)]",
        dimmed && "opacity-35",
        "focus-visible:ring-2 focus-visible:ring-[var(--yk-accent)]",
      )}
    >
      {children}
    </div>
  );
}

export function OduvanchikFlowStateNode(props: FlowStateNodeProps) {
  const labels = useFlowLabels().editor;
  return (
    <NodeCard selected={props.selected} dimmed={props.dimmed} run={props.run} onSelect={props.onSelect} label={props.title}>
      {props.renderInputHandle()}
      <div className="flex flex-col gap-1 px-3 pb-2 pt-2.5">
        {(props.start || props.final || props.tags.length > 0) && (
          <div className="flex flex-wrap items-center gap-1">
            {props.start && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--yk-surface-2)] px-1.5 py-px text-[10px] font-medium text-[var(--yk-muted)]">
                <Flag aria-hidden="true" className="size-2.5" />
                {labels.board.start}
              </span>
            )}
            {props.final && (
              <span className="rounded-full bg-[var(--yk-surface-2)] px-1.5 py-px text-[10px] font-medium text-[var(--yk-muted)]">{labels.board.final}</span>
            )}
            {props.tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-[var(--yk-accent-soft)] px-1.5 py-px text-[10px] text-[var(--yk-accent-text)]">
                <Tag aria-hidden="true" className="size-2.5" />
                {tag}
              </span>
            ))}
          </div>
        )}
        <p className="break-words text-[13px] font-semibold leading-tight text-[var(--yk-text)]">{props.title}</p>
        {props.goal && <p className="line-clamp-2 break-words text-[11px] leading-snug text-[var(--yk-muted)]">{props.goal}</p>}
        {props.timing && (
          <p data-flow-node-timing="" className="inline-flex items-center gap-1 text-[10px] text-[var(--yk-accent-text)]">
            <Clock aria-hidden="true" className="size-2.5 shrink-0" />
            <span className="truncate">{props.timing}</span>
          </p>
        )}
        {(props.noSideQuestions || props.issues.errors + props.issues.warnings > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--yk-muted)]">
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
        <ul className="border-t border-[var(--yk-border)] py-1">
          {props.exits.map((exit, index) => (
            <ExitRow key={exit.exitId} exit={exit} index={index} handle={props.renderExitHandle(exit.exitId)} />
          ))}
        </ul>
      )}
    </NodeCard>
  );
}

export function OduvanchikFlowAnyStateNode(props: FlowAnyStateNodeProps) {
  const labels = useFlowLabels().editor;
  return (
    <NodeCard selected={props.selected} dimmed={props.dimmed} run={null} muted onSelect={props.onSelect} label={labels.board.anyState}>
      <div className="flex flex-col gap-1 px-3 pb-2 pt-2.5">
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--yk-muted)]">
          <Shuffle aria-hidden="true" className="size-2.5" />
          {labels.anyStatePanel.title}
        </span>
        <p className="text-[13px] font-semibold leading-tight text-[var(--yk-text)]">{labels.board.anyState}</p>
        {props.except.length > 0 && (
          <p className="break-words text-[11px] leading-snug text-[var(--yk-muted)]">
            {labels.anyStatePanel.except}: {props.except.join(", ")}
          </p>
        )}
        <IssueBadge issues={props.issues} className="text-[10px]" />
      </div>
      {props.exits.length > 0 && (
        <ul className="border-t border-[var(--yk-border)] py-1">
          {props.exits.map((exit, index) => (
            <ExitRow key={exit.exitId} exit={exit} index={index} handle={props.renderExitHandle(exit.exitId)} />
          ))}
        </ul>
      )}
    </NodeCard>
  );
}

/** Стрелка: цвет и пунктир по виду; широкая невидимая линия ловит щелчок и касание. */
export function OduvanchikFlowEdge(props: FlowEdgeProps) {
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

export function OduvanchikFlowLegend({ kinds }: FlowLegendProps) {
  const labels = useFlowLabels().editor;
  return (
    <div className="w-[320px] rounded-[var(--yk-radius-lg)] border border-[var(--yk-border)] bg-[var(--yk-surface)] p-3 text-xs shadow-none">
      <p className="mb-1.5 font-semibold text-[var(--yk-text)]">{labels.overview.exits}</p>
      <ul className="flex flex-col gap-1">
        {kinds.map((kind) => (
          <li key={kind} className="flex items-center gap-2 text-[var(--yk-muted)]">
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

export function OduvanchikFlowZoomControls({ zoom, onZoomIn, onZoomOut, onFit }: FlowZoomControlsProps) {
  const labels = useFlowLabels().editor;
  const button =
    "inline-flex size-9 items-center justify-center rounded-[var(--yk-radius-sm)] text-[var(--yk-muted)] hover:bg-[var(--yk-surface-2)] hover:text-[var(--yk-text)]";
  return (
    <div className="flex items-center gap-0.5 rounded-[var(--yk-radius-md)] border border-[var(--yk-border)] bg-[var(--yk-surface)] p-1 shadow-none">
      <Button variant="ghost" size="sm" type="button" className={button} onClick={onZoomOut} aria-label={labels.board.zoomOut} title={labels.board.zoomOut}>
        <Minus aria-hidden="true" className="size-4" />
      </Button>
      <span className="w-12 text-center text-xs font-mono tabular-nums text-[var(--yk-text)]">{Math.round(zoom * 100)}%</span>
      <Button variant="ghost" size="sm" type="button" className={button} onClick={onZoomIn} aria-label={labels.board.zoomIn} title={labels.board.zoomIn}>
        <Plus aria-hidden="true" className="size-4" />
      </Button>
      <Button variant="ghost" size="sm" type="button" className={button} onClick={onFit} aria-label={labels.board.fit} title={labels.board.fit}>
        <Maximize aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}

/** Кнопка места на доске: легенда, мини-карта, панель «Сценарий». */
export function OduvanchikFlowBoardToggle({ kind, label, expanded, showText, onClick }: FlowBoardToggleProps) {
  const Icon = kind === "legend" ? CircleHelp : kind === "minimap" ? MapIcon : expanded ? PanelRightClose : PanelRightOpen;
  return (
    <Button variant="ghost" size="sm"
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      data-flow-board-toggle={kind}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--yk-radius-md)] border border-[var(--yk-border)] bg-[var(--yk-surface)] text-xs text-[var(--yk-muted)] shadow-none hover:bg-[var(--yk-surface-2)] hover:text-[var(--yk-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--yk-accent)]",
        showText ? "px-3" : "w-9",
        expanded && "text-[var(--yk-text)]",
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
      {showText && <span>{label}</span>}
    </Button>
  );
}
