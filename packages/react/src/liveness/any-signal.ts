/**
 * Сигнал, который обрывается вместе с первым оборванным из `signals`, с его причиной. Как `AbortSignal.any`, но работает и
 * там, где его нет (Safari до 17.4, Chrome до 116, Firefox до 124): без него чат в таком браузере падал на первом запросе.
 */
export function anySignal(signals: readonly AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals as AbortSignal[]);
  const controller = new AbortController();
  const done = signals.find((signal) => signal.aborted);
  if (done) {
    controller.abort(done.reason);
    return controller.signal;
  }
  const stop = () => {
    for (const signal of signals) signal.removeEventListener("abort", onAbort);
  };
  function onAbort(this: AbortSignal) {
    stop();
    controller.abort(this.reason);
  }
  for (const signal of signals) signal.addEventListener("abort", onAbort);
  return controller.signal;
}
