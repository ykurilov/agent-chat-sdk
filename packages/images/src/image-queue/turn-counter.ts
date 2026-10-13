/** Ход длиннее этого не бывает: счёт старого хода забывается, память не копится. */
const FORGET_TURN_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Предел «не больше N картинок за ход» по номеру хода (`turnId`). Номер один на все попытки хода и на запасного
 * провайдера, поэтому новая попытка счёт не обнуляет. Без предела или без номера — не считается.
 */
export function createTurnCounter(limit: number | undefined) {
  const turns = new Map<string, { count: number; touchedAt: number }>();

  function forgetOld(now: number) {
    for (const [turnId, turn] of turns) if (now - turn.touchedAt > FORGET_TURN_AFTER_MS) turns.delete(turnId);
  }

  return {
    /** Занять место; `false` — предел хода исчерпан. */
    take(turnId: string | undefined): boolean {
      if (limit === undefined || turnId === undefined) return true;
      const now = Date.now();
      forgetOld(now);
      const turn = turns.get(turnId) ?? { count: 0, touchedAt: now };
      if (turn.count >= limit) return false;
      turns.set(turnId, { count: turn.count + 1, touchedAt: now });
      return true;
    },
    /** Вернуть место: заказ не принят (лимит расходов, ошибка до записи). */
    give(turnId: string | undefined): void {
      if (limit === undefined || turnId === undefined) return;
      const turn = turns.get(turnId);
      if (turn) turn.count = Math.max(0, turn.count - 1);
    },
  };
}
