import { Badge, Button, TandemMark, cn } from "@tandem/ui";
import type { FlowEditorFrameProps, FlowHeaderProps } from "@ykurilov/agent-chat-flows/react";
import { useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { Braces, Eye, IdCard, Maximize2, MessagesSquare, Minimize2, Play, Plus, Save, ShieldCheck, Shuffle } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

/** Цвета доски для стилей `@xyflow/react` слоя поведения: из токенов Тандема, светлая и тёмная тема сами. */
const BOARD_COLORS = {
  "--flow-board-dots": "color-mix(in oklab, var(--foreground-subtle) 45%, transparent)",
  "--flow-board-handle": "var(--action)",
  "--flow-board-handle-fill": "var(--surface)",
  "--flow-board-connection": "var(--action)",
  "--flow-board-minimap": "var(--surface)",
  "--flow-board-minimap-mask": "color-mix(in oklab, var(--action) 10%, transparent)",
  "--flow-board-minimap-node": "var(--border-strong)",
} as CSSProperties;

/**
 * Раскладка: шапка 64px, доска и панель 400px справа; на узком экране панель уходит вниз.
 * Высота — родителя, но не меньше разумной: у родителя без высоты и на телефоне холст не схлопывается. Свои `className`
 * и `style` приложения идут последними и перебивают это (`min-h-0`, `style={{ height: 720 }}`).
 */
export function TandemFlowEditorFrame({ header, board, panel, dialog, className, style, compact }: FlowEditorFrameProps) {
  const withPanel = panel !== null;
  return (
    <div
      data-flow-editor=""
      data-flow-compact={compact ? "" : undefined}
      className={cn(
        "grid h-full min-h-[max(420px,60vh)] w-full bg-[var(--canvas)] text-[var(--foreground)] max-[860px]:min-h-[max(640px,100svh)] max-[860px]:grid-cols-1",
        withPanel ? "grid-cols-[minmax(0,1fr)_400px]" : "grid-cols-[minmax(0,1fr)]",
        compact ? "grid-rows-[48px_minmax(0,1fr)]" : "grid-rows-[64px_minmax(0,1fr)]",
        withPanel ? "max-[860px]:grid-rows-[auto_minmax(0,1fr)_46vh]" : "max-[860px]:grid-rows-[auto_minmax(0,1fr)]",
        className,
      )}
      style={{ ...BOARD_COLORS, ...style }}
    >
      <div className="col-span-full min-w-0 border-b border-[var(--border)] bg-[var(--surface)]">{header}</div>
      <div className="relative min-h-0 min-w-0" data-flow-board="">
        {board}
      </div>
      {panel !== null && (
        <aside className="flex min-h-0 min-w-0 flex-col border-l border-[var(--border)] bg-[var(--surface)] max-[860px]:border-l-0 max-[860px]:border-t">
          {panel}
        </aside>
      )}
      {dialog}
    </div>
  );
}

/** Название сценария: правится по месту, сохраняется по уходу с поля или Enter. */
function FlowName({ name, onRename, readOnly }: Pick<FlowHeaderProps, "name" | "onRename" | "readOnly">) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== name) onRename(next);
    else setDraft(name);
  };
  return (
    <input
      aria-label={name}
      readOnly={readOnly}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="min-w-0 flex-1 truncate rounded-[var(--radius-small)] bg-transparent px-1.5 py-1 text-base font-semibold text-[var(--foreground)] outline-none hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
    />
  );
}

export function TandemFlowHeader(props: FlowHeaderProps) {
  const { editor: labels, testChat: testChatLabels } = useFlowLabels();
  const { mode, onModeChange, issues, compact: narrow } = props;
  const toggle = (target: "check" | "run") => onModeChange(mode === target ? "edit" : target);
  const compact = "max-[1100px]:[&>span.label]:hidden";
  // На телефоне подписи прячутся у всех кнопок, иначе «Сохранить» уезжает за край.
  const phone = "max-[860px]:[&>span.label]:hidden";
  return (
    <div className="flex h-full min-w-0 items-center gap-2 px-4 max-[860px]:flex-wrap max-[860px]:gap-1.5 max-[860px]:py-2">
      {!narrow && <TandemMark className="size-7 shrink-0" />}
      {!narrow && <FlowName name={props.name} onRename={props.onRename} readOnly={props.readOnly} />}
      {props.readOnly && (
        <Badge variant="warm" className="shrink-0" title={labels.header.readOnlyHint} data-flow-read-only-badge="">
          <Eye aria-hidden="true" className="mr-1 size-3.5" />
          {labels.header.readOnly}
        </Badge>
      )}
      <div className="flex shrink-0 items-center gap-1.5 max-[860px]:w-full max-[860px]:gap-1 max-[860px]:overflow-x-auto">
        <Button variant="secondary" size="sm" className={compact} onClick={props.onAddState} disabled={mode === "run" || props.readOnly} title={labels.header.state}>
          <Plus aria-hidden="true" className="size-4" />
          <span className="label">{labels.header.state}</span>
        </Button>
        <Button variant="secondary" size="sm" className={compact} onClick={props.onOpenCard} disabled={mode === "run"} title={labels.header.card}>
          <IdCard aria-hidden="true" className="size-4" />
          <span className="label">{labels.header.card}</span>
        </Button>
        <Button
          variant={mode === "check" ? "primary" : "secondary"}
          size="sm"
          className={compact}
          aria-pressed={mode === "check"}
          onClick={() => toggle("check")}
          title={labels.header.check}
        >
          <ShieldCheck aria-hidden="true" className="size-4" />
          <span className="label">{labels.header.check}</span>
          {issues.errors > 0 && (
            <Badge variant="warm" className="ml-0.5 px-1.5 py-0 text-[11px]" aria-label={labels.board.errors(issues.errors)}>
              {issues.errors}
            </Badge>
          )}
        </Button>
        <Button
          variant={mode === "run" ? "secondary" : "warm"}
          size="sm"
          className={cn(compact, mode === "run" && "ring-2 ring-[var(--warm-border)]")}
          aria-pressed={mode === "run"}
          onClick={() => toggle("run")}
          title={labels.header.run}
        >
          <Play aria-hidden="true" className="size-4" />
          <span className="label">{labels.header.run}</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onOpenJson} title={labels.header.json} aria-label={labels.header.json}>
          <Braces aria-hidden="true" className="size-4" />
        </Button>
        {props.onOpenMigrate && (
          <Button variant="ghost" size="sm" onClick={props.onOpenMigrate} title={labels.header.migrate} aria-label={labels.header.migrate}>
            <Shuffle aria-hidden="true" className="size-4" />
          </Button>
        )}
        {props.fullscreen && (
          <Button
            variant="ghost"
            size="sm"
            data-flow-fullscreen-toggle=""
            aria-pressed={props.fullscreen.active}
            onClick={props.fullscreen.onToggle}
            title={props.fullscreen.active ? labels.board.space.exitFullscreen : labels.board.space.enterFullscreen}
            aria-label={props.fullscreen.active ? labels.board.space.exitFullscreen : labels.board.space.enterFullscreen}
          >
            {props.fullscreen.active ? <Minimize2 aria-hidden="true" className="size-4" /> : <Maximize2 aria-hidden="true" className="size-4" />}
          </Button>
        )}
        {props.onOpenTestChat && (
          <Button variant="ghost" size="sm" className={phone} onClick={props.onOpenTestChat} title={testChatLabels.title}>
            <MessagesSquare aria-hidden="true" className="size-4" />
            <span className="label">{testChatLabels.title}</span>
          </Button>
        )}
        {props.onSave && (
          <Button
            variant={props.saveFailed ? "secondary" : props.dirty ? "primary" : "ghost"}
            size="sm"
            className={cn(phone, props.saveFailed && "border-[var(--destructive)] text-[var(--destructive-text)]")}
            loading={props.saving}
            disabled={props.saving || !props.dirty}
            onClick={props.onSave}
            title={props.saveFailed ? labels.header.saveFailedHint : props.dirty ? labels.header.unsaved : labels.header.saved}
            data-save-failed={props.saveFailed ? "" : undefined}
          >
            <Save aria-hidden="true" className="size-4" />
            <span className="label">{props.saveFailed ? labels.header.saveFailed : props.dirty ? labels.header.save : labels.header.saved}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
