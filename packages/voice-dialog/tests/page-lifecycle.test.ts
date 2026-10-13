import { describe, expect, it, vi } from "vitest";
import { createPageLifecycle } from "../src/browser/page-lifecycle";
import type { LeaveReason } from "../src/browser/page-lifecycle";

class FakeDocument extends EventTarget {
  visibilityState: "visible" | "hidden" = "visible";
  hide() {
    this.visibilityState = "hidden";
    this.dispatchEvent(new Event("visibilitychange"));
  }
  show() {
    this.visibilityState = "visible";
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

class FakeSentinel extends EventTarget {
  released = false;
  release = vi.fn(async () => {
    this.released = true;
  });
}

class FakeAudioContext extends EventTarget {
  state: string = "running";
  change(state: string) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

function setup(options: { wakeLock?: "works" | "missing" | "denied" } = {}) {
  const document = new FakeDocument();
  const window = new EventTarget();
  const sentinel = new FakeSentinel();
  const request = vi.fn(async (_type: "screen") => {
    if (options.wakeLock === "denied") throw new DOMException("no", "NotAllowedError");
    return sentinel;
  });
  const navigator = options.wakeLock === "missing" ? {} : { wakeLock: { request } };
  const left: LeaveReason[] = [];
  const lifecycle = createPageLifecycle({
    onLeave: (reason) => left.push(reason),
    document: document as unknown as Document,
    window: window as unknown as Window,
    navigator: navigator as unknown as Navigator,
  });
  return { document, window, sentinel, request, left, lifecycle };
}

describe("жизненный цикл страницы: уход в фон", () => {
  it("вкладка скрыта (блокировка экрана, другое приложение) → сигнал «закрыть режим»", () => {
    const { document, left, lifecycle } = setup();
    lifecycle.start();
    document.hide();
    expect(left).toEqual(["hidden"]);
  });

  it("pagehide → сигнал", () => {
    const { window, left, lifecycle } = setup();
    lifecycle.start();
    window.dispatchEvent(new Event("pagehide"));
    expect(left).toEqual(["pagehide"]);
  });

  it("возврат на страницу сигнала не даёт", () => {
    const { document, left, lifecycle } = setup();
    lifecycle.start();
    document.show();
    expect(left).toEqual([]);
  });

  it("сигнал один: следом идущие события того же ухода его не повторяют", () => {
    const { document, window, left, lifecycle } = setup();
    lifecycle.start();
    document.hide();
    window.dispatchEvent(new Event("pagehide"));
    expect(left).toHaveLength(1);
  });

  it("состояние «interrupted» у AudioContext (iOS) → сигнал", () => {
    const { left, lifecycle } = setup();
    const context = new FakeAudioContext();
    lifecycle.start();
    lifecycle.watchAudio(context as unknown as BaseAudioContext);
    context.change("suspended"); // само по себе — не повод: Safari усыпляет контекст и без ухода
    expect(left).toEqual([]);
    context.change("interrupted");
    expect(left).toEqual(["audio_interrupted"]);
  });

  it("если контекст уже «interrupted» к моменту наблюдения — сигнал сразу", () => {
    const { left, lifecycle } = setup();
    const context = new FakeAudioContext();
    context.state = "interrupted";
    lifecycle.start();
    lifecycle.watchAudio(context as unknown as BaseAudioContext);
    expect(left).toEqual(["audio_interrupted"]);
  });

  it("после stop() ничего не слушаем", () => {
    const { document, window, left, lifecycle } = setup();
    const context = new FakeAudioContext();
    lifecycle.start();
    lifecycle.watchAudio(context as unknown as BaseAudioContext);
    lifecycle.stop();
    document.hide();
    window.dispatchEvent(new Event("pagehide"));
    context.change("interrupted");
    expect(left).toEqual([]);
  });

  it("после stop() можно начать заново: сигнал снова работает", () => {
    const { document, left, lifecycle } = setup();
    lifecycle.start();
    document.hide();
    lifecycle.stop();
    document.show();
    lifecycle.start();
    document.hide();
    expect(left).toEqual(["hidden", "hidden"]);
  });
});

describe("жизненный цикл страницы: экран не гаснет (Wake Lock)", () => {
  it("start просит блокировку экрана, stop отпускает", async () => {
    const { request, sentinel, lifecycle } = setup();
    lifecycle.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(request).toHaveBeenCalledWith("screen");
    lifecycle.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it("stop до того, как блокировка выдана: как только выдана — отпускается", async () => {
    const { sentinel, lifecycle } = setup();
    lifecycle.start();
    lifecycle.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it("где Wake Lock нет — молча, режим работает", () => {
    const { document, left, lifecycle } = setup({ wakeLock: "missing" });
    expect(() => lifecycle.start()).not.toThrow();
    document.hide();
    expect(left).toEqual(["hidden"]);
    expect(() => lifecycle.stop()).not.toThrow();
  });

  it("если браузер отказал в блокировке — молча", async () => {
    const { lifecycle } = setup({ wakeLock: "denied" });
    expect(() => lifecycle.start()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(() => lifecycle.stop()).not.toThrow();
  });
});
