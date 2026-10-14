import type { FlowSchedule } from "../format/flow-format";
import type { CanWriteNow, FirstMessagesRules, FirstMessagesSetting } from "../engine/flow-run";
import { firstMessageSlot, localDay, resolveFirstMessages } from "../engine/first-messages";
import { nextDayStartAfter } from "../engine/flow-days";
import { dayClosedToday } from "../engine/day-frame";
import type { FlowChatRecord, FlowStore } from "../store/flow-store";
import type { FirstMessageRules, FlowPeople } from "./flow-types";
import { FIRST_MESSAGE_MIN_RETRY_MS, FIRST_MESSAGE_RETRY_MS } from "./first-message-retry";

/** Что в записи чата запрещает писать первым. */
export type FlowChatWriteState = Pick<FlowChatRecord, "dayClosedOn" | "pausedUntil" | "windowClosed">;

/**
 * Запрет из записи чата, до правил приложения: окно канала закрыто — молчать до сообщения человека (`retryAt: null`);
 * пауза сотрудника — до её конца; агент закрыл день — до начала следующего. Нет запрета — `null`.
 */
export function chatWriteBlock(chat: FlowChatWriteState, at: number, timeZone: string, schedule: FlowSchedule | undefined): { retryAt: number | null } | null {
  if (chat.windowClosed) return { retryAt: null };
  const pausedUntil = chat.pausedUntil ? Date.parse(chat.pausedUntil) : 0;
  if (pausedUntil > at) return { retryAt: pausedUntil };
  if (schedule && dayClosedToday(chat.dayClosedOn, at, timeZone, schedule)) return { retryAt: nextDayStartAfter(at, timeZone, schedule) };
  return null;
}

/** Итоговые правила: ночь и потолок сценария главнее настроек приложения, те — значений SDK. */
function scenarioRules(rules: FirstMessagesRules, schedule: FlowSchedule | undefined): Omit<FirstMessagesRules, "canWriteNow"> {
  if (!schedule) return rules;
  return {
    quietHours: { from: schedule.nightFrom ?? rules.quietHours.from, to: schedule.dayStart },
    maxPerDay: schedule.firstMessages?.maxPerDay ?? rules.maxPerDay,
  };
}

/** Правила «писать первым» на хранилище счётчиков; `false` в настройках — `null`, агент пишет первым без ограничений. */
export function createFirstMessageRules(setting: FirstMessagesSetting | undefined, store: FlowStore): FirstMessageRules | null {
  const rules = resolveFirstMessages(setting);
  if (!rules) return null;
  return {
    async check({ ownerId, chatId, at, timeZone, schedule, chat }) {
      const blocked = chat ? chatWriteBlock(chat, at, timeZone, schedule) : null;
      if (blocked) return { allowed: false, retryAt: blocked.retryAt };
      const sentToday = await store.countFirstMessages(ownerId, localDay(at, timeZone));
      const slot = firstMessageSlot(scenarioRules(rules, schedule), { at, timeZone, sentToday });
      if (!slot.allowed) return slot;
      // Приложение спрашивается только тогда, когда остальные правила уже разрешили.
      const answer = rules.canWriteNow ? await rules.canWriteNow({ ownerId, chatId, at: new Date(at) }) : true;
      if (answer === true) return { allowed: true };
      // Конец разговора от ответа не зависит: повтор только у касаний.
      return { allowed: false, retryAt: retryAtOf(answer, at) };
    },
    async record({ ownerId, at, timeZone }) {
      await store.addFirstMessage(ownerId, localDay(at, timeZone));
    },
  };
}

/**
 * Когда спросить снова после «нет» приложения: `"never"` — до сообщения человека (`null`); `false` и негодная дата — через
 * час; дата в прошлом — не раньше чем через минуту, а не каждый обход.
 */
function retryAtOf(answer: Exclude<CanWriteNow, true>, at: number): number | null {
  if (answer === "never") return null;
  const retryAt = typeof answer === "object" && answer !== null && answer.retryAt instanceof Date ? answer.retryAt.getTime() : Number.NaN;
  if (!Number.isFinite(retryAt)) return at + FIRST_MESSAGE_RETRY_MS;
  return Math.max(retryAt, at + FIRST_MESSAGE_MIN_RETRY_MS);
}

// ---------- Пояс человека → В10: страница → пояс приложения → пояс сервера ----------

/** Пояс чата ещё не известен: страница его не присылала. */
export const UNKNOWN_TIME_ZONE = "";

export const serverTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Пояс страницы из пояса хода. Ядро с 0.53 говорит его прямо (`pageTimeZone`). Без этого поля: ядро без пояса страницы
 * подставляет запасной (приложения или сервера), поэтому совпадение с запасным — «страница пояс не прислала»: такой пояс
 * не затирает известный пояс чата.
 */
export function pageTimeZone(turnZone: string, appZone: string | undefined, sent?: string | null): string | null {
  if (sent !== undefined) return sent;
  return turnZone === (appZone ?? serverTimeZone()) ? null : turnZone;
}

/**
 * Пояс чата для таймеров: известный (человека или со страницы), иначе `defaultTimeZone`, иначе приложения, иначе
 * сервера — с предупреждением один раз на чат.
 */
export function createChatTimeZones(input: { appTimeZone: () => string | undefined; defaultTimeZone?: string; warn: (message: string) => void }) {
  const warned = new Set<string>();
  return {
    of(chatId: string, stored: string): string {
      if (stored) return stored;
      if (input.defaultTimeZone) return input.defaultTimeZone;
      const app = input.appTimeZone();
      if (app) return app;
      const server = serverTimeZone();
      if (!warned.has(chatId)) {
        warned.add(chatId);
        input.warn(`[сценарий] чат=${chatId}: пояс человека неизвестен (нет ни со страницы, ни defaultTimeZone, ни agent.timeZone) — тихие часы и «время суток» по поясу сервера ${server}`);
      }
      return server;
    },
  };
}

/** Пояс IANA в каноническом виде («asia/novosibirsk» → «Asia/Novosibirsk»); не пояс — `null`. */
export function ianaTimeZone(value: string): string | null {
  if (!value.trim()) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Пояс человека: один на все его разговоры. Копия в записи чата — для таймеров, которые читают её без ожидания. */
export interface FlowTimeZones {
  /** Известный пояс: записанный человеку, иначе узнанный в этом чате. Не знаем — `null`. */
  known(ownerId: string, chatId: string): Promise<string | null>;
  /** Пояс для счёта: известный, иначе приложения или сервера. */
  of(ownerId: string, chatId: string): Promise<string>;
  /** Запасной пояс чата, пока пояс человека неизвестен: приложения или сервера. */
  fallback(chatId: string): string;
  /** Пояс узнан (страница, слова человека): человеку и копия в запись чата. */
  write(ownerId: string, chatId: string, timeZone: string): Promise<void>;
}

/** Пояса людей: адаптер приложения `people` или таблица модуля; запасной — `fallback` (приложения или сервера). */
export function createFlowTimeZones(input: { store: FlowStore; people?: FlowPeople; fallback: (chatId: string) => string; now: () => number }): FlowTimeZones {
  const { store } = input;
  const iso = () => new Date(input.now()).toISOString();
  const readPerson = (ownerId: string) => (input.people ? input.people.readTimeZone(ownerId) : store.readTimeZone(ownerId));
  const writePerson = (ownerId: string, timeZone: string) => (input.people ? input.people.writeTimeZone(ownerId, timeZone) : store.writeTimeZone(ownerId, timeZone, iso()));
  async function known(ownerId: string, chatId: string): Promise<string | null> {
    const person = await readPerson(ownerId);
    if (person) return person;
    return (await store.getChat(chatId))?.timeZone || null;
  }
  return {
    known,
    fallback: input.fallback,
    async of(ownerId, chatId) {
      return (await known(ownerId, chatId)) ?? input.fallback(chatId);
    },
    async write(ownerId, chatId, timeZone) {
      if ((await readPerson(ownerId)) !== timeZone) await writePerson(ownerId, timeZone);
      const record = await store.getChat(chatId);
      if (record && record.timeZone !== timeZone) await store.updateChat(chatId, { timeZone }, iso());
    },
  };
}
