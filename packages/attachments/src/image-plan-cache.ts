/** Что делать с картинкой в запросе: байты как есть, уменьшенная копия или пометка «не прочитать». */
export type ImagePlan = { kind: "original"; mediaType: string } | { kind: "fitted"; mediaType: string; bytes: Uint8Array } | { kind: "unreadable" };

export interface ImagePlanCache {
  /** Решение по ключу; найденное становится самым свежим. */
  get(key: string): Promise<ImagePlan | undefined> | undefined;
  /** Запоминает решение, пока оно принимается. «Файла нет» (`undefined`) и сбой не запоминаются. */
  set(key: string, plan: Promise<ImagePlan | undefined>): void;
  /** Сколько байт сейчас занимают запомненные копии. */
  copyBytes(): number;
}

/**
 * Решения по картинкам с двумя пределами: числом решений (сами по себе они крошечные) и памятью уменьшенных копий.
 * Сверх любого предела уходит самое давно нужное; копия больше всего предела памяти не запоминается.
 */
export function createImagePlanCache(limits: { maxPlans: number; maxCopyBytes: number }): ImagePlanCache {
  const plans = new Map<string, Promise<ImagePlan | undefined>>();
  const copies = new Map<string, number>();
  let copyBytes = 0;

  const forget = (key: string) => {
    plans.delete(key);
    copyBytes -= copies.get(key) ?? 0;
    copies.delete(key);
  };
  const evictOldest = () => {
    while (plans.size > limits.maxPlans || copyBytes > limits.maxCopyBytes) forget(plans.keys().next().value!);
  };

  return {
    get(key) {
      const plan = plans.get(key);
      if (!plan) return undefined;
      plans.delete(key);
      plans.set(key, plan);
      return plan;
    },
    set(key, plan) {
      forget(key);
      plans.set(key, plan);
      evictOldest();
      plan.then(
        (decided) => {
          if (plans.get(key) !== plan) return;
          if (decided === undefined) return forget(key);
          if (decided.kind !== "fitted") return;
          if (decided.bytes.length > limits.maxCopyBytes) return forget(key);
          copies.set(key, decided.bytes.length);
          copyBytes += decided.bytes.length;
          evictOldest();
        },
        () => plans.get(key) === plan && forget(key),
      );
    },
    copyBytes: () => copyBytes,
  };
}
