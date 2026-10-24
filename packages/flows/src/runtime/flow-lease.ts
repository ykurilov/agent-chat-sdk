import type { FlowStore } from "../store/flow-store";

/** Аренда чата под работой: `held` — ещё наша (свежая проверка в хранилище с продлением). */
export interface HeldLease {
  held(): Promise<boolean>;
  /** Остановить продления; после выхода продлений в полёте нет. */
  stop(): Promise<void>;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Аренда одного чата, пока идёт работа (срабатывание таймера, отправка доставки): продлевается каждую треть срока, по
 * одному продлению за раз. Хранилище ответило «не наша» — аренда потеряна насовсем. Общая для таймеров и доставки.
 */
export function holdLease(input: { store: FlowStore; chatId: string; owner: string; leaseMs: number; now: () => Date; logError: (message: string) => void }): HeldLease {
  const { store, chatId, owner, leaseMs } = input;
  let lost = false;
  let renewing: Promise<void> | null = null;
  const renewNow = async () => {
    if (lost) return false;
    if (!(await store.renewLease({ chatId, owner, now: input.now().toISOString(), leaseMs }))) lost = true;
    return !lost;
  };
  const heartbeat = setInterval(() => {
    renewing ??= renewNow()
      .then(
        () => {},
        (error) => input.logError(`[сценарий] чат=${chatId} аренда не продлена: ${errorText(error)}`),
      )
      .finally(() => {
        renewing = null;
      });
  }, leaseMs / 3);
  heartbeat.unref?.();
  return {
    held: renewNow,
    async stop() {
      clearInterval(heartbeat);
      await renewing;
    },
  };
}
