import type { SpendingState, UsageFilter } from "@ykurilov/agent-chat-core";
import type { LimitStateStore } from "./limit-state";
import { calendarBounds } from "./spending-period";
import { spendingState } from "./spending-state";
import type { SpendingSubject, SpendingWindow } from "./spending-windows";

const HOUR_MS = 3_600_000;

/**
 * Состояние окна в хранилище. `start` — начало окна, к которому относится запись (календарное — его начало,
 * скользящее — первый запрос, на всё время — `null`). Перешли в новое окно — перенос, сброс и пороги прошлого не действуют.
 */
export interface WindowState {
  start: string | null;
  /** Перерасход прошлого окна, перенесённый в это. */
  carriedUsd: number;
  /** Ручной сброс: расход до этого момента в окне не считается. */
  resetAt?: string;
  /** Пороги, о которых в этом окне уже сообщено. */
  notified: number[];
}

export interface WindowReading {
  window: SpendingWindow;
  /** Ключ состояния окна этого человека, чата или сервиса. */
  stateKey: string;
  /** Лимит в долларах; `null` — лимита нет (читается только для отчёта). */
  limitUsd: number | null;
  /** Начало окна; `null` — окно на всё время или скользящее ещё не началось. */
  start: string | null;
  resetsAt: string | null;
  /** Скользящее окно ещё не началось: ждёт первого запроса. */
  waiting: boolean;
  /** Расход в окне вместе с переносом и заказанным, но не записанным. */
  spentUsd: number;
  carriedUsd: number;
  state: SpendingState;
  share: number | null;
  /** Состояние, которое стоит записать: окно сменилось или скользящее открыто этим запросом. */
  nextState: WindowState | null;
  /** Начало окна в прочитанной записи: новая запись ложится, только если её никто не сменил. */
  savedStart: string | null | undefined;
}

export interface ReadWindowInput {
  window: SpendingWindow;
  subject: SpendingSubject;
  limitUsd: number | undefined;
  now: Date;
  store: LimitStateStore | null;
  sumSince: (filter: UsageFilter, since: string | null) => Promise<number>;
  warnAt: number;
  /** Скользящее окно, которое не идёт, открывается этим запросом (проверка перед ходом). */
  open: boolean;
  pendingUsd?: number;
}

/** Ключ состояния окна; у окна чата без чата — `null` (окно не читается). */
export function windowStateKey(window: SpendingWindow, subject: SpendingSubject): string | null {
  if (window.scope === "service") return `window:service:${window.id}`;
  if (window.scope === "user") return `window:user:${subject.userId}:${window.id}`;
  return subject.chatId === undefined ? null : `window:chat:${subject.chatId}:${window.id}`;
}

export function usageFilterOf(window: SpendingWindow, subject: SpendingSubject): UsageFilter {
  if (window.scope === "service") return {};
  if (window.scope === "user") return { ownerId: subject.userId };
  return { ownerId: subject.userId, chatId: subject.chatId! };
}

/** Где сейчас окно: начало, конец и идёт ли оно. */
export function currentSpan(window: SpendingWindow, saved: WindowState | null, now: Date, open: boolean) {
  if (window.kind === "total") return { start: null, end: null, active: true };
  if (window.kind === "calendar") {
    const bounds = calendarBounds(window.unit!, now, window.timeZone, window.weekStartsOn);
    return { start: bounds.start, end: bounds.end, active: true };
  }
  const hoursMs = window.hours! * HOUR_MS;
  if (saved?.start && now.getTime() < Date.parse(saved.start) + hoursMs) {
    return { start: saved.start, end: new Date(Date.parse(saved.start) + hoursMs).toISOString(), active: true };
  }
  if (open) return { start: now.toISOString(), end: new Date(now.getTime() + hoursMs).toISOString(), active: true };
  return { start: null, end: null, active: false };
}

export async function readWindow(input: ReadWindowInput): Promise<WindowReading | null> {
  const { window, subject, now, store } = input;
  const stateKey = windowStateKey(window, subject);
  if (stateKey === null) return null;
  const filter = usageFilterOf(window, subject);
  const saved = store ? await store.read<WindowState>(stateKey) : null;
  const span = currentSpan(window, saved, now, input.open);
  const sameWindow = saved !== null && span.active && saved.start === span.start;
  const limitUsd = input.limitUsd ?? null;
  let carriedUsd = 0;
  if (sameWindow) carriedUsd = saved.carriedUsd;
  else if (window.carryOverrun && limitUsd !== null) carriedUsd = await carryInto({ ...input, filter, saved, spanStart: span.start, limitUsd });
  const since = latest(span.start, sameWindow ? saved.resetAt : undefined);
  const recorded = span.active ? await input.sumSince(filter, since) : 0;
  const spentUsd = recorded + carriedUsd + Math.max(0, input.pendingUsd ?? 0);
  const judged = limitUsd === null ? { state: "ok" as const, share: null } : spendingState({ spentUsd, limitUsd, warnAt: input.warnAt });
  const changed = !sameWindow && span.active && store !== null && (window.kind === "rolling" || carriedUsd > 0 || saved !== null);
  return {
    window,
    stateKey,
    limitUsd,
    start: span.start,
    resetsAt: span.end,
    waiting: !span.active,
    spentUsd,
    carriedUsd,
    state: judged.state,
    share: judged.share,
    nextState: changed ? { start: span.start, carriedUsd, notified: [] } : null,
    savedStart: saved === null ? undefined : saved.start,
  };
}

/**
 * Перерасход прошлого окна, который переходит в новое: расход прошлого окна (с его переносом и после его сброса)
 * сверх лимита. Календарное окно — только соседнее прошлое; скользящее — последнее записанное.
 */
async function carryInto(
  input: ReadWindowInput & { filter: UsageFilter; saved: WindowState | null; spanStart: string | null; limitUsd: number },
): Promise<number> {
  const { window, saved, filter, limitUsd } = input;
  if (window.kind === "total") return 0;
  if (window.kind === "rolling") {
    if (!saved?.start) return 0;
    const end = new Date(Date.parse(saved.start) + window.hours! * HOUR_MS).toISOString();
    const spent = (await spentBetween(input, filter, latest(saved.start, saved.resetAt), end)) + saved.carriedUsd;
    return Math.max(0, spent - limitUsd);
  }
  const start = input.spanStart!;
  const previous = calendarBounds(window.unit!, new Date(Date.parse(start) - 1), window.timeZone, window.weekStartsOn);
  const known = saved !== null && saved.start === previous.start;
  const since = latest(previous.start, known ? saved.resetAt : undefined);
  const spent = (await spentBetween(input, filter, since, start)) + (known ? saved.carriedUsd : 0);
  return Math.max(0, spent - limitUsd);
}

async function spentBetween(input: ReadWindowInput, filter: UsageFilter, since: string | null, until: string): Promise<number> {
  if (since !== null && since >= until) return 0;
  const [fromStart, fromEnd] = await Promise.all([input.sumSince(filter, since), input.sumSince(filter, until)]);
  return fromStart - fromEnd;
}

/** Более поздний из моментов ISO; `null` и `undefined` — «без начала». */
function latest(start: string | null, other: string | undefined): string | null {
  if (other === undefined) return start;
  if (start === null) return other;
  return other > start ? other : start;
}
