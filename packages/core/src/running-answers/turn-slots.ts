/** Сколько ответов одного человека идут одновременно по умолчанию: во всех его чатах вместе. */
export const DEFAULT_MAX_CONCURRENT_TURNS_PER_USER = 3;

/** У человека уже идёт столько ответов, сколько разрешено: новый ход не начат, ничего не записано. */
export class TooManyTurnsError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`Достигнут предел одновременных ответов человека: ${limit}`);
    this.name = "TooManyTurnsError";
    this.limit = limit;
  }
}

/** Место одного хода. `release` можно звать сколько угодно раз: место освобождается один раз. */
export interface TurnSlot {
  release(): void;
}

/** Учёт идущих ходов по людям в памяти процесса, как и реестр идущих ответов. */
export interface TurnSlots {
  /** Занимает место сразу, без ожидания. @throws TooManyTurnsError мест нет. */
  take(userId: string): TurnSlot;
}

/** Целое не меньше 1 или `Infinity`; не задано — 3. Иначе ошибка при создании службы. */
export function resolveMaxConcurrentTurns(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_CONCURRENT_TURNS_PER_USER;
  if (value === Number.POSITIVE_INFINITY || (Number.isInteger(value) && value >= 1)) return value;
  throw new Error(`maxConcurrentTurnsPerUser: нужно целое не меньше 1 или Infinity, а не ${value}`);
}

export function createTurnSlots(limit: number): TurnSlots {
  const taken = new Map<string, number>();
  return {
    take(userId) {
      const count = taken.get(userId) ?? 0;
      if (count >= limit) throw new TooManyTurnsError(limit);
      taken.set(userId, count + 1);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          const left = (taken.get(userId) ?? 1) - 1;
          if (left > 0) taken.set(userId, left);
          else taken.delete(userId);
        },
      };
    },
  };
}
