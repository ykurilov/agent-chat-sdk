import type { SpendingState } from "@ykurilov/agent-chat-core";
import type { LimitStateStore } from "./limit-state";
import { spendingState } from "./spending-state";
import type { SpendingSubject, SpendingWindow } from "./spending-windows";
import { currentSpan, windowStateKey } from "./window-reading";
import type { WindowState } from "./window-reading";

/**
 * Состояние окна сообщений: то же, что у денег, и число сообщений в окне с началом `start`. `count` — метка этого
 * счёта: новое окно и ручной сброс начинают новый счёт с новой меткой, и старое место в него уже не вернуть.
 */
type MessageWindowState = WindowState & { messages?: number; count?: string; pending?: PendingMessage[] };

/** Место, взятое под сообщение, которое ещё не подтвердило запись: `at` — когда взято, `count` — метка счёта. */
interface PendingMessage {
  messageId: string;
  at: string;
  count: string;
}

/**
 * Сколько ждать подтверждения записи, мс. Запись с файлами идёт секунды; место без подтверждения дольше этого —
 * процесс упал между местом и записью: нет сообщения — место возвращается.
 */
export const UNCONFIRMED_SLOT_MS = 10 * 60_000;

/** Окно сообщений человека, чата или сервиса сейчас. */
export interface MessageWindowReading {
  window: SpendingWindow;
  limit: number;
  /** Сообщений в окне; скользящее, которое ещё не началось, — 0. */
  used: number;
  /** Начало окна; `null` — окно на всё время или скользящее ещё не началось. */
  start: string | null;
  resetsAt: string | null;
  state: SpendingState;
  share: number;
}

/** Место, взятое в окне: отдать его назад можно, только пока счёт тот же — окно не сменилось и не сброшено. */
export interface TakenMessageSlot {
  stateKey: string;
  start: string | null;
  /** Метка счёта, в который взято место. */
  count: string;
  /** Это место открыло скользящее окно: вернули последнее — окно снова закрыто, как будто сообщения не было. */
  openedWindow: boolean;
  /** Пороги, которые это место отметило пройденными. */
  crossed: number[];
  /** Сообщение, под которое взято место: до подтверждения оно в `pending` окна. */
  messageId?: string;
}

/** Сообщение дошло до порога окна: о нём скажет `onMessageThreshold`. */
export interface MessageThresholdCrossing {
  window: SpendingWindow;
  threshold: number;
  used: number;
  limit: number;
  start: string | null;
  resetsAt: string | null;
}

/** Окно, в котором места не нашлось, и когда оно обновится. */
export interface MessageRefusal {
  window: SpendingWindow;
  resetsAt: string | null;
}

/** Окно сообщений и его лимит для этого человека. */
export interface LimitedMessageWindow {
  window: SpendingWindow;
  limit: number;
}

/** Сколько сообщений в окне: запись другого окна (прошлые сутки, кончившееся скользящее) не считается. */
function usedIn(saved: MessageWindowState | null, start: string | null): number {
  return saved !== null && saved.start === start ? (saved.messages ?? 0) : 0;
}

/** Окно сообщений для статуса и отчёта: только чтение, скользящее не открывается. */
export async function readMessageWindow(input: {
  window: SpendingWindow;
  subject: SpendingSubject;
  limit: number;
  now: Date;
  store: LimitStateStore;
  warnAt: number;
}): Promise<MessageWindowReading | null> {
  const { window, limit } = input;
  const stateKey = windowStateKey(window, input.subject);
  if (stateKey === null) return null;
  const saved = await input.store.read<MessageWindowState>(stateKey);
  const span = currentSpan(window, saved, input.now, false);
  const used = span.active ? usedIn(saved, span.start) : 0;
  const judged = spendingState({ spentUsd: used, limitUsd: limit, warnAt: input.warnAt });
  return { window, limit, used, start: span.start, resetsAt: span.end, state: judged.state, share: judged.share };
}

/**
 * Место под одно сообщение в каждом окне. Проверка и `+1` — одна условная запись по версии: два сообщения на последнее
 * место не пройдут оба. Первое же окно без места останавливает взятие; остальные окна только читаются, чтобы назвать
 * все исчерпанные. Есть отказы — взятое уже отдано назад. Пороги `thresholds`, до которых дошёл счёт, отмечаются той же
 * записью и возвращаются в `crossed`: каждый порог окна — один раз.
 */
export async function takeMessageSlots(input: {
  windows: readonly LimitedMessageWindow[];
  subject: SpendingSubject;
  now: Date;
  store: LimitStateStore;
  thresholds: readonly number[];
  /** Сообщение, под которое берётся место: место ждёт подтверждения записи. */
  messageId?: string;
  /** Записано ли сообщение: так решается судьба мест, не дождавшихся подтверждения. */
  messageWritten?: (messageId: string) => Promise<boolean>;
}): Promise<{ taken: TakenMessageSlot[]; refused: MessageRefusal[]; crossed: MessageThresholdCrossing[] }> {
  const { store, now } = input;
  const taken: TakenMessageSlot[] = [];
  const refused: MessageRefusal[] = [];
  const crossed: MessageThresholdCrossing[] = [];
  try {
    for (const { window, limit } of input.windows) {
      const stateKey = windowStateKey(window, input.subject);
      if (stateKey === null) continue;
      if (refused.length > 0) {
        const saved = await store.read<MessageWindowState>(stateKey);
        const span = currentSpan(window, saved, now, true);
        if (usedIn(saved, span.start) >= limit) refused.push({ window, resetsAt: span.end });
        continue;
      }
      const abandoned = input.messageWritten ? await abandonedMessages(store, stateKey, now, input.messageWritten) : new Map<string, boolean>();
      let outcome: { end: string | null; full: boolean; used: number; slot?: TakenMessageSlot } = { end: null, full: false, used: 0 };
      await store.update<MessageWindowState>(stateKey, (saved) => {
        const current = withoutAbandoned(saved, abandoned);
        // Скользящее окно, которое не идёт, открывается этим сообщением.
        const span = currentSpan(window, current, now, true);
        const used = usedIn(current, span.start);
        outcome = { end: span.end, full: used >= limit, used: used + 1 };
        // Места нет, но брошенные места разобраны: это записывается, чтобы не проверять их снова.
        if (outcome.full) return current !== saved ? current : null;
        const sameWindow = current !== null && current.start === span.start;
        const base: MessageWindowState = sameWindow ? current : { start: span.start, carriedUsd: 0, notified: [] };
        const count = (sameWindow && current.count) || crypto.randomUUID();
        const share = limit === 0 ? 1 : (used + 1) / limit;
        const reached = input.thresholds.filter((threshold) => share >= threshold && !base.notified.includes(threshold));
        const { messageId } = input;
        outcome.slot = { stateKey, start: span.start, count, openedWindow: window.kind === "rolling" && !sameWindow, crossed: reached, ...(messageId !== undefined && { messageId }) };
        const pending = [...(base.pending ?? []), ...(messageId !== undefined ? [{ messageId, at: now.toISOString(), count }] : [])];
        return { ...base, start: span.start, messages: used + 1, count, notified: [...base.notified, ...reached], ...(pending.length > 0 && { pending }) };
      });
      if (outcome.full) {
        refused.push({ window, resetsAt: outcome.end });
        continue;
      }
      const slot = outcome.slot!;
      taken.push(slot);
      for (const threshold of slot.crossed) crossed.push({ window, threshold, used: outcome.used, limit, start: slot.start, resetsAt: outcome.end });
    }
  } catch (failure) {
    await giveBackMessageSlots(store, taken, { unmarkThresholds: true });
    throw failure;
  }
  if (refused.length > 0) {
    // Сообщение не прошло: о порогах никто не узнал, они снова не пройдены.
    await giveBackMessageSlots(store, taken, { unmarkThresholds: true });
    return { taken: [], refused, crossed: [] };
  }
  return { taken, refused, crossed };
}

/**
 * Отдать взятые места: окно сменилось или сброшено — отдавать нечего. Скользящее окно, которое открыло это место,
 * без сообщений снова закрывается: следующее сообщение откроет его от своего времени. `unmarkThresholds` — о порогах,
 * которые отметило место, никто не узнал: они снова не пройдены. Без него отметки остаются: событие уже ушло, второго
 * на тот же порог не будет.
 */
export async function giveBackMessageSlots(
  store: LimitStateStore,
  taken: readonly TakenMessageSlot[],
  options: { unmarkThresholds?: boolean } = {},
): Promise<void> {
  await Promise.all(
    taken.map((slot) =>
      store.update<MessageWindowState>(slot.stateKey, (current) => {
        if (current === null || current.start !== slot.start || current.count !== slot.count || !current.messages) return null;
        // Место уже вернули сами лимиты: сообщение не подтвердилось вовремя.
        if (slot.messageId !== undefined && !current.pending?.some((entry) => entry.messageId === slot.messageId)) return null;
        const messages = current.messages - 1;
        if (slot.openedWindow && messages === 0) return { carriedUsd: 0, notified: [], start: null };
        const notified = options.unmarkThresholds ? current.notified.filter((threshold) => !slot.crossed.includes(threshold)) : current.notified;
        return withoutPending({ ...current, messages, notified }, slot.messageId);
      }),
    ),
  );
}

/** Сообщение записано: место за ним насовсем, ждать подтверждения больше нечего. */
export async function confirmMessageSlots(store: LimitStateStore, taken: readonly TakenMessageSlot[]): Promise<void> {
  await Promise.all(
    taken.map((slot) =>
      store.update<MessageWindowState>(slot.stateKey, (current) =>
        current?.pending?.some((entry) => entry.messageId === slot.messageId) ? withoutPending(current, slot.messageId) : null,
      ),
    ),
  );
}

function withoutPending(state: MessageWindowState, messageId: string | undefined): MessageWindowState {
  const { pending, ...rest } = state;
  const left = (pending ?? []).filter((entry) => entry.messageId !== messageId);
  return left.length > 0 ? { ...rest, pending: left } : rest;
}

/** Места окна, не дождавшиеся подтверждения дольше `UNCONFIRMED_SLOT_MS`: id сообщения → записано ли оно. */
async function abandonedMessages(
  store: LimitStateStore,
  stateKey: string,
  now: Date,
  messageWritten: (messageId: string) => Promise<boolean>,
): Promise<Map<string, boolean>> {
  const saved = await store.read<MessageWindowState>(stateKey);
  const stale = (saved?.pending ?? []).filter((entry) => now.getTime() - Date.parse(entry.at) >= UNCONFIRMED_SLOT_MS);
  return new Map(await Promise.all(stale.map(async (entry) => [entry.messageId, await messageWritten(entry.messageId)] as const)));
}

/** Разобрать брошенные места: записанное сообщение место сохраняет, незаписанное — возвращает в тот же счёт. */
function withoutAbandoned(state: MessageWindowState | null, abandoned: ReadonlyMap<string, boolean>): MessageWindowState | null {
  if (state === null || abandoned.size === 0 || !state.pending) return state;
  let messages = state.messages ?? 0;
  const pending: PendingMessage[] = [];
  for (const entry of state.pending) {
    const written = abandoned.get(entry.messageId);
    if (written === undefined) pending.push(entry);
    else if (!written && entry.count === state.count && messages > 0) messages -= 1;
  }
  const { pending: _settled, ...rest } = state;
  return { ...rest, messages, ...(pending.length > 0 && { pending }) };
}
