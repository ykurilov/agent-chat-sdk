import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  FLOW_OPS_BY_FIELD_TYPE,
  FLOW_DATA_OPS,
  RETURN_TARGET,
  type AgentFlow,
  type FlowExit,
  type FlowField,
  type FlowIssue,
  type FlowNudges,
  type FlowState,
} from "../../format/flow-format";
import { catalogEventLabel, catalogEventNames } from "../../format/catalog-events";
import { fieldById, isFinal, stateById } from "../../engine/flow-graph";
import { isFieldStale } from "../../engine/side-questions";
import type { FlowEditorLabels } from "../../labels/editor";
import { useFlowLabels } from "../flow-labels";
import type { FlowEditorSkin, FlowStateLinkView, FlowTargetOption } from "../flow-editor-skin";
import {
  addExit,
  addField,
  freeSpot,
  moveExit,
  moveField,
  removeExit,
  removeField,
  setExcept,
  setStart,
  updateExit,
  updateField,
  updateState,
  type ExitOwner,
  type FieldList,
} from "./editor-model";
import { conditionText, edgeKind, stateGoal, targetTitle } from "./exit-text";
import { useBoardSpace, useFullscreenBehavior, type FlowBoardSpaceProps } from "./board-space";
import { FlowBoard } from "./flow-board";
import {
  durationOf,
  nudgesMode,
  setAfterEnd,
  setDuration,
  setScheduleOn,
  setStateNudges,
  setStateNudgesDays,
  setStateNudgesUntilProgramDay,
  stateNudgesDays,
  stateNudgesUntilProgramDay,
  updateSchedule,
  updateScheduleNudges,
  updateStateNudges,
} from "./schedule-model";
import { addCatalogField, addSideTask, catalogFieldsToAdd, removeSideTask, setSideTaskField, updateSideTask } from "./side-task-model";
import { nextQuestionField, simulationChoices } from "./flow-simulation";
import { useFlowEditor, type FlowEditorController, type UseFlowEditorOptions } from "./use-flow-editor";

export interface FlowEditorProps extends UseFlowEditorOptions, FlowBoardSpaceProps {
  /** Части экрана: `tandemFlowEditorSkin` из `@ykurilov/agent-chat-skin-tandem/flows` или свои по договору. */
  skin: FlowEditorSkin;
  /** Класс и стиль корня редактора. По умолчанию он занимает высоту родителя, но не меньше разумной (на телефоне тоже). */
  className?: string;
  style?: CSSProperties;
}

/** Редактор сценария: доска, панели, проверка, прогон, JSON. Управляемый: сценарий хранит приложение. */
export function FlowEditor({ skin, className, style, header: headerMode, legend, minimap, inspector, fullscreen, storageKey, ...options }: FlowEditorProps) {
  const editor = useFlowEditor(options);
  const labels = useFlowLabels().editor;
  const { flow } = editor;
  const space = useBoardSpace(
    {
      ...(headerMode !== undefined ? { header: headerMode } : {}),
      ...(legend !== undefined ? { legend } : {}),
      ...(minimap !== undefined ? { minimap } : {}),
      ...(inspector !== undefined ? { inspector } : {}),
      ...(fullscreen !== undefined ? { fullscreen } : {}),
      ...(storageKey !== undefined ? { storageKey } : {}),
    },
    editor,
  );
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const { setFullscreen } = space;
  const onTab = useFullscreenBehavior(space.fullscreen, () => setFullscreen(false), editor.dialog !== null, root);

  const header = (
    <skin.FlowHeader
      name={flow.name}
      onRename={(name) => editor.edit((current) => ({ ...current, name }))}
      mode={editor.mode}
      onModeChange={editor.setMode}
      issues={editor.issueCount}
      onAddState={() => editor.addState(freeSpot(flow))}
      onOpenCard={() => editor.select({ kind: "card" })}
      onOpenAnyState={() => { editor.select({ kind: "any" }); space.showInspector(); }}
      onOpenJson={editor.openJson}
      {...(options.onSave && !editor.readOnly ? { onSave: () => void editor.save() } : {})}
      saving={editor.saving}
      dirty={editor.dirty}
      saveFailed={editor.saveFailed}
      readOnly={editor.readOnly}
      {...(editor.migrate && !editor.readOnly ? { onOpenMigrate: editor.migrate.open } : {})}
      {...(space.header === "compact" ? { compact: true } : {})}
      {...(space.fullscreenAllowed ? { fullscreen: { active: space.fullscreen, onToggle: () => setFullscreen(!space.fullscreen) } } : {})}
    />
  );

  // Обёртка стоит всегда, чтобы доска не пересоздавалась при выходе на весь экран; в обычном виде она не влияет на вёрстку.
  return (
    <div
      ref={setRoot}
      data-flow-fullscreen={space.fullscreen ? "" : undefined}
      {...(space.fullscreen ? { role: "dialog", "aria-modal": true, "aria-label": labels.board.space.fullscreenRegion, onKeyDown: onTab } : {})}
      style={space.fullscreen ? FULLSCREEN_STYLE : { display: "contents" }}
    >
      <skin.FlowEditorFrame
        header={header}
        board={<FlowBoard editor={editor} skin={skin} space={space} />}
        panel={space.inspectorOpen ? <EditorPanel editor={editor} skin={skin} labels={labels} onNavigate={space.showInspector} /> : null}
        dialog={<EditorDialog editor={editor} skin={skin} />}
        {...(space.header === "compact" ? { compact: true } : {})}
        // Свои класс и стиль приложения рассчитаны на место в странице; на весь экран редактор занимает окно.
        {...(space.fullscreen ? { style: { height: "100%", minHeight: 0 } } : { ...(className !== undefined ? { className } : {}), ...(style !== undefined ? { style } : {}) })}
      />
    </div>
  );
}

const FULLSCREEN_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2000,
  height: "100dvh",
  overflow: "auto",
  background: "var(--canvas, Canvas)",
  color: "var(--foreground, CanvasText)",
};

function stateLinks(editor: FlowEditorController): FlowStateLinkView[] {
  return editor.flow.states.map((state) => ({
    stateId: state.id,
    title: state.title || state.id,
    start: editor.flow.start === state.id,
    final: isFinal(state),
    onSelect: () => editor.select({ kind: "state", stateId: state.id }),
  }));
}

function targetOptions(flow: AgentFlow, labels: FlowEditorLabels, withReturn: boolean): FlowTargetOption[] {
  const states = flow.states.map((state) => ({ value: state.id, title: state.title || state.id }));
  return withReturn ? [...states, { value: RETURN_TARGET, title: labels.returnTarget }] : states;
}

function ExitCards({ editor, skin, labels, owner }: { editor: FlowEditorController; skin: FlowEditorSkin; labels: FlowEditorLabels; owner: ExitOwner }) {
  const { flow, catalog } = editor;
  const state = owner === null ? undefined : stateById(flow, owner);
  // Выход «Длится» правится в своём разделе панели ноды, если у скина он есть.
  const durationExitId = state && skin.FlowStateTiming ? durationOf(state)?.exitId : undefined;
  const exits: FlowExit[] = (owner === null ? flow.anyState.exits : (state?.exits ?? [])).filter((exit) => exit.id !== durationExitId);
  const fields: FlowField[] = [...flow.clientCard, ...flow.chatNotes];
  const eventNames = {
    button: [...new Set([...catalogEventNames(catalog), ...catalog.widgets])],
    tool: [...catalog.tools],
    app: catalogEventNames(catalog),
  };
  const eventLabels: Record<string, string> = {};
  for (const name of eventNames.app) {
    const label = catalogEventLabel(catalog, name);
    if (label) eventLabels[name] = label;
  }
  const targets = targetOptions(flow, labels, owner !== null);
  return (
    <>
      {exits.map((exit, index) => {
        const fieldType = exit.when.type === "data" ? fieldById(flow, exit.when.field)?.field.type : undefined;
        const summary = `${conditionText(flow, exit.when, labels, editor.catalog)} → ${targetTitle(flow, exit.to, labels) ?? labels.board.noTarget}`;
        return (
          <ExitFocus label={summary} key={exit.id} exitId={exit.id} selection={editor.selection} owner={owner}>
          <skin.FlowExitCard
            exitId={exit.id}
            {...(owner === null ? { summary } : {})}
            when={exit.when}
            to={exit.to}
            fields={fields}
            ops={fieldType ? [...FLOW_OPS_BY_FIELD_TYPE[fieldType]] : [...FLOW_DATA_OPS]}
            eventNames={eventNames}
            eventLabels={eventLabels}
            targets={targets}
            issues={editor.issues.filter((issue) => issue.place.exitId === exit.id)}
            canMoveUp={index > 0}
            canMoveDown={index < exits.length - 1}
            onChange={(next) => editor.changeExit(owner, exit.id, next)}
            onMoveUp={() => editor.edit((current) => moveExit(current, owner, exit.id, -1))}
            onMoveDown={() => editor.edit((current) => moveExit(current, owner, exit.id, 1))}
            onDelete={() => editor.edit((current) => removeExit(current, owner, exit.id))}
          />
          </ExitFocus>
        );
      })}
    </>
  );
}

/** Validation navigation focuses the rule container, never a text input or mobile keyboard. */
function ExitFocus({ label, exitId, selection, owner, children }: { label: string; exitId: string; selection: FlowEditorController["selection"]; owner: ExitOwner; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const focused = (selection.kind === "any" && owner === null || selection.kind === "state" && selection.stateId === owner) && selection.exitId === exitId;
  useEffect(() => {
    if (!focused || !ref.current) return;
    ref.current.scrollIntoView?.({ block: "nearest" });
    ref.current.focus({ preventScroll: true });
  }, [focused, selection]);
  return <div ref={ref} role="group" aria-label={label} tabIndex={focused ? -1 : undefined} data-flow-exit-focus={exitId}>{children}</div>;
}

function FieldRows({ editor, skin, list }: { editor: FlowEditorController; skin: FlowEditorSkin; list: FieldList }) {
  const fields: FlowField[] = editor.flow[list];
  return (
    <>
      {fields.map((field, index) => (
        <skin.FlowFieldRow
          key={field.id}
          field={field}
          list={list}
          canMoveUp={index > 0}
          canMoveDown={index < fields.length - 1}
          issues={editor.issues.filter((issue) => issue.place.fieldId === field.id)}
          onChange={(patch) => editor.edit((current) => updateField(current, list, field.id, patch))}
          onMoveUp={() => editor.edit((current) => moveField(current, list, field.id, -1))}
          onMoveDown={() => editor.edit((current) => moveField(current, list, field.id, 1))}
          onDelete={() => editor.edit((current) => removeField(current, list, field.id))}
        />
      ))}
    </>
  );
}

function EditorPanel({ editor, skin, labels, onNavigate }: { editor: FlowEditorController; skin: FlowEditorSkin; labels: FlowEditorLabels; onNavigate(): void }): ReactNode {
  const panel = <EditablePanel editor={editor} skin={skin} labels={labels} onNavigate={onNavigate} />;
  // Только просмотр: поля и кнопки панели правок выключены сразу, а не молча возвращают прежнее значение.
  if (!editor.readOnly || editor.mode !== "edit") return panel;
  return (
    <fieldset disabled data-flow-read-only="" className="m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0">
      {panel}
    </fieldset>
  );
}

function EditablePanel({ editor, skin, labels, onNavigate }: { editor: FlowEditorController; skin: FlowEditorSkin; labels: FlowEditorLabels; onNavigate(): void }): ReactNode {
  const { flow, selection } = editor;

  if (editor.mode === "check") {
    return <skin.FlowCheckPanel issues={editor.issues.map((issue) => ({ ...issue, onGo: () => { editor.goToIssue(issue); onNavigate(); } }))} />;
  }
  if (editor.mode === "run" && editor.simulation) return <RunPanel editor={editor} skin={skin} labels={labels} />;

  if (selection.kind === "state") {
    const state = stateById(flow, selection.stateId)!;
    return (
      <skin.FlowStatePanel
        key={state.id}
        stateId={state.id}
        title={state.title}
        instructions={state.instructions}
        firstMessage={state.firstMessage}
        learn={state.learn}
        tools={state.tools}
        tags={state.tags}
        start={flow.start === state.id}
        noSideQuestions={state.noSideQuestions}
        fields={[...flow.clientCard, ...flow.chatNotes]}
        catalogTools={[...new Set([...flow.tools, ...editor.catalog.tools])]}
        {...(editor.catalog.toolLabels ? { toolLabels: editor.catalog.toolLabels } : {})}
        exits={<ExitCards editor={editor} skin={skin} labels={labels} owner={state.id} />}
        timing={<StateTiming editor={editor} skin={skin} labels={labels} state={state} />}
        issues={editor.issues.filter((issue) => issue.place.stateId === state.id && !issue.place.exitId)}
        onChange={(patch) =>
          editor.edit((current) => {
            const next = updateState(current, state.id, patch);
            // Инструмент, отмеченный в состоянии, попадает и в список инструментов сценария.
            const missing = (patch.tools ?? []).filter((tool) => !next.tools.includes(tool));
            return missing.length ? { ...next, tools: [...next.tools, ...missing] } : next;
          })
        }
        onMakeStart={() => editor.edit((current) => setStart(current, state.id))}
        onAddExit={(kind) => {
          const made = addExit(flow, state.id, kind);
          editor.edit(() => made.flow);
          editor.select({ kind: "state", stateId: state.id, exitId: made.exitId });
        }}
        onDelete={() => {
          editor.removeState(state.id);
          editor.select({ kind: "overview" });
        }}
      />
    );
  }
  if (selection.kind === "any") return <AnyStateSettings editor={editor} skin={skin} labels={labels} />;
  if (selection.kind === "card") {
    return (
      <skin.FlowCardPanel
        clientCard={<FieldRows editor={editor} skin={skin} list="clientCard" />}
        chatNotes={<FieldRows editor={editor} skin={skin} list="chatNotes" />}
        empty={flow.clientCard.length === 0 && flow.chatNotes.length === 0}
        sideQuestionEveryMessages={flow.pace.sideQuestionEveryMessages}
        onPaceChange={(messages) =>
          editor.edit((current) => ({ ...current, pace: { sideQuestionEveryMessages: Math.max(1, Math.round(messages) || 1) } }))
        }
        onAddField={(list) => editor.edit((current) => addField(current, list, labels.cardPanel.newField).flow)}
        appFields={catalogFieldsToAdd(flow, editor.catalog).map((field) => ({ id: field.id, title: field.title }))}
        onAddAppField={(list, fieldId) => {
          const field = editor.catalog.fields?.find((candidate) => candidate.id === fieldId);
          if (field) editor.edit((current) => addCatalogField(current, list, field));
        }}
      />
    );
  }
  return (
    <skin.FlowOverviewPanel
      name={flow.name}
      common={flow.common}
      onCommonChange={(common) => editor.edit((current) => ({ ...current, common }))}
      counts={{
        states: flow.states.length,
        exits: flow.anyState.exits.length + flow.states.reduce((sum, state) => sum + state.exits.length, 0),
        finals: flow.states.filter(isFinal).length,
      }}
      states={stateLinks(editor)}
      issues={editor.issueCount}
      sections={
        <>
          <div style={{ flex: "none" }}><AnyStateSettings editor={editor} skin={skin} labels={labels} /></div>
          <ScheduleSection editor={editor} skin={skin} labels={labels} />
          <SideTasksSection editor={editor} skin={skin} focused={selection.kind === "overview" ? selection.sideTaskId : undefined} />
        </>
      }
    />
  );
}

function AnyStateSettings({ editor, skin, labels }: { editor: FlowEditorController; skin: FlowEditorSkin; labels: FlowEditorLabels }) {
  return <skin.FlowAnyStatePanel
    except={editor.flow.anyState.except}
    states={stateLinks(editor)}
    onExceptChange={(except) => editor.edit((current) => setExcept(current, except))}
    exits={<ExitCards editor={editor} skin={skin} labels={labels} owner={null} />}
    onAddExit={(kind) => editor.edit((current) => addExit(current, null, kind).flow)}
  />;
}

/** Находки по «Дням и времени»: их коды из `checkFlow`. */
const SCHEDULE_ISSUES = new Set(["night_before_day_start", "unknown_deadline_state", "day_frame_soft_after_hard"]);
const isScheduleIssue = (issue: FlowIssue) => SCHEDULE_ISSUES.has(issue.code) || (issue.code === "empty_nudges" && !issue.place.stateId);

function NudgesEditor({ skin, nudges, optional, onChange }: { skin: FlowEditorSkin; nudges: FlowNudges | null; optional: boolean; onChange(nudges: FlowNudges | null): void }) {
  if (!skin.FlowNudgesEditor) return null;
  return <skin.FlowNudgesEditor nudges={nudges} optional={optional} onChange={onChange} />;
}

function ScheduleSection({ editor, skin, labels }: { editor: FlowEditorController; skin: FlowEditorSkin; labels: FlowEditorLabels }): ReactNode {
  if (!skin.FlowScheduleSection) return null;
  const { flow } = editor;
  return (
    <skin.FlowScheduleSection
      schedule={flow.schedule ?? null}
      afterEnd={flow.afterEnd ?? "reply"}
      states={targetOptions(flow, labels, false)}
      issues={editor.issues.filter(isScheduleIssue)}
      nudges={
        <NudgesEditor
          skin={skin}
          nudges={flow.schedule?.nudges ?? null}
          optional
          onChange={(nudges) => editor.edit((current) => updateScheduleNudges(current, nudges))}
        />
      }
      onToggle={(on) => editor.edit((current) => setScheduleOn(current, on))}
      onChange={(patch) => editor.edit((current) => updateSchedule(current, patch))}
      onAfterEndChange={(mode) => editor.edit((current) => setAfterEnd(current, mode))}
    />
  );
}

function SideTasksSection({ editor, skin, focused }: { editor: FlowEditorController; skin: FlowEditorSkin; focused: string | undefined }): ReactNode {
  const labels = useFlowLabels().editor;
  if (!skin.FlowSideTasksSection) return null;
  const { flow, catalog } = editor;
  return (
    <skin.FlowSideTasksSection
      tasks={(flow.sideTasks ?? []).map((task) => ({
        ...task,
        issues: editor.issues.filter((issue) => issue.place.sideTaskId === task.id),
        focused: task.id === focused,
      }))}
      fields={[
        ...[...flow.clientCard, ...flow.chatNotes].map((field) => ({ id: field.id, title: field.name || field.id, fromApp: false })),
        ...catalogFieldsToAdd(flow, catalog).map((field) => ({ id: field.id, title: field.title, fromApp: true })),
      ]}
      builtInCity={flow.schedule !== undefined}
      onAdd={() => editor.edit((current) => addSideTask(current, labels.sideTasks.newTask).flow)}
      onChange={(sideTaskId, patch) => editor.edit((current) => updateSideTask(current, sideTaskId, patch))}
      onFieldChange={(sideTaskId, fieldId) => editor.edit((current) => setSideTaskField(current, sideTaskId, fieldId, catalog))}
      onDelete={(sideTaskId) => editor.edit((current) => removeSideTask(current, sideTaskId))}
    />
  );
}

function StateTiming({ editor, skin, labels, state }: { editor: FlowEditorController; skin: FlowEditorSkin; labels: FlowEditorLabels; state: FlowState }): ReactNode {
  if (!skin.FlowStateTiming) return null;
  const { flow } = editor;
  const duration = durationOf(state);
  const mode = nudgesMode(state);
  const own = state.nudges && state.nudges !== "off" ? state.nudges : null;
  return (
    <skin.FlowStateTiming
      duration={duration && { amount: duration.amount, unit: duration.unit, to: duration.to }}
      daysAvailable={flow.schedule !== undefined || (duration !== null && duration.unit !== "h")}
      targets={targetOptions(flow, labels, true)}
      issues={duration ? editor.issues.filter((issue) => issue.place.exitId === duration.exitId) : []}
      onDurationChange={(value) => editor.edit((current) => setDuration(current, state.id, value))}
      onDurationTargetChange={(to) => {
        if (!duration) return;
        editor.edit((current) => {
          const exit = stateById(current, state.id)?.exits.find((candidate) => candidate.id === duration.exitId);
          return exit ? updateExit(current, state.id, exit.id, { when: exit.when, to }) : current;
        });
      }}
      nudgesMode={mode}
      onNudgesModeChange={(next) => editor.edit((current) => setStateNudges(current, state.id, next))}
      nudgesDays={stateNudgesDays(state)}
      onNudgesDaysChange={(days) => editor.edit((current) => setStateNudgesDays(current, state.id, days))}
      nudgesUntilProgramDay={stateNudgesUntilProgramDay(state)}
      onNudgesUntilProgramDayChange={(day) => editor.edit((current) => setStateNudgesUntilProgramDay(current, state.id, day))}
      nudges={
        own && (
          <NudgesEditor
            skin={skin}
            nudges={own}
            optional={false}
            onChange={(nudges) => editor.edit((current) => (nudges ? updateStateNudges(current, state.id, nudges) : setStateNudges(current, state.id, "off")))}
          />
        )
      }
    />
  );
}

function RunPanel({ editor, skin, labels }: { editor: FlowEditorController; skin: FlowEditorSkin; labels: FlowEditorLabels }) {
  const { flow } = editor;
  const sim = editor.simulation!;
  const state = stateById(flow, sim.run.state);
  const choices = useMemo(() => simulationChoices(flow, sim), [flow, sim]);
  const question = nextQuestionField(flow, sim);
  const exitById = (exitId: string) => [...flow.anyState.exits, ...flow.states.flatMap((candidate) => candidate.exits)].find((exit) => exit.id === exitId);

  const knownRow = (field: FlowField, value: unknown, stale: boolean) => ({
    fieldId: field.id,
    name: field.name || field.id,
    value: value === undefined || value === null || value === "" ? null : String(value),
    stale,
    onChange: (text: string) => editor.simulate.setKnown(field.id, text),
  });
  const known = [
    ...flow.clientCard.map((field) => {
      const entry = sim.card[field.id];
      return knownRow(field, entry?.value, entry !== undefined && isFieldStale(field, entry.updatedAt, sim.now));
    }),
    ...flow.chatNotes.map((field) => knownRow(field, sim.run.notes[field.id], false)),
  ];

  return (
    <skin.FlowRunPanel
      current={{ stateId: sim.run.state, title: state?.title || sim.run.state, goal: stateGoal(state?.instructions ?? "") }}
      choices={choices.map((choice) => {
        const exit = exitById(choice.exitId)!;
        return {
          exitId: choice.exitId,
          kind: edgeKind(exit),
          text: conditionText(flow, exit.when, labels, editor.catalog),
          target: choice.target ? targetTitle(flow, choice.target, labels) : null,
          onChoose: () => editor.simulate.choose(choice.exitId),
        };
      })}
      onNothing={editor.simulate.nothing}
      known={known}
      nextQuestion={question ? (fieldById(flow, question)?.field.name ?? question) : null}
      path={sim.steps.map((step) => {
        const exit = step.exitId ? exitById(step.exitId) : undefined;
        return {
          stateId: step.stateId,
          title: stateById(flow, step.stateId)?.title || step.stateId,
          via: step.nothing ? labels.runPanel.nothingHappened : exit ? conditionText(flow, exit.when, labels, editor.catalog) : null,
        };
      })}
      canGoBack={sim.previous !== null}
      onBack={editor.simulate.back}
      onRestart={editor.simulate.restart}
      onFinish={() => editor.setMode("edit")}
    />
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function EditorDialog({ editor, skin }: { editor: FlowEditorController; skin: FlowEditorSkin }): ReactNode {
  const labels = useFlowLabels().editor;
  if (editor.dialog === "json") {
    return (
      <skin.FlowJsonDialog
        json={editor.json}
        errors={editor.jsonErrors}
        onCopy={() => void navigator.clipboard?.writeText(editor.json)}
        onDownload={() => download(`${editor.flow.id}.json`, editor.json)}
        onLoad={(text) => void editor.loadJson(text)}
        onClose={editor.closeDialog}
        {...(editor.readOnly ? { readOnly: true } : {})}
      />
    );
  }
  if (editor.dialog === "migrate" && editor.migrate) {
    const migrate = editor.migrate;
    return (
      <skin.FlowMigrateDialog
        rows={migrate.rows.map((row) => ({ ...row, onTargetChange: (stateId: string) => migrate.setTarget(row.stateId, stateId) }))}
        targets={targetOptions(editor.flow, labels, false)}
        busy={migrate.busy}
        failed={migrate.failed}
        moved={migrate.moved}
        canMigrate={migrate.canMigrate}
        onMigrate={() => void migrate.run()}
        onClose={editor.closeDialog}
      />
    );
  }
  return null;
}
