import { fieldById } from "../../engine/flow-graph";
import { compactFlow } from "../../format/compact-flow";
import { parseFlow } from "../../format/parse-flow";
import {
  FLOW_OPS_BY_FIELD_TYPE,
  type AgentFlow,
  type ClientCardField,
  type FlowCondition,
  type FlowConditionType,
  type FlowExit,
  type FlowField,
  type FlowPoint,
  type FlowState,
} from "../../format/flow-format";

// Правки сценария в редакторе: чистые функции, каждая возвращает новый `AgentFlow`. Доска, панели и прогон зовут только их.

/** Чьё условие: id состояния или `null` — общие переходы «Из любого состояния». */
export type ExitOwner = string | null;

export type FieldList = "clientCard" | "chatNotes";

export type StatePatch = Partial<Pick<FlowState, "title" | "instructions" | "firstMessage" | "learn" | "tools" | "tags" | "noSideQuestions">>;

/** Свободный id вида `state_3`: не занят ни одним из `taken`. */
function freeId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let index = 1;
  while (used.has(`${prefix}_${index}`)) index += 1;
  return `${prefix}_${index}`;
}

function allExits(flow: AgentFlow): FlowExit[] {
  return [...flow.anyState.exits, ...flow.states.flatMap((state) => state.exits)];
}

function allFields(flow: AgentFlow): FlowField[] {
  return [...flow.clientCard, ...flow.chatNotes];
}

function editState(flow: AgentFlow, stateId: string, edit: (state: FlowState) => FlowState): AgentFlow {
  return { ...flow, states: flow.states.map((state) => (state.id === stateId ? edit(state) : state)) };
}

function editExits(flow: AgentFlow, owner: ExitOwner, edit: (exits: FlowExit[]) => FlowExit[]): AgentFlow {
  if (owner === null) return { ...flow, anyState: { ...flow.anyState, exits: edit(flow.anyState.exits) } };
  return editState(flow, owner, (state) => ({ ...state, exits: edit(state.exits) }));
}

function exitsOf(flow: AgentFlow, owner: ExitOwner): FlowExit[] {
  if (owner === null) return flow.anyState.exits;
  return flow.states.find((state) => state.id === owner)?.exits ?? [];
}

/** Переставляет элемент на `delta` позиций; за край — тот же массив. */
function shift<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return next;
}

export function addState(flow: AgentFlow, input: { title: string; at?: FlowPoint }): { flow: AgentFlow; stateId: string } {
  const stateId = freeId("state", flow.states.map((state) => state.id));
  const state: FlowState = {
    id: stateId,
    kind: "state",
    title: input.title,
    instructions: "",
    firstMessage: null,
    learn: [],
    noSideQuestions: false,
    tools: [],
    tags: [],
    exits: [],
  };
  return {
    stateId,
    flow: {
      ...flow,
      start: flow.states.length === 0 ? stateId : flow.start,
      states: [...flow.states, state],
      layout: input.at ? { ...flow.layout, [stateId]: input.at } : flow.layout,
    },
  };
}

/** Удаляет состояние: ведущие в него условия остаются без цели, из старта и исключений оно уходит. */
export function removeState(flow: AgentFlow, stateId: string): AgentFlow {
  const unlink = (exits: FlowExit[]) => exits.map((exit) => (exit.to === stateId ? { ...exit, to: null } : exit));
  const { [stateId]: _removed, ...layout } = flow.layout;
  return {
    ...flow,
    start: flow.start === stateId ? null : flow.start,
    states: flow.states.filter((state) => state.id !== stateId).map((state) => ({ ...state, exits: unlink(state.exits) })),
    anyState: { except: flow.anyState.except.filter((id) => id !== stateId), exits: unlink(flow.anyState.exits) },
    layout,
  };
}

export function updateState(flow: AgentFlow, stateId: string, patch: StatePatch): AgentFlow {
  return editState(flow, stateId, (state) => ({ ...state, ...patch }));
}

export function setStart(flow: AgentFlow, stateId: string): AgentFlow {
  return { ...flow, start: stateId };
}

export function setExcept(flow: AgentFlow, except: string[]): AgentFlow {
  return { ...flow, anyState: { ...flow.anyState, except } };
}

/** Условие нового вида со значениями по умолчанию; по данным — первое поле карточки или заметок. */
export function defaultCondition(kind: FlowConditionType, flow: AgentFlow): FlowCondition {
  switch (kind) {
    case "judge":
      return { type: "judge", text: "" };
    case "data":
      // Поля ещё нет — id-заглушка: формат её примет, проверка графа покажет «поля нет».
      return { type: "data", field: allFields(flow)[0]?.id ?? "field", op: "filled" };
    case "event":
      return { type: "event", event: "message" };
    case "timer":
      return { type: "timer", from: "in_state", amount: 1, unit: "h" };
  }
}

/**
 * Условие после правки в карточке. Скин меняет одно поле, а целым и годным условие делает редактор: другой вид —
 * значения по умолчанию; другое поле — сравнение, подходящее его типу; число из поля ввода — числом; таймер «время
 * суток» ↔ «сколько прошло» — со своими значениями.
 */
export function normalizeCondition(flow: AgentFlow, previous: FlowCondition, next: FlowCondition): FlowCondition {
  if (next.type !== previous.type) return defaultCondition(next.type, flow);
  if (next.type === "data") {
    const type = fieldById(flow, next.field)?.field.type;
    if (type === undefined) return next;
    if (!FLOW_OPS_BY_FIELD_TYPE[type].includes(next.op)) return { type: "data", field: next.field, op: "filled" };
    if (next.op === "filled") return { type: "data", field: next.field, op: "filled" };
    if (type === "boolean") return { type: "data", field: next.field, op: next.op, value: next.value !== false && next.value !== "false" };
    if (type === "number" && typeof next.value === "string" && next.value.trim() !== "" && Number.isFinite(Number(next.value))) {
      return { ...next, value: Number(next.value) };
    }
    return { ...next, value: next.value ?? "" };
  }
  if (next.type === "timer") {
    if (next.from === "time_of_day") return { type: "timer", from: "time_of_day", at: "at" in next && next.at ? next.at : "10:00" };
    // Дни переносятся между «длится N дней» и «до дня N программы».
    const days = "days" in next && next.days ? next.days : "day" in next && next.day ? next.day : 1;
    if (next.from === "state_days") return { type: "timer", from: "state_days", days };
    if (next.from === "program_day") return { type: "timer", from: "program_day", day: days };
    const span = next as Partial<typeof next>;
    return { type: "timer", from: next.from, amount: span.amount ?? 1, unit: span.unit ?? "h" };
  }
  if (next.type === "event" && next.event === "message") return { type: "event", event: "message" };
  return next;
}

export function addExit(flow: AgentFlow, owner: ExitOwner, kind: FlowConditionType): { flow: AgentFlow; exitId: string } {
  const exitId = freeId(owner ?? "any", allExits(flow).map((exit) => exit.id));
  const exit: FlowExit = { id: exitId, when: defaultCondition(kind, flow), to: null };
  return { exitId, flow: editExits(flow, owner, (exits) => [...exits, exit]) };
}

export function updateExit(flow: AgentFlow, owner: ExitOwner, exitId: string, next: { when: FlowCondition; to: string | null }): AgentFlow {
  return editExits(flow, owner, (exits) => exits.map((exit) => (exit.id === exitId ? { ...exit, ...next } : exit)));
}

/** Стрелка с доски: условие ведёт в `to`. */
export function connectExit(flow: AgentFlow, owner: ExitOwner, exitId: string, to: string): AgentFlow {
  return editExits(flow, owner, (exits) => exits.map((exit) => (exit.id === exitId ? { ...exit, to } : exit)));
}

export function moveExit(flow: AgentFlow, owner: ExitOwner, exitId: string, delta: number): AgentFlow {
  const exits = exitsOf(flow, owner);
  const moved = shift(exits, exits.findIndex((exit) => exit.id === exitId), delta);
  return moved === exits ? flow : editExits(flow, owner, () => moved);
}

export function removeExit(flow: AgentFlow, owner: ExitOwner, exitId: string): AgentFlow {
  return editExits(flow, owner, (exits) => exits.filter((exit) => exit.id !== exitId));
}

export function addField(flow: AgentFlow, list: FieldList, name: string): { flow: AgentFlow; fieldId: string } {
  const fieldId = freeId("field", allFields(flow).map((field) => field.id));
  const base: FlowField = { id: fieldId, name, about: "", type: "text", options: [] };
  if (list === "clientCard") {
    return { fieldId, flow: { ...flow, clientCard: [...flow.clientCard, { ...base, refreshAfterMonths: null }] } };
  }
  return { fieldId, flow: { ...flow, chatNotes: [...flow.chatNotes, base] } };
}

export function updateField(flow: AgentFlow, list: FieldList, fieldId: string, patch: Partial<ClientCardField>): AgentFlow {
  if (list === "clientCard") {
    return { ...flow, clientCard: flow.clientCard.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)) };
  }
  const { refreshAfterMonths: _cardOnly, ...notePatch } = patch;
  return { ...flow, chatNotes: flow.chatNotes.map((field) => (field.id === fieldId ? { ...field, ...notePatch } : field)) };
}

export function moveField(flow: AgentFlow, list: FieldList, fieldId: string, delta: number): AgentFlow {
  const fields: FlowField[] = flow[list];
  const moved = shift(fields, fields.findIndex((field) => field.id === fieldId), delta);
  return moved === fields ? flow : { ...flow, [list]: moved };
}

/** Удаляет поле и его «узнать здесь». Условия по нему остаются: их покажет проверка графа. */
export function removeField(flow: AgentFlow, list: FieldList, fieldId: string): AgentFlow {
  const fields: FlowField[] = flow[list];
  return {
    ...flow,
    [list]: fields.filter((field) => field.id !== fieldId),
    states: flow.states.map((state) => (state.learn.includes(fieldId) ? { ...state, learn: state.learn.filter((id) => id !== fieldId) } : state)),
  };
}

/** Где поставить новое состояние без места: под всеми узлами доски. */
export function freeSpot(flow: AgentFlow): FlowPoint {
  const points = Object.values(flow.layout);
  if (points.length === 0) return { x: 80, y: 80 };
  return { x: Math.min(...points.map((point) => point.x)), y: Math.max(...points.map((point) => point.y)) + 240 };
}

/** Место узла на доске; `ANY_STATE_LAYOUT_KEY` — узел общих переходов. */
export function placeNode(flow: AgentFlow, nodeId: string, at: FlowPoint): AgentFlow {
  return { ...flow, layout: { ...flow.layout, [nodeId]: { x: Math.round(at.x), y: Math.round(at.y) } } };
}

/** JSON сценария для окна JSON и скачивания: без значений по умолчанию, как в файлах примеров. */
export function flowToJson(flow: AgentFlow): string {
  return `${JSON.stringify(keepJudgeText(compactFlow(flow)), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, inner]) => [key, sortKeys(inner)]),
    );
  }
  return value;
}

/** Отпечаток сценария для сравнения: тот же `compactFlow`, что у JSON доски, но порядок ключей не важен. */
export function flowFingerprint(flow: AgentFlow): string {
  return JSON.stringify(sortKeys(keepJudgeText(compactFlow(flow))));
}

/**
 * Один ли это сценарий: сравнение так же, как считает «Сохранено» доска (пустые поля не в счёт). Порядок ключей не важен:
 * сценарий из jsonb приходит с другим порядком. Порядок состояний, условий и полей — важен.
 */
export function sameFlow(a: AgentFlow, b: AgentFlow): boolean {
  return flowFingerprint(a) === flowFingerprint(b);
}

type JsonExit = { when?: { type?: string; text?: string } };
type JsonState = { exits?: JsonExit[] };

/**
 * `compactFlow` убирает пустые строки, в том числе текст ещё не написанного условия словами, а без `text` такое условие
 * `parseFlow` не принимает. Возвращаем пустой текст, чтобы недописанный сценарий сохранялся и загружался обратно.
 */
function keepJudgeText(json: Record<string, unknown>): Record<string, unknown> {
  const fix = (exits: JsonExit[] | undefined) =>
    exits?.forEach((exit) => {
      if (exit.when?.type === "judge" && exit.when.text === undefined) exit.when.text = "";
    });
  (json.states as JsonState[]).forEach((state) => fix(state.exits));
  fix((json.anyState as { exits?: JsonExit[] } | undefined)?.exits);
  return json;
}

export type LoadFlowResult = { ok: true; flow: AgentFlow } | { ok: false; errors: string[] };

/** Загрузка JSON в редактор: та же `parseFlow`, что на сервере. Ошибки — строками «место: что не так». */
export function loadFlowJson(text: string): LoadFlowResult {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const result = parseFlow(input);
  if (result.ok) return result;
  return { ok: false, errors: result.errors.map((error) => (error.path ? `${error.path}: ${error.message}` : error.message)) };
}
