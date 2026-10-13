/** Очередь по ключу: дела с одним ключом идут по одному, с разными — сразу. Ошибка одного дела следующим не мешает. */
export type KeyedLock = <T>(key: string, work: () => Promise<T>) => Promise<T>;

export function createKeyedLock(): KeyedLock {
  const tails = new Map<string, Promise<void>>();
  return (key, work) => {
    const result = (tails.get(key) ?? Promise.resolve()).then(work);
    const tail = result.then(
      () => {},
      () => {},
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
}
