/** Запись памяти, как её отдаёт сервер (`GET {api}/memory`). Владельца в ответах нет. */
export interface MemoryNote {
  id: string;
  /** Раздел записи от общего к частному: от 1 до 3 уровней. */
  categories: string[];
  content: string;
  /** Замок: правка и удаление называют версию, которую человек видел. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** То, что человек вводит: разделы и текст. */
export interface MemoryNoteInput {
  categories: string[];
  content: string;
}

export interface MemoryCounts {
  /** Записей всего. */
  total: number;
  /** Предел записей. */
  limit: number;
  /** Сколько записей видит агент в каждом запросе (остальные он находит поиском). */
  shown: number;
}

/** Одна склейка повторов: `originals` («было») заменены записью `result` («стало»). */
export interface MemoryMergeGroup {
  result: MemoryNote;
  originals: MemoryNote[];
}

/** Слияние одного запуска оптимизации (`GET {api}/memory/merges`), новейшие первыми. */
export interface MemoryMerge {
  runId: string;
  /** Время в формате ISO 8601. */
  finishedAt: string;
  /** Можно ли «Вернуть как было»: результаты склеек с тех пор не менялись. */
  revertible: boolean;
  groups: MemoryMergeGroup[];
}

/**
 * Обмен с сервером памяти. Каждый метод при отказе бросает `MemoryRequestError`
 * (обрыв связи — обычная ошибка `fetch`). `createMemoryApi` строит его по адресам `{api}/memory`.
 */
export interface MemoryApi {
  list(): Promise<{ notes: MemoryNote[]; counts: MemoryCounts }>;
  create(input: MemoryNoteInput): Promise<MemoryNote>;
  update(id: string, version: number, input: MemoryNoteInput): Promise<MemoryNote>;
  remove(id: string, version: number): Promise<void>;
  /** Стирает всю память человека; возвращает, сколько записей удалено. */
  clear(): Promise<number>;
  /** Склейки повторов, которые можно показать и вернуть. */
  listMerges(): Promise<MemoryMerge[]>;
  /** Возвращает слияние как было. Отказ 409: `conflict` — результат с тех пор менялся; `limit_reached` — памяти не хватит места; `duplicate` — запись, что вернулась бы, уже добавлена заново. */
  revertMerge(runId: string): Promise<void>;
}

/** Что пошло не так с действием: коды сервера (`conflict` — слияние вернуть нельзя) плюс `unavailable` (памяти нет) и `other` (сбой, обрыв связи). */
export type MemoryFailure = "not_found" | "stale_version" | "limit_reached" | "duplicate" | "invalid" | "conflict" | "unavailable" | "other";

/** Итог действия. Отказ — не исключение: скину нужна надпись, а не стек. */
export type MemoryActionResult = { ok: true } | { ok: false; failure: MemoryFailure };

/**
 * Состояние экрана: `loading` — грузится; `ready` — записи есть; `empty` — записей нет; `unavailable` — сервер ответил
 * 404 (память в приложении не включена); `error` — список не загрузился.
 */
export type MemoryStatus = "loading" | "ready" | "empty" | "unavailable" | "error";

/** Форма записи (как у пакета памяти): до 3 разделов по 60 знаков, текст до 500. Экран проверяет её до отправки. */
export const memoryNoteLimits = { maxCategories: 3, maxCategoryChars: 60, maxContentChars: 500 } as const;
