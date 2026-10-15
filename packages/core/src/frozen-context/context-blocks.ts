import type { AgentAudience, AgentChannel, ChatSubject } from "../conversation/types";
import type { AppStateValues } from "../app-state/app-state";
import type { AgentNotice } from "../notices/agent-notice";
import type { StaffActor } from "../turn-hooks/turn-hooks";
import type { AgentViewer } from "../agent-run/agent-viewer";

/** Тип служебной части ответа с застывшими блоками хода. Клиенту не уходит, модели — только текстом блоков. */
export const FROZEN_CONTEXT_PART_TYPE = "data-frozen-context";

/** Блок контекста: ключ уникален в наборе, текст идёт модели как есть. Личный блок не показывается в групповом ходе. */
export interface ContextBlock {
  key: string;
  text: string;
  private?: boolean;
}

/**
 * Блок есть, но сейчас не показан ради места (например, запись памяти вне лимита). Не «удалён»: модель, видевшая его
 * раньше, получит строку «не показано ради места, но по-прежнему действует», а не «больше не действует».
 */
export interface HiddenContextBlock {
  key: string;
  hidden: true;
}

/** Что отдаёт источник блоков: показанные блоки и скрытые ради места. */
export type ContextBlockEntry = ContextBlock | HiddenContextBlock;

export function isHiddenBlock(entry: ContextBlockEntry): entry is HiddenContextBlock {
  return (entry as HiddenContextBlock).hidden === true;
}

/** Что видит `agent.contextBlocks` в начале хода. Всё — копии: правка функции не доходит до хода. */
export interface ContextBlocksInput {
  chatId: string;
  ownerId: string;
  /** Ответ агента, который строит этот ход. */
  messageId: string;
  /** Данные чата (`Chat.data`). */
  chat: { data?: Record<string, unknown> };
  /**
   * Состояние текущей ветки на начало хода — то же, что `model.state.get()` у инструментов на первом шаге. Ядро передаёт
   * всегда; в типе необязательно, чтобы свои вызовы функции (тесты приложения) без него не ломались.
   */
  state?: AppStateValues;
  /** Объект чата; нет — обычный чат. */
  subject?: ChatSubject;
  /** Откуда ход: веб или мессенджер. */
  channel: AgentChannel;
  /** С кем говорит агент: в группе блоки видят все участники, личное лучше пометить `private`. */
  audience: AgentAudience;
  /** Сотрудник, который делает ход в копии чата человека; нет — ход делает сам владелец. */
  staff?: StaffActor;
  /** Права человека на ход (`agent.viewer`), тот же объект, что у инструментов. Нет `agent.viewer` — поля нет. */
  viewer?: AgentViewer;
  modelId: string;
  providerId: string;
  /** Отмена: «Стоп», срок функции (`agent.contextBlocksTimeoutMs`), срок хода. */
  abortSignal: AbortSignal;
}

/**
 * Блоки приложения для вопроса хода: зовётся один раз в начале хода. Пустой список, `null` и `undefined` — блоков нет.
 * Бросила, вернула не список или не ответила в срок — блоки приложения берутся из прошлого ответа.
 */
export type ContextBlocksSource = (
  input: ContextBlocksInput,
) => ContextBlockEntry[] | null | undefined | Promise<ContextBlockEntry[] | null | undefined>;

/** Блоки хода, застывшие в ответе: полный набор и что из него ушло модели против базового ответа. */
export interface FrozenContextData {
  blocks: ContextBlock[];
  /**
   * «all» — весь набор; иначе изменённые и новые ключи текстом, одна строка про убранные и одна про скрытые ради места
   * (`hidden` есть, только если не пуст).
   */
  sent: "all" | { changed: string[]; removed: string[]; hidden?: string[] };
  /** Ответ, против которого посчитаны изменения; `null` — набор ушёл целиком. */
  base: string | null;
  /**
   * Начало видимой истории (первое сообщение; нет — сам ответ), при котором память прочитана из источника. Пока начало
   * то же, память берётся из базы и не перечитывается; сжатие истории меняет начало — память читается заново.
   * Нет поля — память не читалась (групповой ход, сбой, ответ старой версии).
   */
  memoryFrom?: string;
  /** Служебные сообщения хода от `prepareTurn`: модель видит их текстом после блоков. В разницу блоков не входят. */
  notices?: AgentNotice[];
}

/** Ключи ядра: памяти, даты и места. Блоки приложения их занять не могут. */
export const TODAY_KEY = "today";
export const SCREEN_PLACE_KEY = "screen_place";
export const MEMORY_KEY = "memory";

export function isMemoryKey(key: string): boolean {
  return key === MEMORY_KEY || key.startsWith(`${MEMORY_KEY}:`);
}

export function isReservedKey(key: string): boolean {
  return isMemoryKey(key) || key === TODAY_KEY || key === SCREEN_PLACE_KEY;
}

/**
 * Застывшие блоки ответа — первая такая часть; нет части — `undefined`. Следующие части того же типа — заметки
 * продолжения: блоки, обновлённые ответом человека на паузе ответа (виджет, подтверждение), на месте этого ответа.
 */
export function frozenContextOf(parts: ReadonlyArray<{ type: string; data?: unknown }>): FrozenContextData | undefined {
  const part = parts.find((candidate) => candidate.type === FROZEN_CONTEXT_PART_TYPE);
  return part?.data as FrozenContextData | undefined;
}

/** Блоки, которые модель видела последними в этом ответе: последняя заметка продолжения, иначе блоки ответа. */
export function latestFrozenContextOf(parts: ReadonlyArray<{ type: string; data?: unknown }>): FrozenContextData | undefined {
  const part = parts.findLast((candidate) => candidate.type === FROZEN_CONTEXT_PART_TYPE);
  return part?.data as FrozenContextData | undefined;
}

/** Есть ли что сказать модели против базы: весь набор, изменённые, убранные или скрытые ради места блоки. */
export function hasNewBlocks(data: FrozenContextData): boolean {
  return data.sent === "all" || data.sent.changed.length > 0 || data.sent.removed.length > 0 || (data.sent.hidden?.length ?? 0) > 0;
}

/** Строка модели про блоки, которые есть, но больше не показываются. Постоянный вид: те же ключи — те же байты. */
export function notShownForSpace(keys: readonly string[]): string {
  return `[Не показано ради места, но по-прежнему действует: ${keys.map((key) => `«${key}»`).join(", ")}]`;
}

/** Строка модели про блоки, которых больше нет. Постоянный вид: те же ключи — те же байты. */
export function noLongerValid(keys: readonly string[]): string {
  return `[Больше не действует: ${keys.map((key) => `«${key}»`).join(", ")}]`;
}
