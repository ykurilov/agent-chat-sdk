/**
 * Дело одного показа чата: запрос «Стоп», ответ на подтверждение или виджет, очередь поправок и замен. Смена чата
 * обрывает жизнь показа (`AbortSignal`), и дело для нового показа перестаёт существовать: его не ждут и по нему не
 * блокируются. Тот же чат, открытый снова, — уже новый показ.
 */
export interface ChatOwned<T> {
  readonly lifetime: AbortSignal;
  readonly value: T;
}

/** Значение дела, если оно начато в этом показе чата и показ ещё идёт; иначе `undefined`. */
export function ownedBy<T>(owned: ChatOwned<T> | null, lifetime: AbortSignal): T | undefined {
  return owned !== null && owned.lifetime === lifetime && !lifetime.aborted ? owned.value : undefined;
}
