import { Button, Input, Switch, Textarea, cn } from "@tandem/ui";
import type { FlowAfterEnd, FlowDuration, FlowNudges, FlowTimerUnit } from "@ykurilov/agent-chat-flows/format";
import type {
  DurationUnit,
  FlowNudgesEditorProps,
  FlowScheduleSectionProps,
  FlowSideTasksSectionProps,
  FlowStateTimingProps,
  NudgesMode,
} from "@ykurilov/agent-chat-flows/react";
import { capsByDayText, DEFAULT_NUDGES, parseCapsByDay, useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { ChevronDown, Clock, Plus, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { IssueList } from "./flow-panels";
import { IconButton, Labeled, SectionTitle, Select } from "./flow-parts";

// «Дни и время», касания, «Попутные задачи» и «Длится» ноды. Редкие настройки — под «Дополнительно».

const TIMER_UNITS: FlowTimerUnit[] = ["min", "h", "d"];
const NUDGES_MODES: NudgesMode[] = ["inherit", "own", "off"];

/** Пустое поле — `undefined`, иначе целое число. */
const numberOrNone = (text: string) => (text.trim() === "" ? undefined : Math.max(0, Math.round(Number(text)) || 0));

function More({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group flex flex-col gap-3">
      <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--foreground)]">
        <span className="inline-flex items-center gap-1">
          <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
          {title}
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </details>
  );
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange(checked: boolean): void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-[var(--foreground)]">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/** «15 мин»: число и единица. */
function DurationInput({ label, value, onChange, onRemove }: { label: string; value: FlowDuration; onChange(value: FlowDuration): void; onRemove?(): void }) {
  const units = useFlowLabels().editor.units;
  const remove = useFlowLabels().editor.nudges.remove;
  return (
    <div className="flex items-center gap-1.5">
      <Input
        aria-label={label}
        type="number"
        min={1}
        inputMode="numeric"
        className="w-20"
        value={value.amount}
        onChange={(event) => Number(event.target.value) > 0 && onChange({ ...value, amount: Math.round(Number(event.target.value)) })}
      />
      <Select aria-label={`${label}: ${units[value.unit]}`} className="w-24" value={value.unit} onChange={(event) => onChange({ ...value, unit: event.target.value as FlowTimerUnit })}>
        {TIMER_UNITS.map((unit) => (
          <option key={unit} value={unit}>
            {units[unit]}
          </option>
        ))}
      </Select>
      {onRemove && (
        <IconButton label={remove} onClick={onRemove}>
          <X aria-hidden="true" className="size-4" />
        </IconButton>
      )}
    </div>
  );
}

export function TandemFlowNudgesEditor({ nudges, optional, onChange }: FlowNudgesEditorProps) {
  const labels = useFlowLabels().editor.nudges;
  if (nudges === null) {
    return optional ? <SwitchRow label={labels.on} checked={false} onChange={() => onChange(structuredClone(DEFAULT_NUDGES))} /> : null;
  }
  const set = (patch: Partial<FlowNudges>) => onChange({ ...nudges, ...patch });
  const steps = nudges.afterSilence;
  const daily = nudges.dailyAt ?? [];
  return (
    <div data-flow-nudges="" className="flex flex-col gap-3 rounded-[var(--radius-nested)] bg-[var(--surface-muted)] p-3">
      {optional && <SwitchRow label={labels.on} checked onChange={() => onChange(null)} />}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-[var(--foreground)]">{labels.afterSilence}</span>
        {steps.map((step, index) => (
          <DurationInput
            key={index}
            label={`${labels.afterSilence} ${index + 1}`}
            value={step}
            onChange={(next) => set({ afterSilence: steps.map((item, at) => (at === index ? next : item)) })}
            onRemove={() => set({ afterSilence: steps.filter((_, at) => at !== index) })}
          />
        ))}
        <Button variant="secondary" size="sm" className="self-start" onClick={() => set({ afterSilence: [...steps, steps.at(-1) ?? { amount: 1, unit: "h" }] })}>
          <Plus aria-hidden="true" className="size-3.5" />
          {labels.addStep}
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-[var(--foreground)]">{labels.dailyAt}</span>
        {daily.map((at, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <Input
              aria-label={`${labels.dailyAt} ${index + 1}`}
              type="time"
              className="w-32"
              value={at}
              onChange={(event) => event.target.value && set({ dailyAt: daily.map((item, place) => (place === index ? event.target.value : item)) })}
            />
            <IconButton label={labels.remove} onClick={() => set({ dailyAt: daily.filter((_, place) => place !== index) })}>
              <X aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
        ))}
        <Button variant="secondary" size="sm" className="self-start" onClick={() => set({ dailyAt: [...daily, "10:00"] })}>
          <Plus aria-hidden="true" className="size-3.5" />
          {labels.addTime}
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-[var(--foreground)]">{labels.giveUpAfter}</span>
        {nudges.giveUpAfter ? (
          <DurationInput label={labels.giveUpAfter} value={nudges.giveUpAfter} onChange={(giveUpAfter) => set({ giveUpAfter })} onRemove={() => set({ giveUpAfter: undefined })} />
        ) : (
          <Button variant="secondary" size="sm" className="self-start" onClick={() => set({ giveUpAfter: { amount: 3, unit: "d" } })}>
            {labels.never}
          </Button>
        )}
      </div>
    </div>
  );
}

export function TandemFlowScheduleSection(props: FlowScheduleSectionProps) {
  const labels = useFlowLabels().editor;
  const text = labels.schedule;
  const { schedule, onChange } = props;
  const afterEnd = (
    <Labeled label={labels.overview.afterEnd} hint={labels.overview.afterEndHints[props.afterEnd]}>
      <Select value={props.afterEnd} onChange={(event) => props.onAfterEndChange(event.target.value as FlowAfterEnd)}>
        {(["reply", "silent"] as const).map((mode) => (
          <option key={mode} value={mode}>
            {labels.overview.afterEndModes[mode]}
          </option>
        ))}
      </Select>
    </Labeled>
  );
  return (
    <section aria-label={text.title} data-flow-schedule="" className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
      <h3 className="inline-flex items-center gap-1.5 text-base font-semibold text-[var(--foreground)]">
        <Clock aria-hidden="true" className="size-4 text-[var(--warm)]" />
        {text.title}
      </h3>
      <SwitchRow label={text.on} checked={schedule !== null} onChange={props.onToggle} />
      <p className="text-xs text-[var(--foreground-muted)]">{text.hint}</p>
      <IssueList issues={props.issues} />
      {schedule && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Labeled label={text.dayStart} hint={text.dayStartHint}>
              <Input type="time" value={schedule.dayStart} onChange={(event) => event.target.value && onChange({ dayStart: event.target.value })} />
            </Labeled>
            <Labeled label={text.lengthDays}>
              <Input
                type="number"
                min={1}
                max={60}
                inputMode="numeric"
                placeholder={text.lengthDaysNone}
                value={schedule.lengthDays ?? ""}
                onChange={(event) => onChange({ lengthDays: numberOrNone(event.target.value) || undefined })}
              />
            </Labeled>
          </div>
          {schedule.lengthDays !== undefined && (
            <>
              <Labeled label={text.deadlineState}>
                <Select value={schedule.deadlineState ?? ""} onChange={(event) => onChange({ deadlineState: event.target.value || undefined })}>
                  <option value="">{text.deadlineNone}</option>
                  {props.states.map((state) => (
                    <option key={state.value} value={state.value}>
                      {state.title}
                    </option>
                  ))}
                </Select>
              </Labeled>
              <SwitchRow label={text.farewell} checked={schedule.farewellOnDeadline} onChange={(farewellOnDeadline) => onChange({ farewellOnDeadline })} />
              {schedule.farewellOnDeadline && (
                <Labeled label={text.farewellText} hint={text.farewellTextHint}>
                  <Textarea rows={3} value={schedule.farewellText ?? ""} onChange={(event) => onChange({ farewellText: event.target.value })} />
                </Labeled>
              )}
            </>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-[var(--foreground)]">{text.nudges}</span>
            <span className="text-xs text-[var(--foreground-muted)]">{text.nudgesHint}</span>
            {props.nudges}
          </div>
        </>
      )}
      <More title={text.more}>
        {schedule && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Labeled label={text.nightFrom}>
                <Input type="time" value={schedule.nightFrom ?? ""} onChange={(event) => onChange({ nightFrom: event.target.value || undefined })} />
              </Labeled>
              <Labeled label={text.lateStart}>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={schedule.lateStartHours}
                  onChange={(event) => onChange({ lateStartHours: numberOrNone(event.target.value) ?? 0 })}
                />
              </Labeled>
            </div>
            <p className="-mt-2 text-xs text-[var(--foreground-muted)]">
              {text.nightFromHint} {text.lateStartHint}
            </p>
            <div className="flex flex-col gap-2">
              <SectionTitle>{text.firstMessages}</SectionTitle>
              <Labeled label={text.maxPerDay} hint={text.maxPerDayHint}>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={schedule.firstMessages?.maxPerDay ?? ""}
                  onChange={(event) => onChange({ firstMessages: { ...schedule.firstMessages, maxPerDay: numberOrNone(event.target.value) } })}
                />
              </Labeled>
              <Labeled label={text.maxPerDayByDay} hint={text.maxPerDayByDayHint}>
                <CapsByDayInput
                  caps={schedule.firstMessages?.maxPerDayByDay}
                  onChange={(maxPerDayByDay) => onChange({ firstMessages: { ...schedule.firstMessages, maxPerDayByDay } })}
                />
              </Labeled>
              <SwitchRow
                label={text.morning}
                checked={schedule.firstMessages?.morning ?? schedule.lengthDays !== undefined}
                onChange={(morning) => onChange({ firstMessages: { ...schedule.firstMessages, morning } })}
              />
              <Labeled label={text.skipMorning}>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder="180"
                  value={schedule.firstMessages?.skipMorningIfHumanWithinMin ?? ""}
                  onChange={(event) => onChange({ firstMessages: { ...schedule.firstMessages, skipMorningIfHumanWithinMin: numberOrNone(event.target.value) } })}
                />
              </Labeled>
            </div>
            <div className="flex flex-col gap-2">
              <SectionTitle>{text.dayFrame}</SectionTitle>
              <p className="text-xs text-[var(--foreground-muted)]">{text.dayFrameHint}</p>
              <div className="grid grid-cols-2 gap-2">
                <Labeled label={text.softFrom}>
                  <Input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={schedule.dayFrame?.softFrom ?? ""}
                    onChange={(event) => onChange({ dayFrame: { ...schedule.dayFrame, softFrom: numberOrNone(event.target.value) || undefined } })}
                  />
                </Labeled>
                <Labeled label={text.hardAt}>
                  <Input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={schedule.dayFrame?.hardAt ?? ""}
                    onChange={(event) => onChange({ dayFrame: { ...schedule.dayFrame, hardAt: numberOrNone(event.target.value) || undefined } })}
                  />
                </Labeled>
              </div>
              {schedule.dayFrame?.hardAt !== undefined && (
                <Labeled label={text.hardText} hint={text.hardTextHint}>
                  <Textarea rows={2} value={schedule.dayFrame.hardText ?? ""} onChange={(event) => onChange({ dayFrame: { ...schedule.dayFrame, hardText: event.target.value } })} />
                </Labeled>
              )}
            </div>
          </>
        )}
        {afterEnd}
      </More>
    </section>
  );
}

export function TandemFlowSideTasksSection(props: FlowSideTasksSectionProps) {
  const editorLabels = useFlowLabels().editor;
  const labels = editorLabels.sideTasks;
  const own = props.fields.filter((field) => !field.fromApp);
  const fromApp = props.fields.filter((field) => field.fromApp);
  return (
    <section aria-label={labels.title} data-flow-side-tasks="" className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
      <h3 className="text-base font-semibold text-[var(--foreground)]">{labels.title}</h3>
      <p className="text-xs text-[var(--foreground-muted)]">{labels.hint}</p>
      {props.builtInCity && <p className="rounded-[var(--radius-small)] bg-[var(--cool-soft)] px-3 py-2 text-xs text-[var(--cool-text)]">{labels.builtIn}</p>}
      <ul className="flex flex-col gap-2">
        {props.tasks.map((task) => (
          <li
            key={task.id}
            data-side-task={task.id}
            aria-label={task.text || task.id}
            className={cn(
              "flex min-w-0 flex-col gap-2 rounded-[var(--radius-nested)] border bg-[var(--surface)] p-3",
              task.issues.some((issue) => issue.level === "error") ? "border-[var(--destructive)]" : "border-[var(--border)]",
              task.focused && "ring-2 ring-[var(--focus-ring)]",
            )}
          >
            <div className="flex items-start gap-1">
              <Textarea
                aria-label={labels.text}
                placeholder={labels.text}
                rows={2}
                className="flex-1"
                value={task.text}
                onChange={(event) => props.onChange(task.id, { text: event.target.value })}
              />
              <IconButton label={labels.delete} onClick={() => props.onDelete(task.id)} tone="danger">
                <Trash2 aria-hidden="true" className="size-4" />
              </IconButton>
            </div>
            <Labeled label={labels.field}>
              <Select value={task.field ?? ""} onChange={(event) => props.onFieldChange(task.id, event.target.value || null)}>
                <option value="">{labels.noField}</option>
                {own.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.title}
                  </option>
                ))}
                {fromApp.length > 0 && (
                  <optgroup label={labels.fromApp}>
                    {fromApp.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.title}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
            </Labeled>
            <More title={editorLabels.schedule.more}>
              <Labeled label={labels.when}>
                <Input value={task.when ?? ""} onChange={(event) => props.onChange(task.id, { when: event.target.value })} />
              </Labeled>
              <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                {labels.maxAttempts}
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className="w-20"
                  value={task.maxAttempts}
                  onChange={(event) => Number(event.target.value) > 0 && props.onChange(task.id, { maxAttempts: Number(event.target.value) })}
                />
              </label>
              <SwitchRow label={labels.perConversation} checked={task.perConversation} onChange={(perConversation) => props.onChange(task.id, { perConversation })} />
            </More>
            <IssueList issues={task.issues} />
          </li>
        ))}
      </ul>
      <Button variant="secondary" size="sm" onClick={props.onAdd} className="self-start">
        <Plus aria-hidden="true" className="size-3.5" />
        {labels.add}
      </Button>
    </section>
  );
}

export function TandemFlowStateTiming(props: FlowStateTimingProps) {
  const labels = useFlowLabels().editor.statePanel;
  const { duration } = props;
  const units: DurationUnit[] = props.daysAvailable ? ["h", "d", "program_day"] : ["h"];
  // «3 дней», но «до дня программы 3»: номер дня — после варианта.
  const amount = duration && (
    <Input
      aria-label={`${labels.duration}: ${labels.durationUnits[duration.unit]}`}
      type="number"
      min={1}
      inputMode="numeric"
      className="w-20"
      value={duration.amount}
      onChange={(event) => Number(event.target.value) > 0 && props.onDurationChange({ amount: Number(event.target.value), unit: duration.unit })}
    />
  );
  return (
    <section aria-label={labels.duration} data-flow-state-timing="" className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-[var(--foreground)]">{labels.duration}</span>
        <div className="flex items-center gap-1.5">
          {duration?.unit !== "program_day" && amount}
          <Select
            aria-label={labels.duration}
            className={duration ? (duration.unit === "program_day" ? "w-44" : "w-28") : undefined}
            value={duration?.unit ?? ""}
            onChange={(event) => {
              const unit = event.target.value as DurationUnit | "";
              props.onDurationChange(unit === "" ? null : { amount: duration?.amount ?? 1, unit });
            }}
          >
            <option value="">{labels.durationNone}</option>
            {units.map((unit) => (
              <option key={unit} value={unit}>
                {labels.durationUnits[unit]}
              </option>
            ))}
          </Select>
          {duration?.unit === "program_day" && amount}
        </div>
        <span className="text-xs text-[var(--foreground-muted)]">{labels.durationHint}</span>
      </div>
      {duration && (
        <Labeled label={labels.durationTo}>
          <Select value={duration.to ?? ""} onChange={(event) => props.onDurationTargetChange(event.target.value || null)}>
            <option value="">—</option>
            {props.targets.map((target) => (
              <option key={target.value} value={target.value}>
                {target.title}
              </option>
            ))}
          </Select>
        </Labeled>
      )}
      <IssueList issues={props.issues} />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-[var(--foreground)]">{labels.nudges}</span>
        <div role="radiogroup" aria-label={labels.nudges} className="flex flex-wrap gap-1.5">
          {NUDGES_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={props.nudgesMode === mode}
              onClick={() => props.onNudgesModeChange(mode)}
              className={cn(
                "min-h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                props.nudgesMode === mode
                  ? "border-[var(--action)] bg-[var(--cool-soft)] text-[var(--cool-text)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-muted)] hover:bg-[var(--surface-hover)]",
              )}
            >
              {labels.nudgesModes[mode]}
            </button>
          ))}
        </div>
        <span className="text-xs text-[var(--foreground-muted)]">{labels.nudgesHint}</span>
        {props.nudges}
        {props.nudgesMode === "own" && (
          <NudgesDays
            days={props.nudgesDays}
            untilProgramDay={props.nudgesUntilProgramDay}
            onDaysChange={props.onNudgesDaysChange}
            onUntilProgramDayChange={props.onNudgesUntilProgramDayChange}
          />
        )}
      </div>
    </section>
  );
}

/** «Свои касания действуют»: всё время в ноде, N дней, считая день входа, или до дня программы N включительно. */
function NudgesDays(props: {
  days: number | null;
  untilProgramDay: number | null;
  onDaysChange(days: number | null): void;
  onUntilProgramDayChange(day: number | null): void;
}) {
  const labels = useFlowLabels().editor.statePanel;
  const mode = props.untilProgramDay !== null ? "untilProgramDay" : props.days !== null ? "days" : "always";
  const value = mode === "untilProgramDay" ? props.untilProgramDay : props.days;
  const setValue = mode === "untilProgramDay" ? props.onUntilProgramDayChange : props.onDaysChange;
  const setMode = (next: string) => {
    props.onDaysChange(next === "days" ? 1 : null);
    props.onUntilProgramDayChange(next === "untilProgramDay" ? 1 : null);
  };
  return (
    <div data-flow-nudges-days="" className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-[var(--foreground)]">{labels.nudgesDays}</span>
      <div className="flex items-center gap-1.5">
        {value !== null && mode !== "always" && (
          <Input
            aria-label={`${labels.nudgesDays}: ${labels.nudgesDaysModes[mode]}`}
            type="number"
            min={1}
            inputMode="numeric"
            className="w-20"
            value={value}
            onChange={(event) => Number(event.target.value) > 0 && setValue(Number(event.target.value))}
          />
        )}
        <Select aria-label={labels.nudgesDays} value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="always">{labels.nudgesDaysModes.always}</option>
          <option value="days">{labels.nudgesDaysModes.days}</option>
          <option value="untilProgramDay">{labels.nudgesDaysModes.untilProgramDay}</option>
        </Select>
      </div>
      {mode === "days" && <span className="text-xs text-[var(--foreground-muted)]">{labels.nudgesDaysHint}</span>}
      {mode === "untilProgramDay" && (
        <span className="text-xs text-[var(--foreground-muted)]">
          {labels.nudgesUntilProgramDayHint} {labels.nudgesDaysHint}
        </span>
      )}
    </div>
  );
}

/** Потолок по дням программы: «3, 2». Черновик поля живёт, пока он не число списком; пустое — без потолка по дням. */
function CapsByDayInput({ caps, onChange }: { caps: number[] | undefined; onChange(caps: number[] | undefined): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? capsByDayText(caps);
  return (
    <Input
      inputMode="numeric"
      placeholder="3, 2"
      value={shown}
      aria-invalid={draft !== null && parseCapsByDay(draft) === null}
      onChange={(event) => {
        setDraft(event.target.value);
        const parsed = parseCapsByDay(event.target.value);
        if (parsed !== null) onChange(parsed);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
