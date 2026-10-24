import { useCallback, useMemo, useRef, useState } from "react";
import { checkFlow } from "../../check/check-flow";
import type { AgentFlow, FlowCatalog, FlowIssue, FlowPoint } from "../../format/flow-format";
import type { StateMap } from "../../engine/migrate-run";
import type { ChatsInState } from "../../store/flow-store";
import type { FlowEditorMode, FlowIssueCount } from "../flow-editor-skin";
import { useFlowLabels } from "../flow-labels";
import { appIssues, type FlowAppChecks, type FlowAppIssue } from "../../check/app-checks";
import {
  addExit,
  addState as addStateTo,
  connectExit,
  flowFingerprint,
  flowToJson,
  loadFlowJson,
  removeState as removeStateFrom,
  type ExitOwner,
} from "./editor-model";
import {
  chooseExit,
  chooseNothing,
  setKnownValue,
  startSimulation,
  stepBack,
  type Simulation,
} from "./flow-simulation";

/** Что открыто в панели справа. */
export type FlowSelection =
  | { kind: "overview"; sideTaskId?: string }
  | { kind: "state"; stateId: string; exitId?: string }
  | { kind: "any"; exitId?: string }
  | { kind: "card" };

export type FlowDialog = "json" | "migrate" | null;

/**
 * Перевод идущих чатов на текущую версию. Данные и действие даёт приложение — редактор не знает, где сервер:
 * `chatsByState` — чаты на прежних версиях (`flow.chatsByState`), `migrate` — перевод с картой удалённых состояний
 * (`flow.migrateChats`). Отбор чатов в обоих вызовах один и тот же: окно показывает ровно тех, кого переведёт.
 */
export interface FlowMigration {
  chatsByState(): Promise<ChatsInState[]>;
  migrate(map: StateMap): Promise<{ moved: number }>;
  /** Название состояния прежней версии; нет — берём из текущей или показываем id. */
  stateTitle?(versionId: string, stateId: string): string | undefined;
}

/**
 * Ответ `onSave`. Ничего (`void`) и `{ ok: true }` — сохранено. `{ ok: false, issues }` — приложение отказало без
 * исключения: шапка не пишет «Сохранено», `issues` встают у нод и выходов, как находки «Проверить граф».
 */
export type FlowSaveResult = void | { ok: true } | { ok: false; issues?: ReadonlyArray<Pick<FlowAppIssue, "path" | "message">> };

export interface UseFlowEditorOptions {
  value: AgentFlow;
  onChange(flow: AgentFlow): void;
  /** Сохранить сценарий. Отказ — `{ ok: false, issues }` или исключение (оно не уходит в консоль необработанным). */
  onSave?(flow: AgentFlow): FlowSaveResult | Promise<FlowSaveResult>;
  /**
   * Только просмотр: доску нельзя менять (двигать, соединять, удалять, править панели), нельзя сохранять и загружать
   * JSON. Смотреть, проверять граф, прогонять и открывать JSON можно. Нужно, пока сценарий правит внешний агент.
   */
  readOnly?: boolean;
  /**
   * Сценарий, который сейчас сохранён у приложения (на сервере). Если задан, «Сохранено» и доступность кнопки сохранения
   * считаются от него, а не от `value` при показе доски: вернулись на вкладку с несохранённой правкой — доска честно
   * скажет «Не сохранено». После успешного `onSave` доска считает сохранённым отправленное, пока не придёт новый
   * `savedValue`. Без него сохранённым считается `value` при показе доски.
   */
  savedValue?: AgentFlow;
  /** Что объявило приложение: инструменты, события и кнопки, виджеты. */
  catalog: FlowCatalog;
  migration?: FlowMigration;
  /** Пояс человека для таймеров «время суток» в прогоне; по умолчанию — пояс браузера. */
  timeZone?: string;
  now?(): number;
  /**
   * Свои проверки приложения в «Проверить сценарий»: `(flow) => [{ path: "states[2]", message }]`. Находки идут после
   * встроенных, клик ведёт на место. Те же проверки приложение передаёт в `checkFlow(flow, catalog, { checks })`.
   */
  checks?: FlowAppChecks;
}

export interface FlowMigrateRow extends ChatsInState {
  stateTitle: string;
  removed: boolean;
  target: string | null;
}

export interface FlowMigrateController {
  rows: FlowMigrateRow[];
  busy: boolean;
  failed: boolean;
  moved: number | null;
  canMigrate: boolean;
  open(): void;
  setTarget(stateId: string, target: string): void;
  run(): Promise<void>;
}

function countIssues(issues: FlowIssue[]): FlowIssueCount {
  return {
    errors: issues.filter((issue) => issue.level === "error").length,
    warnings: issues.filter((issue) => issue.level === "warning").length,
  };
}

/** Проверки приложения; упали — редактор работает дальше, а находка говорит об этом. */
function runAppChecks(flow: AgentFlow, checks: FlowAppChecks | undefined, failed: string): FlowIssue[] {
  if (!checks) return [];
  try {
    return appIssues(flow, checks(flow));
  } catch (error) {
    console.error("[flow] app checks failed", error);
    return [{ level: "warning", code: "app_check_failed", message: failed, place: {} }];
  }
}

const NO_ISSUES: FlowIssue[] = [];

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Логика редактора сценария: правки, выбор, проверка, прогон, JSON, сохранение, перевод чатов. Скин только рисует. */
export function useFlowEditor(options: UseFlowEditorOptions) {
  const { value: flow, onChange, catalog } = options;
  const labels = useFlowLabels().editor;
  const latest = useRef(options);
  latest.current = options;

  const [selection, setSelection] = useState<FlowSelection>({ kind: "overview" });
  const [mode, setModeState] = useState<FlowEditorMode>("edit");
  const [dialog, setDialog] = useState<FlowDialog>(null);
  const [jsonErrors, setJsonErrors] = useState<string[]>([]);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [saving, setSaving] = useState(false);
  const [mountedPrint] = useState(() => flowFingerprint(flow));
  const savedPrint = useMemo(() => (options.savedValue ? flowFingerprint(options.savedValue) : undefined), [options.savedValue]);
  // Отправленное через `onSave` считается сохранённым, пока приложение не прислало другой `savedValue`.
  const [sent, setSent] = useState<{ print: string; base: string | undefined } | null>(null);
  const savedJson = sent && sent.base === savedPrint ? sent.print : (savedPrint ?? mountedPrint);
  // Отказ в сохранении держится, пока сценарий тот же: любая правка снимает его.
  const [rejection, setRejection] = useState<{ flow: AgentFlow; issues: FlowIssue[] } | null>(null);
  const readOnly = options.readOnly === true;

  const checks = options.checks;
  const saveFailed = rejection !== null && rejection.flow === flow;
  const rejectedIssues = saveFailed ? rejection.issues : NO_ISSUES;
  const issues = useMemo(
    () => [...checkFlow(flow, catalog), ...runAppChecks(flow, checks, labels.checkPanel.appCheckFailed), ...rejectedIssues],
    [flow, catalog, checks, labels, rejectedIssues],
  );
  const issueCount = useMemo(() => countIssues(issues), [issues]);
  const json = useMemo(() => flowToJson(flow), [flow]);
  const print = useMemo(() => flowFingerprint(flow), [flow]);
  const dirty = print !== savedJson;

  // Выбранное состояние удалили — панель возвращается к обзору.
  const visibleSelection: FlowSelection =
    selection.kind === "state" && !flow.states.some((state) => state.id === selection.stateId) ? { kind: "overview" } : selection;

  const edit = useCallback((change: (flow: AgentFlow) => AgentFlow) => {
    if (latest.current.readOnly) return;
    onChange(change(latest.current.value));
  }, [onChange]);

  const select = useCallback((next: FlowSelection) => {
    setSelection(next);
    setModeState((current) => (current === "check" ? "edit" : current));
  }, []);

  const addState = useCallback(
    (at?: FlowPoint): string => {
      if (latest.current.readOnly) return "";
      const made = addStateTo(latest.current.value, { title: labels.board.newState, ...(at ? { at } : {}) });
      onChange(made.flow);
      setSelection({ kind: "state", stateId: made.stateId });
      return made.stateId;
    },
    [labels, onChange],
  );

  const connect = useCallback(
    (owner: ExitOwner, exitId: string, to: string) => {
      if (!latest.current.readOnly) onChange(connectExit(latest.current.value, owner, exitId, to));
    },
    [onChange],
  );

  /** Стрелку отпустили на пустом месте: новое состояние там же. Из узла без условия — новое условие словами. */
  const connectToNewState = useCallback(
    (owner: ExitOwner, exitId: string | null, at: FlowPoint) => {
      if (latest.current.readOnly) return;
      const made = addStateTo(latest.current.value, { title: labels.board.newState, at });
      let next = made.flow;
      let fromExit = exitId;
      if (fromExit === null) {
        const added = addExit(next, owner, "judge");
        next = added.flow;
        fromExit = added.exitId;
      }
      onChange(connectExit(next, owner, fromExit, made.stateId));
      setSelection({ kind: "state", stateId: made.stateId });
    },
    [labels, onChange],
  );

  const removeState = useCallback(
    (stateId: string) => {
      if (!latest.current.readOnly) onChange(removeStateFrom(latest.current.value, stateId));
    },
    [onChange],
  );

  const restartSimulation = useCallback(() => {
    const current = latest.current;
    setSimulation(startSimulation(current.value, { now: current.now?.() ?? Date.now(), timeZone: current.timeZone ?? browserTimeZone() }));
  }, []);

  const setMode = useCallback(
    (next: FlowEditorMode) => {
      if (next === "run") {
        const current = latest.current.value;
        if (!current.states.some((state) => state.id === current.start)) {
          setModeState("check");
          return;
        }
        restartSimulation();
      } else {
        setSimulation(null);
      }
      setModeState(next);
    },
    [restartSimulation],
  );

  const goToIssue = useCallback((issue: FlowIssue) => {
    const { stateId, exitId, fieldId, sideTaskId } = issue.place;
    if (issue.code === "unknown_except_state") setSelection({ kind: "any" });
    else if (stateId && flow.states.some((state) => state.id === stateId)) setSelection({ kind: "state", stateId, ...(exitId ? { exitId } : {}) });
    else if (exitId && flow.anyState.exits.some((exit) => exit.id === exitId)) setSelection({ kind: "any", exitId });
    else if (sideTaskId) setSelection({ kind: "overview", sideTaskId });
    else if (fieldId) setSelection({ kind: "card" });
    else setSelection({ kind: "overview" });
    setModeState("edit");
  }, [flow]);

  const simulate = useMemo(() => {
    const change = (step: (sim: Simulation) => Simulation) => setSimulation((sim) => (sim ? step(sim) : sim));
    return {
      choose: (exitId: string) => change((sim) => chooseExit(latest.current.value, sim, exitId)),
      nothing: () => change((sim) => chooseNothing(latest.current.value, sim)),
      back: () => change(stepBack),
      restart: restartSimulation,
      setKnown: (fieldId: string, text: string) => change((sim) => setKnownValue(latest.current.value, sim, fieldId, text)),
    };
  }, [restartSimulation]);

  const openJson = useCallback(() => {
    setJsonErrors([]);
    setDialog("json");
  }, []);

  const closeDialog = useCallback(() => setDialog(null), []);

  const loadJson = useCallback(
    (text: string): boolean => {
      if (latest.current.readOnly) return false;
      const loaded = loadFlowJson(text);
      if (!loaded.ok) {
        setJsonErrors(loaded.errors);
        return false;
      }
      setJsonErrors([]);
      setSelection({ kind: "overview" });
      setSimulation(null);
      setModeState("edit");
      setDialog(null);
      onChange(loaded.flow);
      return true;
    },
    [onChange],
  );

  const save = useCallback(async () => {
    const { onSave, value, readOnly: viewOnly } = latest.current;
    if (!onSave || viewOnly) return;
    setSaving(true);
    try {
      const result = await onSave(value);
      if (result && !result.ok) {
        setRejection({ flow: value, issues: appIssues(value, (result.issues ?? []).map((issue) => ({ ...issue, code: "save_rejected" }))) });
        return;
      }
      setRejection(null);
      setSent({ print: flowFingerprint(value), base: latest.current.savedValue ? flowFingerprint(latest.current.savedValue) : undefined });
    } catch (error) {
      // Исключение из `onSave` — тот же отказ, только без списка: шапка говорит «Не сохранено», консоль не засоряем.
      console.warn("[flow] onSave failed", error);
      setRejection({ flow: value, issues: [] });
    } finally {
      setSaving(false);
    }
  }, []);

  const migrate = useMigrateController(flow, options.migration, () => setDialog("migrate"));

  return {
    flow,
    catalog,
    issues,
    issueCount,
    selection: visibleSelection,
    select,
    mode,
    setMode,
    goToIssue,
    edit,
    addState,
    connect,
    connectToNewState,
    removeState,
    simulation,
    simulate,
    dialog,
    openJson,
    closeDialog,
    json,
    jsonErrors,
    loadJson,
    save,
    saving,
    saveFailed,
    dirty,
    readOnly,
    migrate,
  };
}

export type FlowEditorController = ReturnType<typeof useFlowEditor>;

/** Окно перевода чатов: строки «версия → состояние → чатов», цели для удалённых состояний, перевод. */
function useMigrateController(flow: AgentFlow, migration: FlowMigration | undefined, show: () => void): FlowMigrateController | null {
  const [chats, setChats] = useState<ChatsInState[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [moved, setMoved] = useState<number | null>(null);

  const rows = useMemo<FlowMigrateRow[]>(
    () =>
      chats.map((entry) => {
        const current = flow.states.find((state) => state.id === entry.stateId);
        return {
          ...entry,
          stateTitle: migration?.stateTitle?.(entry.versionId, entry.stateId) ?? current?.title ?? entry.stateId,
          removed: !current,
          target: current ? null : (targets[entry.stateId] ?? null),
        };
      }),
    [chats, flow, migration, targets],
  );

  const canMigrate = !busy && rows.length > 0 && rows.every((row) => !row.removed || row.chats === 0 || row.target !== null);

  const open = useCallback(() => {
    if (!migration) return;
    show();
    setMoved(null);
    setFailed(false);
    setBusy(true);
    migration
      .chatsByState()
      .then(setChats, () => setFailed(true))
      .finally(() => setBusy(false));
  }, [migration, show]);

  const setTarget = useCallback((stateId: string, target: string) => setTargets((current) => ({ ...current, [stateId]: target })), []);

  const run = useCallback(async () => {
    if (!migration) return;
    const map: StateMap = Object.fromEntries(rows.filter((row) => row.removed && row.target).map((row) => [row.stateId, row.target!]));
    setBusy(true);
    setFailed(false);
    try {
      const result = await migration.migrate(map);
      setMoved(result.moved);
      // Счётчик — заново с сервера: чаты, которые перевод пропустил (их держала другая копия), остаются в окне.
      setChats(await migration.chatsByState().catch(() => []));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [migration, rows]);

  if (!migration) return null;
  return { rows, busy, failed, moved, canMigrate, open, setTarget, run };
}
