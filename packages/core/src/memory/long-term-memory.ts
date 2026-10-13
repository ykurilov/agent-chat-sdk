import type { LanguageModel, ToolSet } from "ai";
import type { AgentToolsModel } from "../agent-run/run-agent-turn";
import type { TokenUsage } from "../conversation/types";
import type { ContextBlockEntry } from "../frozen-context/context-blocks";

/** То, что дают агент или человек: разделы (1–3) и текст записи. Форму проверяет пакет памяти до записи. */
export interface MemoryNoteInput {
  categories: string[];
  content: string;
}

/** Запись памяти. Владелец (`ownerId`) — свойство хранилища и наружу не выдаётся. */
export interface MemoryNote extends MemoryNoteInput {
  /** Выдаёт хранилище, уникален. */
  id: string;
  /** 1 при создании, +1 при каждой правке. Служит замком: правка и удаление называют версию, которую видели. */
  version: number;
  /** Время в формате ISO 8601; ставит хранилище. */
  createdAt: string;
  updatedAt: string;
}

/** Ответы на действия с записями, которые не удались. Пределы и дубли проверяет пакет памяти, версию и владельца — хранилище. */
export type MemoryErrorKind = "not_found" | "stale_version" | "invalid" | "duplicate" | "limit_reached";

/** Ошибка действия с памятью — не исключение, а ответ. `message` подсказывает агенту или человеку, что делать. */
export interface MemoryError {
  kind: MemoryErrorKind;
  message: string;
}

/**
 * Проверка записи, которую хранилище вызывает внутри своей операции, когда видит записи человека: свою запись
 * оно ещё не сделало. Ошибка — запись не делается, хранилище отдаёт эту ошибку. Только чтение переданного списка, без ожидания:
 * вызывается под замком хранилища.
 */
export type MemoryWriteGuard = (existing: readonly MemoryNote[]) => MemoryError | null;

/**
 * Проверка возврата слияния: `remaining` — записи человека без результатов слияния, `restored` — оригиналы, что
 * вернутся. Ошибка (`limit_reached`, `duplicate`) — возврат не делается.
 */
export type MemoryRevertGuard = (remaining: readonly MemoryNote[], restored: readonly MemoryNote[]) => MemoryError | null;

/**
 * Долгая память агента между чатами. Ядро знает только этот интерфейс; устройство даёт пакет
 * `@ykurilov/agent-chat-memory`. Без `ChatServiceOptions.memory` ядро ведёт себя как раньше.
 */
export interface LongTermMemory {
  /** Постоянный текст для инструкции агента. Без данных человека и без времени: он входит в начало запроса, которое кэшируется. */
  instructions: string;
  /** Набор инструментов памяти для этого человека. Ядро добавляет его к инструментам приложения. */
  tools(model: AgentToolsModel): ToolSet;
  /**
   * Имена инструментов памяти. Если приложение задало свои инструменты объектом с таким же именем,
   * ядро откажет при создании службы. Если инструменты заданы функцией, повтор ловится при сборке набора хода.
   */
  toolNames: readonly string[];
  /**
   * Блок памяти для вопроса хода или `null`, если записей нет. Зовётся один раз на чат: в первом ходе и после сжатия
   * истории; в идущем чате блок берётся из прошлого ответа.
   */
  snapshot(input: { userId: string; chatId: string }): Promise<string | null>;
  /**
   * Необязательно: память блоками застывающего контекста — шапка `memory` и по блоку на запись `memory:<id>`. Зовётся
   * так же редко, как `snapshot`. После сжатия с хвостом правка одной записи уходит модели одной строкой. Запись, не
   * вошедшая в лимит, — `{ key, hidden: true }`: модель узнает, что она не показана ради места, а не удалена. Нет
   * метода — один блок `memory` из `snapshot`.
   */
  blocks?(input: { userId: string; chatId: string }): Promise<ContextBlockEntry[] | null>;
  /** Необязательно: дела после законченного ответа (этап 6, оптимизация дублей). */
  afterAnswer?(input: {
    userId: string;
    chatId: string;
    model: LanguageModel;
    /** Пишет расход модели в журнал источником `memory`; возвращает номер записи (`null`: расход пустой или запись не удалась). */
    recordUsage(usage: TokenUsage): Promise<string | null>;
  }): Promise<void>;
}
