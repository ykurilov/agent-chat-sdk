import type { ChatStorage } from "@ykurilov/agent-chat-core";

/**
 * Сколько раз переписывать запись, которую успел изменить другой сервер. Внутри одного процесса правки одного ключа
 * идут по очереди и друг другу не мешают; спорят только процессы, их немного, и случайная пауза их разводит.
 */
const UPDATE_ATTEMPTS = 50;
/** Наибольшая пауза перед повтором, мс: растёт с каждой неудачей до этого предела. */
const MAX_RETRY_PAUSE_MS = 32;

/** Случайная пауза перед повтором: таймер, а не цикл, — цикл событий не стоит. */
function retryPause(attempt: number): Promise<void> {
  const ceiling = Math.min(MAX_RETRY_PAUSE_MS, 2 ** attempt);
  return new Promise((resolve) => setTimeout(resolve, Math.random() * ceiling));
}

export interface LimitStateStore {
  read<T>(key: string): Promise<T | null>;
  /**
   * Правка записи по версии: `change` получает текущее значение и возвращает новое или `null` — править нечего.
   * Правки одного ключа в этом процессе идут по очереди; запись успел изменить другой процесс — читает заново и
   * повторяет после короткой случайной паузы. Возвращает записанное (или прочитанное, если правки нет)
   * и было ли записано.
   */
  update<T>(key: string, change: (current: T | null) => T | null): Promise<{ value: T | null; written: boolean }>;
}

/** Состояние лимитов в хранилище чата: JSON по ключу. Нет методов у хранилища — `null`. */
export function limitStateStore(storage: ChatStorage): LimitStateStore | null {
  const get = storage.getSpendingLimitState?.bind(storage);
  const save = storage.saveSpendingLimitState?.bind(storage);
  if (!get || !save) return null;
  // Хвост очереди правок по каждому ключу. Общее окно (сервиса, человека) правят все ходы разом: без очереди они
  // мешали бы друг другу и тратили повторы.
  const queues = new Map<string, Promise<unknown>>();
  function inTurn<R>(key: string, work: () => Promise<R>): Promise<R> {
    const result = (queues.get(key) ?? Promise.resolve()).then(work);
    const tail = result.catch(() => undefined);
    queues.set(key, tail);
    void tail.then(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
    return result;
  }
  return {
    async read<T>(key: string) {
      const record = await get(key);
      return record ? (JSON.parse(record.value) as T) : null;
    },
    update<T>(key: string, change: (current: T | null) => T | null) {
      return inTurn(key, async () => {
        for (let attempt = 0; attempt < UPDATE_ATTEMPTS; attempt++) {
          if (attempt > 0) await retryPause(attempt);
          const record = await get(key);
          const current = record ? (JSON.parse(record.value) as T) : null;
          const next = change(current);
          if (next === null) return { value: current, written: false };
          if (await save(key, JSON.stringify(next), record?.version ?? null)) return { value: next, written: true };
        }
        throw new Error(`Состояние лимитов «${key}»: запись всё время меняют другие ходы`);
      });
    },
  };
}
