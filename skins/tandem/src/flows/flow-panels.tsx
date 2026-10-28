import { Badge, Button, Input, Switch, Textarea, cn } from "@tandem/ui";
import type { FlowConditionType } from "@ykurilov/agent-chat-flows/format";
import type {
  FlowAnyStatePanelProps,
  FlowCardPanelProps,
  FlowCheckPanelProps,
  FlowFieldRowProps,
  FlowOverviewPanelProps,
  FlowStateLinkView,
  FlowStatePanelProps,
} from "@ykurilov/agent-chat-flows/react";
import { useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { ChevronDown, ChevronUp, CircleAlert, Flag, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useId, type ReactNode } from "react";
import { IconButton, IssueBadge, KindIcon, Labeled, PanelShell, SectionTitle, Select } from "./flow-parts";

const KINDS: FlowConditionType[] = ["judge", "data", "event", "timer"];
const FIELD_TYPES = ["text", "number", "choice", "boolean"] as const;

const splitList = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** Отмечаемые «чипы»: «узнать здесь», инструменты, исключения общих переходов. */
function ChipToggles({ items, selected, onChange }: { items: Array<{ id: string; title: string }>; selected: string[]; onChange(ids: string[]): void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const on = selected.includes(item.id);
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((id) => id !== item.id) : [...selected, item.id])}
            className={cn(
              "min-h-8 rounded-full border px-3 text-xs font-medium transition-colors",
              on
                ? "border-[var(--action)] bg-[var(--cool-soft)] text-[var(--cool-text)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-muted)] hover:bg-[var(--surface-hover)]",
            )}
          >
            {item.title}
          </button>
        );
      })}
    </div>
  );
}

function StateLinks({ states }: { states: FlowStateLinkView[] }) {
  const labels = useFlowLabels().editor;
  return (
    <ul className="flex flex-col gap-1">
      {states.map((state) => (
        <li key={state.stateId}>
          <button
            type="button"
            onClick={state.onSelect}
            className="flex min-h-9 w-full items-center gap-2 rounded-[var(--radius-small)] px-2 text-left text-sm text-[var(--foreground)] hover:bg-[var(--surface-hover)]"
          >
            <span className="min-w-0 flex-1 truncate">{state.title}</span>
            {state.start && <Flag aria-label={labels.board.start} className="size-3.5 text-[var(--cool-text)]" />}
            {state.final && <span className="text-xs text-[var(--foreground-subtle)]">{labels.board.final}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function AddExitButtons({ onAddExit }: { onAddExit(kind: FlowConditionType): void }) {
  const labels = useFlowLabels().editor;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-[var(--foreground-muted)]">{labels.statePanel.addExit}</span>
      <div className="grid grid-cols-2 gap-1.5">
        {KINDS.map((kind) => (
          <Button key={kind} variant="secondary" size="sm" onClick={() => onAddExit(kind)} className="justify-start">
            <Plus aria-hidden="true" className="size-3.5" />
            <KindIcon kind={kind} />
            {labels.conditionKinds[kind]}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function IssueList({ issues }: { issues: Array<{ level: "error" | "warning"; message: string; code: string }> }) {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {issues.map((issue) => (
        <li
          key={`${issue.code}-${issue.message}`}
          role={issue.level === "error" ? "alert" : undefined}
          className={cn(
            "rounded-[var(--radius-small)] px-3 py-2 text-xs",
            issue.level === "error" ? "bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-[var(--destructive-text)]" : "bg-[var(--warm-soft)] text-[var(--warm-text)]",
          )}
        >
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

export function TandemFlowOverviewPanel(props: FlowOverviewPanelProps) {
  const labels = useFlowLabels().editor;
  const count = (label: string, value: number) => (
    <div className="flex flex-col rounded-[var(--radius-nested)] bg-[var(--surface-muted)] px-3 py-2">
      <span className="text-lg font-semibold tabular-nums text-[var(--foreground)]">{value}</span>
      <span className="text-xs text-[var(--foreground-muted)]">{label}</span>
    </div>
  );
  return (
    <PanelShell eyebrow={labels.overview.title} title={props.name} label={labels.overview.title} actions={<IssueBadge issues={props.issues} />}>
      <Labeled label={labels.overview.common} hint={labels.overview.commonHint}>
        <Textarea rows={6} value={props.common} onChange={(event) => props.onCommonChange(event.target.value)} />
      </Labeled>
      <div className="grid grid-cols-3 gap-2">
        {count(labels.overview.states, props.counts.states)}
        {count(labels.overview.exits, props.counts.exits)}
        {count(labels.overview.finals, props.counts.finals)}
      </div>
      <div className="flex flex-col gap-2">
        <SectionTitle>{labels.overview.lists}</SectionTitle>
        <StateLinks states={props.states} />
      </div>
      {props.sections}
    </PanelShell>
  );
}

export function TandemFlowStatePanel(props: FlowStatePanelProps) {
  const labels = useFlowLabels().editor;
  const noSideHintId = useId();
  const { onChange } = props;
  return (
    <PanelShell
      eyebrow={labels.statePanel.title}
      title={props.title || props.stateId}
      label={labels.statePanel.title}
      actions={
        <IconButton label={labels.statePanel.deleteState} onClick={props.onDelete} tone="danger">
          <Trash2 aria-hidden="true" className="size-4" />
        </IconButton>
      }
    >
      <IssueList issues={props.issues} />
      <Labeled label={labels.statePanel.name}>
        <Input value={props.title} onChange={(event) => onChange({ title: event.target.value })} />
      </Labeled>
      <Labeled label={labels.statePanel.instructions} hint={labels.statePanel.instructionsHint}>
        <Textarea rows={6} value={props.instructions} onChange={(event) => onChange({ instructions: event.target.value })} />
      </Labeled>
      {props.fields.length > 0 && (
        <details className="group/learn" data-flow-learn="">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-[var(--foreground)]">
            <span>{labels.statePanel.learnSummary?.(props.fields.filter((field) => props.learn.includes(field.id)).length, props.fields.length)
              ?? `${labels.statePanel.learn}: ${props.fields.filter((field) => props.learn.includes(field.id)).length}/${props.fields.length}`}</span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 -rotate-90 transition-transform group-open/learn:rotate-0" />
          </summary>
          <div className="pt-1.5">
            <ChipToggles
              items={props.fields.map((field) => ({ id: field.id, title: field.name || field.id }))}
              selected={props.learn}
              onChange={(learn) => onChange({ learn })}
            />
          </div>
        </details>
      )}
      <div className="flex items-center justify-between gap-3">
        {props.start ? (
          <Badge variant="cool" className="gap-1">
            <Flag aria-hidden="true" className="size-3" />
            {labels.statePanel.isStart}
          </Badge>
        ) : (
          <Button variant="secondary" size="sm" onClick={props.onMakeStart}>
            <Flag aria-hidden="true" className="size-3.5" />
            {labels.statePanel.makeStart}
          </Button>
        )}
      </div>

      {props.timing}

      <section className="flex flex-col gap-3 border-t border-[var(--border)] pt-4" aria-label={labels.statePanel.exits}>
        <h3 className="text-base font-semibold text-[var(--foreground)]">{labels.statePanel.exits}</h3>
        {props.exits}
        <AddExitButtons onAddExit={props.onAddExit} />
      </section>

      <details className="group flex flex-col gap-3 border-t border-[var(--border)] pt-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--foreground)]">
          <span className="inline-flex items-center gap-1">
            <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
            {labels.statePanel.more}
          </span>
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <Labeled label={labels.statePanel.firstMessage}>
            <Textarea
              rows={3}
              value={props.firstMessage ?? ""}
              onChange={(event) => onChange({ firstMessage: event.target.value === "" ? null : event.target.value })}
            />
          </Labeled>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-[var(--foreground)]">{labels.statePanel.tools}</span>
            <span className="text-xs text-[var(--foreground-muted)]">{labels.statePanel.toolsHint}</span>
            {props.catalogTools.length === 0 ? (
              <span className="text-xs text-[var(--foreground-subtle)]">{labels.statePanel.noTools}</span>
            ) : (
              <ChipToggles
                items={props.catalogTools.map((tool) => ({ id: tool, title: Object.hasOwn(props.toolLabels ?? {}, tool) ? props.toolLabels?.[tool] || tool : tool }))}
                selected={props.tools}
                onChange={(tools) => onChange({ tools })}
              />
            )}
          </div>
          <Labeled label={labels.statePanel.tags} hint={labels.statePanel.tagsHint}>
            <Input defaultValue={props.tags.join(", ")} key={props.tags.join(",")} onBlur={(event) => onChange({ tags: splitList(event.target.value) })} />
          </Labeled>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center justify-between gap-3 text-sm text-[var(--foreground)]">
              {labels.statePanel.noSideQuestions}
              <Switch checked={props.noSideQuestions} aria-describedby={labels.statePanel.noSideQuestionsHint ? noSideHintId : undefined} onCheckedChange={(noSideQuestions) => onChange({ noSideQuestions })} />
            </label>
            {labels.statePanel.noSideQuestionsHint && <p id={noSideHintId} className="text-xs text-[var(--foreground-muted)]">{labels.statePanel.noSideQuestionsHint}</p>}
          </div>
        </div>
      </details>
    </PanelShell>
  );
}

export function TandemFlowAnyStatePanel(props: FlowAnyStatePanelProps) {
  const labels = useFlowLabels().editor;
  return (
    <PanelShell eyebrow={labels.board.anyState} title={labels.anyStatePanel.title} label={labels.anyStatePanel.title}>
      <p className="text-sm text-[var(--foreground-muted)]">{labels.anyStatePanel.hint}</p>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-[var(--foreground)]">{labels.anyStatePanel.except}</span>
        <ChipToggles items={[...props.states.map((state) => ({ id: state.stateId, title: state.title })), ...props.except.filter((id) => !props.states.some((state) => state.stateId === id)).map((id) => ({ id, title: id }))]} selected={props.except} onChange={props.onExceptChange} />
      </div>
      <section className="flex flex-col gap-3 border-t border-[var(--border)] pt-4" aria-label={labels.statePanel.exits}>
        <h3 className="text-base font-semibold text-[var(--foreground)]">{labels.statePanel.exits}</h3>
        {props.exits}
        <AddExitButtons onAddExit={props.onAddExit} />
      </section>
    </PanelShell>
  );
}

export function TandemFlowFieldRow(props: FlowFieldRowProps) {
  const labels = useFlowLabels().editor.cardPanel;
  const fieldTypes = useFlowLabels().editor.fieldTypes;
  const exitLabels = useFlowLabels().editor.exitCard;
  const { field, onChange } = props;
  const refresh = "refreshAfterMonths" in field ? field.refreshAfterMonths : null;
  return (
    <li
      aria-label={field.name || field.id}
      data-field={field.id}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-[var(--radius-nested)] border bg-[var(--surface)] p-3",
        props.issues.some((issue) => issue.level === "error") ? "border-[var(--destructive)]" : "border-[var(--border)]",
      )}
    >
      <div className="flex items-center gap-1">
        <Input aria-label={labels.name} value={field.name} onChange={(event) => onChange({ name: event.target.value })} className="flex-1" />
        <IconButton label={exitLabels.moveUp} onClick={props.onMoveUp} disabled={!props.canMoveUp}>
          <ChevronUp aria-hidden="true" className="size-4" />
        </IconButton>
        <IconButton label={exitLabels.moveDown} onClick={props.onMoveDown} disabled={!props.canMoveDown}>
          <ChevronDown aria-hidden="true" className="size-4" />
        </IconButton>
        <IconButton label={exitLabels.delete} onClick={props.onDelete} tone="danger">
          <Trash2 aria-hidden="true" className="size-4" />
        </IconButton>
      </div>
      <Textarea aria-label={labels.about} placeholder={labels.about} rows={2} value={field.about} onChange={(event) => onChange({ about: event.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <Labeled label={labels.type}>
          <Select value={field.type} onChange={(event) => onChange({ type: event.target.value as (typeof FIELD_TYPES)[number] })}>
            {FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {fieldTypes[type]}
              </option>
            ))}
          </Select>
        </Labeled>
        {props.list === "clientCard" && (
          <Labeled label={labels.refreshAfter}>
            <Select
              value={refresh === null ? "" : String(refresh)}
              onChange={(event) => onChange({ refreshAfterMonths: event.target.value === "" ? null : Number(event.target.value) })}
            >
              <option value="">—</option>
              {[1, 3, 6, 12].map((months) => (
                <option key={months} value={months}>
                  {labels.refreshAfterMonths(months)}
                </option>
              ))}
            </Select>
          </Labeled>
        )}
      </div>
      {field.type === "choice" && (
        <Labeled label={labels.options} hint={labels.optionsHint}>
          <Input
            key={field.options.join(",")}
            defaultValue={field.options.join(", ")}
            onBlur={(event) => onChange({ options: splitList(event.target.value) })}
          />
        </Labeled>
      )}
      <IssueList issues={props.issues} />
    </li>
  );
}

function FieldSection({
  title,
  hint,
  rows,
  onAdd,
  appFields,
  onAddAppField,
}: {
  title: string;
  hint?: string;
  rows: ReactNode;
  onAdd(): void;
  appFields: Array<{ id: string; title: string }>;
  onAddAppField(fieldId: string): void;
}) {
  const labels = useFlowLabels().editor.cardPanel;
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <SectionTitle>{title}</SectionTitle>
      {hint && <p className="text-xs text-[var(--foreground-muted)]">{hint}</p>}
      <ul className="flex flex-col gap-2">{rows}</ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onAdd}>
          <Plus aria-hidden="true" className="size-3.5" />
          {labels.addField}
        </Button>
        {appFields.length > 0 && (
          <Select aria-label={`${title}: ${labels.fromApp}`} className="h-8 w-auto text-xs" value="" onChange={(event) => event.target.value && onAddAppField(event.target.value)}>
            <option value="">{labels.fromApp}</option>
            {appFields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.title}
              </option>
            ))}
          </Select>
        )}
      </div>
    </section>
  );
}

export function TandemFlowCardPanel(props: FlowCardPanelProps) {
  const labels = useFlowLabels().editor.cardPanel;
  return (
    <PanelShell eyebrow={labels.title} title={labels.title} label={labels.title}>
      {props.empty && <p className="text-sm text-[var(--foreground-muted)]">{labels.empty}</p>}
      <FieldSection
        title={labels.clientCard}
        rows={props.clientCard}
        onAdd={() => props.onAddField("clientCard")}
        appFields={props.appFields}
        onAddAppField={(fieldId) => props.onAddAppField("clientCard", fieldId)}
      />
      <FieldSection
        title={labels.chatNotes}
        hint={labels.chatNotesHint}
        rows={props.chatNotes}
        onAdd={() => props.onAddField("chatNotes")}
        appFields={props.appFields}
        onAddAppField={(fieldId) => props.onAddAppField("chatNotes", fieldId)}
      />
      <section className="flex flex-col gap-2 border-t border-[var(--border)] pt-4">
        <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
          {labels.pace}
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            className="w-20"
            value={props.sideQuestionEveryMessages}
            onChange={(event) => Number(event.target.value) > 0 && props.onPaceChange(Number(event.target.value))}
          />
        </label>
        <p className="text-xs text-[var(--foreground-muted)]">{labels.paceHint}</p>
      </section>
    </PanelShell>
  );
}

export function TandemFlowCheckPanel({ issues }: FlowCheckPanelProps) {
  const labels = useFlowLabels().editor.checkPanel;
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");
  const group = (title: string, list: typeof issues, Icon: typeof CircleAlert, tone: string) =>
    list.length > 0 && (
      <section className="flex flex-col gap-2" aria-label={title}>
        <SectionTitle>
          {title} · {list.length}
        </SectionTitle>
        <ul className="flex flex-col gap-1.5">
          {list.map((issue, index) => (
            <li key={`${issue.code}-${index}`}>
              <button
                type="button"
                onClick={issue.onGo}
                className="flex w-full items-start gap-2 rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface)] p-3 text-left text-sm hover:bg-[var(--surface-hover)]"
              >
                <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", tone)} />
                <span className="min-w-0 flex-1 break-words text-[var(--foreground)]">{issue.message}</span>
                <span className="shrink-0 text-xs text-[var(--action)]">{labels.goTo}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <PanelShell eyebrow={labels.title} title={labels.title} label={labels.title}>
      {issues.length === 0 && <p className="text-sm text-[var(--success-text)]">{labels.clean}</p>}
      {group(labels.errors, errors, CircleAlert, "text-[var(--destructive-text)]")}
      {group(labels.warnings, warnings, TriangleAlert, "text-[var(--warm-text)]")}
    </PanelShell>
  );
}
