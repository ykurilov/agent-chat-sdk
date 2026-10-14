import type { AgentChatMessage, StoredMessage } from "../conversation/types";
import { isHumanMessage } from "../agent-run/channel-notes";
import { joinedParts } from "../steering/turn-steering";

/**
 * Склейка пачки: человек пишет несколько сообщений подряд — агент отвечает одним ходом, когда человек замолчал на окно
 * тишины. Сообщения пачки лежат в истории отдельными, с отметкой пачки; модель видит их одним сообщением.
 */

/** Отметка сообщения пачки в его частях: окно тишины, с которым оно пришло, и время записи. Модели не уходит. */
export const BURST_PART_TYPE = "data-agent-burst";

/** Окно тишины по умолчанию: столько ждать после сообщения, прежде чем отвечать, мс. */
export const DEFAULT_BURST_QUIET_MS = 3000;
/** Окно длиннее — ошибка вызова: ход не должен ждать человека минутами. */
export const MAX_BURST_QUIET_MS = 600_000;
/**
 * Запас к окну, пока пачка в истории считается ждущей ответа (для касаний на другой копии сервера). Дольше — вызов,
 * который должен был ответить, пропал вместе с копией; его повтор ответит, а касания не ждут вечно.
 */
export const BURST_PENDING_GRACE_MS = 120_000;
/** Чат занят другой копией сервера (её ход или аренда): через столько пачка пробует снова. */
export const BURST_BUSY_RETRY_MS = 1000;

/** `at` — время записи сообщения, мс: по нему решается, одна ли пачка у соседей (`continuesBurst`). */
export function burstPart(quietMs: number, at: number): AgentChatMessage["parts"][number] {
  return { type: BURST_PART_TYPE, data: { quietMs, at } } as AgentChatMessage["parts"][number];
}

function burstDataOf(message: Pick<AgentChatMessage, "parts">): { quietMs?: unknown; at?: unknown } | undefined {
  return (message.parts.find((candidate) => candidate.type === BURST_PART_TYPE) as { data?: { quietMs?: unknown; at?: unknown } } | undefined)?.data;
}

/** Окно сообщения пачки; не пачка — `undefined`. */
function quietOf(message: Pick<AgentChatMessage, "role" | "parts">): number | undefined {
  if (message.role !== "user") return undefined;
  if (!message.parts.some((candidate) => candidate.type === BURST_PART_TYPE)) return undefined;
  const quietMs = burstDataOf(message)?.quietMs;
  return typeof quietMs === "number" && Number.isFinite(quietMs) && quietMs >= 0 ? quietMs : DEFAULT_BURST_QUIET_MS;
}

export function isBurstMessage(message: Pick<AgentChatMessage, "role" | "parts">): boolean {
  return quietOf(message) !== undefined;
}

/** Окно вызова: не задано — по умолчанию. @throws TypeError не целое число от 0 до `MAX_BURST_QUIET_MS`. */
export function resolveQuietMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_BURST_QUIET_MS;
  if (!Number.isInteger(value) || value < 0 || value > MAX_BURST_QUIET_MS) {
    throw new TypeError(`quietMs — целое число миллисекунд от 0 до ${MAX_BURST_QUIET_MS}`);
  }
  return value;
}

/**
 * Одна ли пачка у соседних сообщений: оба из пачки, а `later` записано в окне тишины `earlier`. Решают отметки пачки
 * (окно и время записи), а не время в базе: правленое сообщение сохраняет отметку и остаётся в своей пачке. Одно правило
 * и для склейки в запросе к модели, и для счёта хода.
 */
export function continuesBurst(earlier: Pick<AgentChatMessage, "role" | "parts">, later: Pick<AgentChatMessage, "role" | "parts">): boolean {
  const quietMs = quietOf(earlier);
  if (quietMs === undefined || !isBurstMessage(later)) return false;
  const earlierAt = burstDataOf(earlier)?.at;
  const laterAt = burstDataOf(later)?.at;
  return typeof earlierAt === "number" && typeof laterAt === "number" && laterAt - earlierAt <= quietMs;
}

/**
 * Сообщения одной пачки — одним сообщением человека: строгие провайдеры не принимают двух сообщений человека подряд, а
 * пометка «ответа нет» между ними была бы неправдой. Как поправки: текст следующего — через пустую строку. Соседи из
 * разных пачек (отложенное ночью и утреннее) остаются отдельными, как и в счёте хода. Зависит только от истории: на
 * каждом ходе те же байты, кэш модели цел.
 */
export function withBurstsJoined(history: readonly AgentChatMessage[]): AgentChatMessage[] {
  const joined: AgentChatMessage[] = [];
  let previous: AgentChatMessage | undefined;
  for (const message of history) {
    if (previous && continuesBurst(previous, message)) joined[joined.length - 1] = { ...joined.at(-1)!, parts: [...joined.at(-1)!.parts, ...joinedParts(message.parts)] };
    else joined.push(message);
    previous = message;
  }
  return joined;
}

/**
 * Сообщения пачки, которая кончается сообщением `index`: оно и сообщения прямо перед ним, пока соседи — одна пачка
 * (`continuesBurst`). Старое сообщение без ответа (записано без хода вчера) — уже не эта пачка: в счёт хода не идёт.
 */
function burstEndingAt(branch: readonly StoredMessage[], index: number): StoredMessage[] {
  const burst = [branch[index]!];
  for (let at = index - 1; at >= 0 && continuesBurst(branch[at]!, burst[0]!); at--) burst.unshift(branch[at]!);
  return burst;
}

/** Что делать вызову сообщения пачки, когда окно тишины прошло. */
export type BurstVerdict =
  /** Окно ещё идёт (часы копий разошлись): ждать столько. */
  | { kind: "wait"; ms: number }
  /** Ход не нужен: ответ уже есть, ответит более позднее сообщение или сообщения нет на ветке. */
  | { kind: "skip" }
  /** Начинать ход на пачку: её сообщения по порядку. */
  | { kind: "start"; burst: StoredMessage[] };

/**
 * Решение по ветке: после сообщения уже есть ответ агента или новое сообщение человека — ход не нужен (ответит ход
 * более позднего). Служебные сообщения без хода (пауза сотрудника) ход не отменяют. Всё решается по общей истории:
 * так же решит и другая копия сервера.
 */
export function burstVerdict(branch: readonly StoredMessage[], messageId: string, nowMs: number): BurstVerdict {
  const index = branch.findIndex((message) => message.id === messageId);
  if (index < 0 || !isBurstMessage(branch[index]!)) return { kind: "skip" };
  const after = branch.slice(index + 1);
  if (after.some((message) => message.role === "assistant" || isHumanMessage(message))) return { kind: "skip" };
  const message = branch[index]!;
  const left = Date.parse(message.createdAt) + quietOf(message)! - nowMs;
  if (left > 0) return { kind: "wait", ms: left };
  return { kind: "start", burst: burstEndingAt(branch, index) };
}

/**
 * Ждёт ли в конце ветки пачка без ответа: последнее сообщение человека — из пачки, после него нет ответа, а окно с
 * запасом ещё не прошло. Пока ждёт, ход по служебному сообщению (касание сценария) не начинается.
 */
export function isBurstPending(branch: readonly StoredMessage[], nowMs: number): boolean {
  for (let at = branch.length - 1; at >= 0; at--) {
    const message = branch[at]!;
    if (message.role === "assistant") return false;
    if (!isHumanMessage(message)) continue;
    const quietMs = quietOf(message);
    return quietMs !== undefined && nowMs < Date.parse(message.createdAt) + quietMs + BURST_PENDING_GRACE_MS;
  }
  return false;
}

/**
 * Пачка, на которую отвечает новый ответ после `branch`: последнее сообщение человека — из пачки, ответа после него нет.
 * Так же — у «Повторить» и «Переделать» ответа на пачку: счёт сообщений тот же. Иначе — `undefined`.
 */
export function burstToAnswer(branch: readonly StoredMessage[]): StoredMessage[] | undefined {
  for (let at = branch.length - 1; at >= 0; at--) {
    const message = branch[at]!;
    if (message.role === "assistant") return undefined;
    if (isHumanMessage(message)) return isBurstMessage(message) ? burstEndingAt(branch, at) : undefined;
  }
  return undefined;
}

/** Текст пачки для `beforeTurn`: тексты сообщений через пустую строку. */
export function burstText(burst: readonly StoredMessage[]): string {
  return burst
    .map((message) => message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

/** Окна тишины этой копии по чатам: касания их ждут, остановка службы их обрывает. */
export interface BurstWaits {
  /** Ждёт `ms` по чату; `wake` чата кончает ожидание раньше; остановка (`cancelAll`) — отказ `cancelled()`. */
  wait(chatId: string, ms: number, cancelled: () => Error): Promise<void>;
  /** Кончает ожидания чата сейчас: их пачки решают заново (например, после «Стоп»). */
  wake(chatId: string): void;
  /** Ждёт ли в чате хоть одно окно или решение по пачке (`holding`). */
  has(chatId: string): boolean;
  /** Решение по пачке идёт: чат считается ждущим, пока `work` не кончится. */
  holding<T>(chatId: string, work: () => Promise<T>): Promise<T>;
  /** Обрывает все окна: их `wait` отказывают. */
  cancelAll(): void;
  /** Ждёт, пока кончатся все решения по пачкам (`holding`). */
  settled(): Promise<void>;
}

export function createBurstWaits(): BurstWaits {
  const waiting = new Map<string, number>();
  const timers = new Set<{ chatId: string; timer: ReturnType<typeof setTimeout>; done: () => void; cancel: () => void }>();
  const works = new Set<Promise<unknown>>();
  const enter = (chatId: string) => waiting.set(chatId, (waiting.get(chatId) ?? 0) + 1);
  const leave = (chatId: string) => {
    const left = (waiting.get(chatId) ?? 1) - 1;
    if (left > 0) waiting.set(chatId, left);
    else waiting.delete(chatId);
  };
  return {
    wait(chatId, ms, cancelled) {
      return new Promise<void>((resolve, reject) => {
        const entry = {
          chatId,
          timer: setTimeout(() => entry.done(), ms),
          done: () => {
            clearTimeout(entry.timer);
            timers.delete(entry);
            resolve();
          },
          cancel: () => {
            clearTimeout(entry.timer);
            timers.delete(entry);
            reject(cancelled());
          },
        };
        timers.add(entry);
      });
    },
    wake(chatId) {
      for (const entry of [...timers]) if (entry.chatId === chatId) entry.done();
    },
    has: (chatId) => waiting.has(chatId),
    async holding(chatId, work) {
      enter(chatId);
      const running = work();
      works.add(running);
      try {
        return await running;
      } finally {
        works.delete(running);
        leave(chatId);
      }
    },
    cancelAll() {
      for (const entry of [...timers]) entry.cancel();
    },
    async settled() {
      while (works.size > 0) await Promise.allSettled([...works]);
    },
  };
}
