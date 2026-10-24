import { Input, Textarea, cn } from "@tandem/ui";
import type { FlowCondition, FlowConditionType } from "@ykurilov/agent-chat-flows/format";
import type { FlowExitCardProps } from "@ykurilov/agent-chat-flows/react";
import { useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { IconButton, KindIcon, Labeled, Select } from "./flow-parts";

const KINDS: FlowConditionType[] = ["judge", "data", "event", "timer"];
const EVENTS = ["message", "button", "tool", "app"] as const;
const SPANS = ["in_state", "silence", "since_start", "time_of_day"] as const;
const UNITS = ["min", "h", "d"] as const;

/**
 * Карточка условия: вид (словами, данные, событие, таймер), его настройки и «куда». Меняется одно поле — годным
 * условие делает слой поведения (`normalizeCondition`): при смене вида достаточно передать `{ type }`.
 */
export function TandemFlowExitCard(props: FlowExitCardProps) {
  const labels = useFlowLabels().editor;
  const { when } = props;
  const change = (next: FlowCondition) => props.onChange({ when: next, to: props.to });
  const errors = props.issues.filter((issue) => issue.level === "error");
  const index = props.exitId;

  return (
    <article
      aria-label={labels.exitCard.when}
      data-exit-card={index}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-[var(--radius-nested)] border bg-[var(--surface)] p-3",
        errors.length > 0 ? "border-[var(--destructive)]" : "border-[var(--border)]",
      )}
    >
      {props.summary && <p data-flow-exit-summary="" className="text-sm font-medium text-[var(--foreground)]">{props.summary}</p>}
      <div className="flex items-center gap-1">
        <div role="radiogroup" aria-label={labels.exitCard.when} className="flex min-w-0 flex-1 flex-wrap gap-0.5 rounded-[var(--radius-control)] bg-[var(--surface-muted)] p-0.5">
          {KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={when.type === kind}
              onClick={() => when.type !== kind && change({ type: kind } as FlowCondition)}
              className={cn(
                "inline-flex min-h-8 flex-1 items-center justify-center gap-1 rounded-[calc(var(--radius-control)-2px)] px-2 text-xs font-medium",
                when.type === kind ? "bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--shadow-xs)]" : "text-[var(--foreground-muted)]",
              )}
            >
              <KindIcon kind={kind} />
              {labels.conditionKinds[kind]}
            </button>
          ))}
        </div>
        <IconButton label={labels.exitCard.moveUp} onClick={props.onMoveUp} disabled={!props.canMoveUp}>
          <ChevronUp aria-hidden="true" className="size-4" />
        </IconButton>
        <IconButton label={labels.exitCard.moveDown} onClick={props.onMoveDown} disabled={!props.canMoveDown}>
          <ChevronDown aria-hidden="true" className="size-4" />
        </IconButton>
        <IconButton label={labels.exitCard.delete} onClick={props.onDelete} tone="danger">
          <Trash2 aria-hidden="true" className="size-4" />
        </IconButton>
      </div>

      {when.type === "judge" && (
        <Textarea
          aria-label={labels.exitCard.when}
          rows={2}
          value={when.text}
          placeholder={labels.board.emptyCondition}
          onChange={(event) => change({ ...when, text: event.target.value })}
        />
      )}

      {when.type === "data" && <DataSettings {...props} when={when} change={change} />}

      {when.type === "event" && (
        <div className="grid grid-cols-2 gap-2">
          <Labeled label={labels.exitCard.event}>
            <Select value={when.event} onChange={(event) => change({ type: "event", event: event.target.value as (typeof EVENTS)[number] })}>
              {EVENTS.map((event) => (
                <option key={event} value={event}>
                  {labels.events[event]}
                </option>
              ))}
            </Select>
          </Labeled>
          {when.event !== "message" && (
            <Labeled label={labels.exitCard.eventName}>
              <Select value={when.name ?? ""} onChange={(event) => change({ ...when, name: event.target.value })}>
                <option value="" />
                {[...new Set([...props.eventNames[when.event], ...(when.name ? [when.name] : [])])].map((name) => (
                  <option key={name} value={name}>
                    {(when.event !== "tool" && props.eventLabels?.[name]) || name}
                  </option>
                ))}
              </Select>
            </Labeled>
          )}
        </div>
      )}

      {when.type === "timer" && (
        <div className="grid grid-cols-2 gap-2">
          <Labeled label={labels.exitCard.timer} className="col-span-2">
            <Select value={when.from} onChange={(event) => change({ ...when, from: event.target.value } as FlowCondition)}>
              {SPANS.map((span) => (
                <option key={span} value={span}>
                  {labels.timerSpans[span]}
                </option>
              ))}
              <option value="state_days">{`${labels.statePanel.duration}, ${labels.statePanel.durationUnits.d}`}</option>
              <option value="program_day">{`${labels.statePanel.duration}, ${labels.statePanel.durationUnits.program_day}`}</option>
            </Select>
          </Labeled>
          {when.from === "time_of_day" ? (
            <Labeled label={labels.exitCard.at}>
              <Input type="time" value={when.at} onChange={(event) => event.target.value && change({ ...when, at: event.target.value })} />
            </Labeled>
          ) : when.from === "state_days" || when.from === "program_day" ? (
            <Labeled label={labels.exitCard.amount}>
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                value={when.from === "state_days" ? when.days : when.day}
                onChange={(event) => {
                  const days = Number(event.target.value);
                  if (Number.isInteger(days) && days > 0) change(when.from === "state_days" ? { ...when, days } : { ...when, day: days });
                }}
              />
            </Labeled>
          ) : (
            <>
              <Labeled label={labels.exitCard.amount}>
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={when.amount}
                  onChange={(event) => {
                    const amount = Number(event.target.value);
                    if (amount > 0) change({ ...when, amount });
                  }}
                />
              </Labeled>
              <Labeled label={"\u00a0"}>
                <Select aria-label={labels.exitCard.amount} value={when.unit} onChange={(event) => change({ ...when, unit: event.target.value as (typeof UNITS)[number] })}>
                  {UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {labels.units[unit]}
                    </option>
                  ))}
                </Select>
              </Labeled>
            </>
          )}
        </div>
      )}

      <Labeled label={labels.exitCard.to}>
        <Select value={props.to ?? ""} onChange={(event) => props.onChange({ when, to: event.target.value || null })} aria-invalid={props.to === null || undefined}>
          <option value="">{labels.board.noTarget}</option>
          {props.targets.map((target) => (
            <option key={target.value} value={target.value}>
              {target.title}
            </option>
          ))}
        </Select>
      </Labeled>

      {props.issues.length > 0 && (
        <ul className="flex flex-col gap-1">
          {props.issues.map((issue) => (
            <li
              key={`${issue.code}-${issue.message}`}
              role={issue.level === "error" ? "alert" : undefined}
              className={cn("break-words text-xs", issue.level === "error" ? "text-[var(--destructive-text)]" : "text-[var(--warm-text)]")}
            >
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function DataSettings(props: FlowExitCardProps & { when: Extract<FlowCondition, { type: "data" }>; change(next: FlowCondition): void }) {
  const labels = useFlowLabels().editor;
  const { when, change } = props;
  const field = props.fields.find((candidate) => candidate.id === when.field);
  return (
    <div className="grid grid-cols-2 gap-2">
      <Labeled label={labels.exitCard.field} className="col-span-2">
        <Select value={when.field} onChange={(event) => change({ ...when, field: event.target.value })}>
          {!field && <option value={when.field}>{when.field}</option>}
          {props.fields.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name || candidate.id}
            </option>
          ))}
        </Select>
      </Labeled>
      <Labeled label={labels.exitCard.op} className={when.op === "filled" ? "col-span-2" : undefined}>
        <Select value={when.op} onChange={(event) => change({ ...when, op: event.target.value as typeof when.op })}>
          {props.ops.map((op) => (
            <option key={op} value={op}>
              {labels.ops[op]}
            </option>
          ))}
        </Select>
      </Labeled>
      {when.op !== "filled" &&
        (field?.type === "boolean" ? (
          <Labeled label={labels.exitCard.value}>
            <Select value={when.value === false ? "false" : "true"} onChange={(event) => change({ ...when, value: event.target.value === "true" })}>
              <option value="true">{labels.yes}</option>
              <option value="false">{labels.no}</option>
            </Select>
          </Labeled>
        ) : field?.type === "choice" && field.options.length > 0 ? (
          <Labeled label={labels.exitCard.value}>
            <Select value={String(when.value ?? "")} onChange={(event) => change({ ...when, value: event.target.value })}>
              <option value="" />
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Labeled>
        ) : (
          <Labeled label={labels.exitCard.value}>
            <Input
              value={String(when.value ?? "")}
              inputMode={field?.type === "number" ? "decimal" : undefined}
              onChange={(event) => change({ ...when, value: event.target.value })}
            />
          </Labeled>
        ))}
    </div>
  );
}
