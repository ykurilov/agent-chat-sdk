/** Выполняет действия одного человека по очереди; действия разных людей друг друга не ждут. */
export type OwnerLock = <T>(ownerId: string, action: () => Promise<T>) => Promise<T>;

/** Замок в пределах процесса: цепочка обещаний на человека. Сбой одного действия следующим не мешает. */
export function createOwnerLock(): OwnerLock {
  const tails = new Map<string, Promise<void>>();
  return (ownerId, action) => {
    const run = (tails.get(ownerId) ?? Promise.resolve()).then(action);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    tails.set(ownerId, tail);
    // Очередь опустела — запись о человеке не копится.
    void tail.then(() => {
      if (tails.get(ownerId) === tail) tails.delete(ownerId);
    });
    return run;
  };
}
