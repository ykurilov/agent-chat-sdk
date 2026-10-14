import { Badge, Button, TandemMark, cn } from "@tandem/ui";
import type { FlowEditorFrameProps, FlowHeaderProps } from "@ykurilov/agent-chat-flows/react";
import { useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { Braces, IdCard, MessagesSquare, Play, Plus, Save, ShieldCheck, Shuffle } from "lucide-react";
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

/** Раскладка: шапка 64px, доска и панель 400px справа; на узком экране панель уходит вниз. */
export function TandemFlowEditorFrame({ header, board, panel, dialog }: FlowEditorFrameProps) {
  return (
    <div
      data-flow-editor=""
      className="grid h-full min-h-0 w-full grid-cols-[minmax(0,1fr)_400px] grid-rows-[64px_minmax(0,1fr)] bg-[var(--canvas)] text-[var(--foreground)] max-[860px]:grid-cols-1 max-[860px]:grid-rows-[auto_minmax(0,1fr)_46vh]"
      style={BOARD_COLORS}
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
function FlowName({ name, onRename }: Pick<FlowHeaderProps, "name" | "onRename">) {
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
  const { mode, onModeChange, issues } = props;
  const toggle = (target: "check" | "run") => onModeChange(mode === target ? "edit" : target);
  const compact = "max-[1100px]:[&>span.label]:hidden";
  // На телефоне подписи прячутся у всех кнопок, иначе «Сохранить» уезжает за край.
  const phone = "max-[860px]:[&>span.label]:hidden";
  return (
    <div className="flex h-full min-w-0 items-center gap-2 px-4 max-[860px]:flex-wrap max-[860px]:gap-1.5 max-[860px]:py-2">
      <TandemMark className="size-7 shrink-0" />
      <FlowName name={props.name} onRename={props.onRename} />
      <div className="flex shrink-0 items-center gap-1.5 max-[860px]:w-full max-[860px]:overflow-x-auto">
        <Button variant="secondary" size="sm" className={compact} onClick={props.onAddState} disabled={mode === "run"} title={labels.header.state}>
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
        {props.onOpenTestChat && (
          <Button variant="ghost" size="sm" className={phone} onClick={props.onOpenTestChat} title={testChatLabels.title}>
            <MessagesSquare aria-hidden="true" className="size-4" />
            <span className="label">{testChatLabels.title}</span>
          </Button>
        )}
        {props.onSave && (
          <Button
            variant={props.dirty ? "primary" : "ghost"}
            size="sm"
            className={phone}
            loading={props.saving}
            disabled={props.saving || !props.dirty}
            onClick={props.onSave}
            title={props.dirty ? labels.header.unsaved : labels.header.saved}
          >
            <Save aria-hidden="true" className="size-4" />
            <span className="label">{props.dirty ? labels.header.save : labels.header.saved}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
