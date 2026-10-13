import { vi } from "vitest";

/**
 * Обещание на подменённых часах: время идёт шагами, пока оно не выполнится, — паузы автопродолжения и повторов
 * не ждутся вживую. Часы уже подменены тестом — такими и остаются.
 */
export async function onFakeClock<T>(run: () => Promise<T>, stepMs = 250): Promise<T> {
  const ownClock = !vi.isFakeTimers();
  if (ownClock) vi.useFakeTimers();
  try {
    let settled = false;
    const promise = run().finally(() => {
      settled = true;
    });
    promise.catch(() => {});
    while (!settled) await vi.advanceTimersByTimeAsync(stepMs);
    return await promise;
  } finally {
    if (ownClock) vi.useRealTimers();
  }
}
