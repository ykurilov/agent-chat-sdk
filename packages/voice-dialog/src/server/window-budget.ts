export interface WindowBudgetOptions {
  /** Сколько можно взять за окно. */
  max: number;
  windowMs: number;
  now: () => number;
}

/** Счёт «сколько взято за последнее окно» отдельно по каждому ключу (человеку, соединению). */
export interface WindowBudget {
  /** Берёт `amount`, если за окно не выйдет выше потолка; иначе ничего не записывает и возвращает `false`. */
  take(key: string, amount: number): boolean;
}

/** Взятое за окно: записи по моментам, слева самые старые; `total` — их сумма. */
interface Lane {
  entries: Array<[moment: number, amount: number]>;
  head: number;
  total: number;
}

export function createWindowBudget({ max, windowMs, now }: WindowBudgetOptions): WindowBudget {
  const lanes = new Map<string, Lane>();
  let sweptAt = now();

  function expire(lane: Lane, current: number) {
    while (lane.head < lane.entries.length && current - lane.entries[lane.head]![0] >= windowMs) {
      lane.total -= lane.entries[lane.head]![1];
      lane.head += 1;
    }
    if (lane.head > 1024 && lane.head * 2 > lane.entries.length) {
      lane.entries = lane.entries.slice(lane.head);
      lane.head = 0;
    }
  }

  /** Ключи ушедших людей не копятся: раз в окно пустые счета убираются. */
  function sweep(current: number) {
    if (current - sweptAt < windowMs) return;
    sweptAt = current;
    for (const [key, lane] of lanes) {
      expire(lane, current);
      if (lane.head >= lane.entries.length) lanes.delete(key);
    }
  }

  return {
    take(key, amount) {
      const current = now();
      sweep(current);
      const lane = lanes.get(key) ?? { entries: [], head: 0, total: 0 };
      expire(lane, current);
      if (lane.total + amount > max) return false;
      // Куски в одну миллисекунду сливаются: записей не больше, чем миллисекунд в окне.
      const last = lane.entries.at(-1);
      if (last && lane.head < lane.entries.length && last[0] === current) last[1] += amount;
      else lane.entries.push([current, amount]);
      lane.total += amount;
      lanes.set(key, lane);
      return true;
    },
  };
}
