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
type MessageWindowState = WindowState & { messages?: number; count?: string };

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
      let outcome: { end: string | null; full: boolean; used: number; slot?: TakenMessageSlot } = { end: null, full: false, used: 0 };
      await store.update<MessageWindowState>(stateKey, (current) => {
        // Скользящее окно, которое не идёт, открывается этим сообщением.
        const span = currentSpan(window, current, now, true);
        const used = usedIn(current, span.start);
        outcome = { end: span.end, full: used >= limit, used: used + 1 };
        if (outcome.full) return null;
        const sameWindow = current !== null && current.start === span.start;
        const base: MessageWindowState = sameWindow ? current : { start: span.start, carriedUsd: 0, notified: [] };
        const count = (sameWindow && current.count) || crypto.randomUUID();
        const share = limit === 0 ? 1 : (used + 1) / limit;
        const reached = input.thresholds.filter((threshold) => share >= threshold && !base.notified.includes(threshold));
        outcome.slot = { stateKey, start: span.start, count, openedWindow: window.kind === "rolling" && !sameWindow, crossed: reached };
        return { ...base, start: span.start, messages: used + 1, count, notified: [...base.notified, ...reached] };
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
        const messages = current.messages - 1;
        if (slot.openedWindow && messages === 0) return { carriedUsd: 0, notified: [], start: null };
        const notified = options.unmarkThresholds ? current.notified.filter((threshold) => !slot.crossed.includes(threshold)) : current.notified;
        return { ...current, messages, notified };
      }),
    ),
  );
}
