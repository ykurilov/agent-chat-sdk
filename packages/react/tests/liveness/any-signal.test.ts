import { afterEach, describe, expect, it } from "vitest";
import { anySignal } from "../../src/liveness/any-signal";

const nativeAny = AbortSignal.any;
afterEach(() => {
  AbortSignal.any = nativeAny;
});

/** Safari до 17.4, Chrome до 116 и Firefox до 124 не знают `AbortSignal.any`. */
function withoutNativeAny() {
  // @ts-expect-error — старый браузер
  delete AbortSignal.any;
  expect(AbortSignal.any).toBeUndefined();
}

describe("anySignal без AbortSignal.any", () => {
  it("обрывается, когда обрывается любой из сигналов, с его причиной", () => {
    withoutNativeAny();
    const first = new AbortController(), second = new AbortController();
    const signal = anySignal([first.signal, second.signal]);
    expect(signal.aborted).toBe(false);
    second.abort("смена чата");
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("смена чата");
    first.abort("поздно");
    expect(signal.reason).toBe("смена чата");
  });

  it("уже оборванный сигнал даёт оборванный сразу", () => {
    withoutNativeAny();
    const done = new AbortController();
    done.abort("ушёл");
    const signal = anySignal([new AbortController().signal, done.signal]);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("ушёл");
  });

  it("после обрыва снимает свои слушатели с остальных сигналов", () => {
    withoutNativeAny();
    const page = new AbortController(), own = new AbortController();
    let listeners = 0;
    const add = page.signal.addEventListener.bind(page.signal), remove = page.signal.removeEventListener.bind(page.signal);
    page.signal.addEventListener = ((...args: Parameters<typeof add>) => { listeners++; add(...args); }) as typeof add;
    page.signal.removeEventListener = ((...args: Parameters<typeof remove>) => { listeners--; remove(...args); }) as typeof remove;
    anySignal([own.signal, page.signal]);
    expect(listeners).toBe(1);
    own.abort();
    expect(listeners).toBe(0);
  });
});
