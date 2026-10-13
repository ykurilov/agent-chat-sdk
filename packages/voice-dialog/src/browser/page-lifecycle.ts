/** Почему страницу пора оставить: она ушла в фон, закрывается или звук отобрала система (iOS). */
export type LeaveReason = "hidden" | "pagehide" | "audio_interrupted";

export interface PageLifecycleOptions {
  /** Зовётся один раз за включение, при первом же уходе. */
  onLeave(reason: LeaveReason): void;
  /** Подмены среды для тестов; по умолчанию — браузерные. */
  document?: Document;
  window?: Window;
  navigator?: Navigator;
}

export interface PageLifecycle {
  /** Начать следить и попросить у браузера не гасить экран. */
  start(): void;
  /** Следить и за этим звуковым контекстом: iOS переводит его в `interrupted`, когда звук отбирают. */
  watchAudio(context: BaseAudioContext): void;
  /** Перестать следить и отпустить экран. Можно начать заново. */
  stop(): void;
}

export function createPageLifecycle(options: PageLifecycleOptions): PageLifecycle {
  const doc = options.document ?? (typeof document === "undefined" ? undefined : document);
  const win = options.window ?? (typeof window === "undefined" ? undefined : window);
  const nav = options.navigator ?? (typeof navigator === "undefined" ? undefined : navigator);
  let cleanups: Array<() => void> = [];
  let running = false;
  let left = false;
  let wakeLock: WakeLockSentinel | null = null;

  function leave(reason: LeaveReason) {
    if (!running || left) return;
    left = true;
    options.onLeave(reason);
  }

  function listen(target: EventTarget | undefined, type: string, listener: () => void) {
    if (!target) return;
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  }

  function keepScreenOn() {
    // Экран не гаснет, пока идёт разговор. Нет возможности или отказ (экономия заряда) — режим работает и так.
    nav?.wakeLock?.request("screen").then(
      (sentinel) => {
        if (running) wakeLock = sentinel;
        else void sentinel.release().catch(() => undefined);
      },
      () => undefined,
    );
  }

  return {
    start() {
      if (running) return;
      running = true;
      left = false;
      listen(doc, "visibilitychange", () => {
        if (doc?.visibilityState === "hidden") leave("hidden");
      });
      listen(win, "pagehide", () => leave("pagehide"));
      keepScreenOn();
    },
    watchAudio(context) {
      if (context.state === ("interrupted" as AudioContextState)) leave("audio_interrupted");
      listen(context, "statechange", () => {
        if (context.state === ("interrupted" as AudioContextState)) leave("audio_interrupted");
      });
    },
    stop() {
      running = false;
      for (const cleanup of cleanups) cleanup();
      cleanups = [];
      const held = wakeLock;
      wakeLock = null;
      if (held) void held.release().catch(() => undefined);
    },
  };
}
