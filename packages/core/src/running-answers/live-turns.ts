import type { TurnStopReason } from "../turn-hooks/turn-hooks";

/** Причина в `abort(reason)`: по ней ход узнаёт, кто его остановил. «Стоп» человека своей причины не несёт. */
class TurnStop extends Error {
  constructor(readonly reason: Exclude<TurnStopReason, "user">) {
    super(reason === "timeout" ? "Ход остановлен: вышел срок хода" : "Ход остановлен: служба останавливается");
    this.name = "AbortError";
  }
}

/** Сколько остановка ждёт конца остановленных ходов (конечная запись с повторами), прежде чем бросить их. */
export const STOPPED_TURNS_WAIT_MS = 10_000;

/** Кто остановил ход по сработавшему сигналу: срок, остановка службы или человек. */
export function turnStopReasonOf(signal: AbortSignal): TurnStopReason {
  return signal.reason instanceof TurnStop ? signal.reason.reason : "user";
}

/** Ход, который идёт в этой службе. */
export interface LiveTurn {
  /** Остановка хода сроком или остановкой службы; «Стоп» человека идёт через реестр. */
  signal: AbortSignal;
  /** Только остановка службы, без срока: ожидание `afterTurn` записанного ответа срок не обрывает. */
  shutdown: AbortSignal;
  /** Итог ответа записан: срок снимается, ожидание `afterTurn` он не обрывает. Остановка службы — по-прежнему. */
  answerWritten(): void;
  /** Ход закончен целиком (конечная запись, итог для приложения): срок снимается, остановка службы его больше не ждёт. */
  end(): void;
  /**
   * Можно ли ходу начать новый заход к модели после сбоя. Остановка службы уже ждёт ходы — нельзя: ход сразу получает
   * остановку (`shutdown`), ответ `false`.
   */
  newAttemptAllowed(): boolean;
}

/**
 * Ходы этой службы: общий срок хода и штатная остановка. Ход, начатый, пока остановка уже останавливает ходы, сразу
 * получает остановку.
 */
export interface LiveTurns {
  /** `timeoutMs` — общий срок хода; `null` — без срока. */
  begin(timeoutMs: number | null): LiveTurn;
  /**
   * Ждёт идущие ходы до `waitMs`, затем останавливает оставшиеся (`shutdown`) и ждёт их конца — конечной записи и итога —
   * до `stoppedWaitMs`. 0 — останавливает сразу. Возвращает, сколько ходов так и не закончилось.
   */
  drain(waitMs: number, stoppedWaitMs?: number): Promise<number>;
}

export function createLiveTurns(): LiveTurns {
  /** Ход → его остановка службой и конец. */
  const turns = new Map<AbortController, Promise<void>>();
  let stopping = false;
  /** Остановка службы ждёт ходы: идущие доделывают начатое, новых заходов к модели нет. */
  let draining = false;

  const allEnded = () => Promise.all(turns.values());

  return {
    begin(timeoutMs) {
      const controller = new AbortController();
      const deadline = new AbortController();
      let ended!: () => void;
      turns.set(controller, new Promise<void>((resolve) => (ended = resolve)));
      // Срок не держит процесс: ход и так держит соединение с моделью.
      const timer = timeoutMs === null ? undefined : setTimeout(() => deadline.abort(new TurnStop("timeout")), timeoutMs);
      timer?.unref?.();
      if (stopping) controller.abort(new TurnStop("shutdown"));
      return {
        signal: AbortSignal.any([controller.signal, deadline.signal]),
        shutdown: controller.signal,
        answerWritten() {
          clearTimeout(timer);
        },
        end() {
          clearTimeout(timer);
          if (turns.delete(controller)) ended();
        },
        newAttemptAllowed() {
          if (!draining && !stopping) return true;
          controller.abort(new TurnStop("shutdown"));
          return false;
        },
      };
    },

    async drain(waitMs, stoppedWaitMs = STOPPED_TURNS_WAIT_MS) {
      draining = true;
      try {
        if (waitMs > 0 && turns.size > 0) await endedWithin(waitMs, allEnded());
      } finally {
        draining = false;
      }
      stopping = true;
      try {
        for (const controller of turns.keys()) controller.abort(new TurnStop("shutdown"));
        // Ход, начатый во время ожидания, тоже ждём: он уже остановлен.
        const stopped = (async () => {
          while (turns.size > 0) await allEnded();
        })();
        if (turns.size > 0) await endedWithin(stoppedWaitMs, stopped);
        return turns.size;
      } finally {
        stopping = false;
      }
    },
  };
}

async function endedWithin(ms: number, work: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
}
