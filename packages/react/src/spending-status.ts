/** Чей лимит и за какой срок; как в ответе сервера. */
export type SpendingScope = "user" | "chat" | "service";
/** `rolling` — окно на `hours` часов от первого запроса. */
export type SpendingPeriod = "month" | "week" | "day" | "rolling" | "none";
/** Почему ход не начнётся: лимит исчерпан, человек заблокирован или остаток меньше запаса на новый ответ. */
export type SpendingRefusalReason = "limit" | "blocked" | "reserve";

/** Одно окно лимита: доля и срок, без долларов. У окна сообщений — и сами числа. */
export interface SpendingWindowInfo {
  id: string;
  scope: SpendingScope;
  period: SpendingPeriod;
  hours?: number;
  state: "ok" | "warning" | "exhausted";
  share: number;
  resetsAt: Date | null;
  /** Окно считает сообщения человека; нет — деньги. */
  unit?: "messages";
  /** Окно сообщений: лимит, отправлено и осталось. */
  limit?: number;
  used?: number;
  remaining?: number;
}

/** Что известно о лимите: из этого слой поведения собирает надпись. Долларов здесь нет. */
export interface SpendingInfo {
  scope: SpendingScope;
  period: SpendingPeriod;
  /** Длина скользящего окна в часах. */
  hours?: number;
  /** Доля израсходованного, 0…1 и больше при перерасходе; `null` — сервер её не назвал (отказ хода). */
  share: number | null;
  /** Когда расход обнулится; `null` — никогда. */
  resetsAt: Date | null;
  /** Пояс лимитов (IANA), по которому показывать дату обновления; нет — UTC. */
  timeZone?: string;
  /** Почему ход не начнётся (лимиты с окнами); нет — исчерпан лимит. */
  reason?: SpendingRefusalReason;
  /** Имя самого тесного окна (лимиты с окнами). */
  windowId?: string;
  /** Все окна с лимитом по отдельности (лимиты с окнами): приложение может показать их сами. */
  windows?: SpendingWindowInfo[];
  /** Самое тесное окно считает сообщения человека; нет — деньги. */
  unit?: "messages";
  /** Сколько сообщений осталось в этом окне; в отказе 429 числа нет. */
  remaining?: number;
}

/** Лимит, о котором надо сказать собеседнику: пока всё в пределах, показывать нечего. */
export interface SpendingView {
  state: "warning" | "exhausted";
  info: SpendingInfo;
}

/** Ответ сервера на `GET …/spending` и тело отказа 429 (в отказе `state` нет). */
interface WireSpending {
  state?: string;
  scope?: string;
  period?: string;
  hours?: number;
  share?: number;
  resetsAt?: string | null;
  timeZone?: string;
  reason?: string;
  windowId?: string;
  blocked?: boolean;
  windows?: unknown;
  unit?: string;
  remaining?: number;
}

/** Не дальше, чем умеет `setTimeout`: месяц с лишним в него не влезает. */
export const MAX_TIMER_MS = 2_147_483_647;
/** Как часто спрашивать сервер, если срок обновления уже прошёл, а лимит ещё стоит (часы вкладки и сервера расходятся). */
export const RESET_RECHECK_MS = 5_000;

const SCOPES: readonly SpendingScope[] = ["user", "chat", "service"];
const PERIODS: readonly SpendingPeriod[] = ["month", "week", "day", "rolling", "none"];
const REASONS: readonly SpendingRefusalReason[] = ["limit", "blocked", "reserve"];

const scopeOf = (scope: unknown): SpendingScope => (SCOPES.includes(scope as SpendingScope) ? (scope as SpendingScope) : "user");
const periodOf = (period: unknown): SpendingPeriod => (PERIODS.includes(period as SpendingPeriod) ? (period as SpendingPeriod) : "month");
const hoursOf = (hours: unknown) => (typeof hours === "number" && hours > 0 ? { hours } : {});
const countOf = (count: unknown) => typeof count === "number" && Number.isInteger(count) && count >= 0;
/** Числа окна сообщений; денежному окну — ничего. */
function messageCountsOf(wire: { unit?: unknown; limit?: unknown; used?: unknown; remaining?: unknown }) {
  if (wire.unit !== "messages") return {};
  return {
    unit: "messages" as const,
    ...(countOf(wire.limit) && { limit: wire.limit as number }),
    ...(countOf(wire.used) && { used: wire.used as number }),
    ...(countOf(wire.remaining) && { remaining: wire.remaining as number }),
  };
}

export function spendingInfoOf(wire: WireSpending): SpendingInfo {
  const reason = wire.blocked === true ? "blocked" : REASONS.includes(wire.reason as SpendingRefusalReason) ? (wire.reason as SpendingRefusalReason) : undefined;
  if (reason === "blocked") return { scope: "user", period: "none", share: null, resetsAt: null, reason };
  const windows = Array.isArray(wire.windows) ? wire.windows.flatMap(windowInfoOf) : [];
  return {
    scope: scopeOf(wire.scope),
    period: periodOf(wire.period),
    ...hoursOf(wire.hours),
    share: typeof wire.share === "number" ? wire.share : null,
    resetsAt: wire.resetsAt ? new Date(wire.resetsAt) : null,
    ...(typeof wire.timeZone === "string" && { timeZone: wire.timeZone }),
    ...(reason && { reason }),
    ...(typeof wire.windowId === "string" && { windowId: wire.windowId }),
    ...(windows.length > 0 && { windows }),
    ...messageCountsOf(wire),
  };
}

function windowInfoOf(wire: unknown): SpendingWindowInfo[] {
  if (typeof wire !== "object" || wire === null) return [];
  const window = wire as Record<string, unknown>;
  if (typeof window.id !== "string" || typeof window.share !== "number") return [];
  const state = window.state === "warning" || window.state === "exhausted" ? window.state : "ok";
  return [
    {
      id: window.id,
      scope: scopeOf(window.scope),
      period: periodOf(window.period),
      ...hoursOf(window.hours),
      state,
      share: window.share,
      resetsAt: typeof window.resetsAt === "string" ? new Date(window.resetsAt) : null,
      ...messageCountsOf(window),
    },
  ];
}

/** `null` — лимит в пределах или ответ не разобрать: надписи нет. */
export function spendingViewOf(wire: WireSpending): SpendingView | null {
  if (wire.state !== "warning" && wire.state !== "exhausted") return null;
  return { state: wire.state, info: spendingInfoOf(wire) };
}

/** Через сколько спросить сервер снова, чтобы снять исчерпание сразу после обновления. */
export function untilResetCheckMs(info: SpendingInfo, now: number): number | null {
  if (!info.resetsAt) return null;
  const wait = info.resetsAt.getTime() - now;
  return wait > 0 ? Math.min(wait, MAX_TIMER_MS) : RESET_RECHECK_MS;
}
