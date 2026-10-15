import type { ChatErrorKind } from "../conversation/types";

/** Отказ, после которого провайдер не ответит ни на какой запрос: кончились деньги или не принят ключ. */
export type ProviderOutageKind = Extract<ChatErrorKind, "insufficient_funds" | "invalid_key">;

export function isProviderOutage(kind: ChatErrorKind): kind is ProviderOutageKind {
  return kind === "insufficient_funds" || kind === "invalid_key";
}

/** Сколько провайдер на паузе после отказа: новые ходы это время сразу идут к запасному. */
export const PROVIDER_OUTAGE_PAUSE_MS = 5 * 60_000;
/** Громкая строка о провайдере — не чаще. */
export const PROVIDER_OUTAGE_ALERT_EVERY_MS = 15 * 60_000;
/** Пауза кончилась: один ход пробует провайдера, остальные это время идут мимо. Проба без итога — через этот срок следующая. */
export const PROVIDER_OUTAGE_PROBE_MS = 60_000;

const SAID: Record<ProviderOutageKind, string> = {
  insufficient_funds: "кончились деньги",
  invalid_key: "ключ не принят",
};

/**
 * Память службы об отказах провайдеров по деньгам и ключу. Пустой счёт за минуты не пополнится: ходы на паузе не
 * стучат в него каждый раз, а после паузы его пробует один ход, не все разом. Кэш при этом не теряется — ответить
 * основной всё равно не может, а запасной на паузе получает все запросы подряд, и его кэш тёплый.
 */
export interface ProviderOutages {
  /**
   * Провайдер отказал: пауза на `PROVIDER_OUTAGE_PAUSE_MS` и, не чаще раза в `PROVIDER_OUTAGE_ALERT_EVERY_MS`, строка
   * `[ВНИМАНИЕ провайдер]` в журнал. `fallbackProviderId` — кто отвечает вместо; нет — ходы падают, а
   * `fallbacksPaused` говорит, что запасные есть, но тоже на паузе.
   */
  report(input: { providerId: string; kind: ProviderOutageKind; fallbackProviderId?: string; fallbacksPaused?: boolean }): void;
  /** Вид отказа, пока провайдер на паузе или его пробует другой ход; иначе `undefined`. Ничего не меняет. */
  pausedKind(providerId: string): ProviderOutageKind | undefined;
  /**
   * Ход хочет к провайдеру: `undefined` — можно, вид отказа — нельзя. Пауза кончилась — первый получает пробу
   * на `PROVIDER_OUTAGE_PROBE_MS`, остальные до её итога — вид отказа.
   */
  admit(providerId: string): ProviderOutageKind | undefined;
  /** Провайдер ответил: пауза снята. Счёт громких строк остаётся — «мигающий» провайдер не шумит. */
  recovered(providerId: string): void;
}

export function createProviderOutages(options: { now: () => number; logError: (message: string) => void }): ProviderOutages {
  const outages = new Map<string, { kind: ProviderOutageKind; pausedUntil: number; probeUntil?: number }>();
  const alertedAt = new Map<string, number>();
  const pausedKind = (providerId: string): ProviderOutageKind | undefined => {
    const outage = outages.get(providerId);
    if (!outage) return undefined;
    const time = options.now();
    return time < outage.pausedUntil || time < (outage.probeUntil ?? 0) ? outage.kind : undefined;
  };
  return {
    report({ providerId, kind, fallbackProviderId, fallbacksPaused }) {
      const time = options.now();
      outages.set(providerId, { kind, pausedUntil: time + PROVIDER_OUTAGE_PAUSE_MS });
      const last = alertedAt.get(providerId);
      if (last !== undefined && time - last < PROVIDER_OUTAGE_ALERT_EVERY_MS) return;
      alertedAt.set(providerId, time);
      const route =
        fallbackProviderId !== undefined
          ? `ходы идут через запасной ${fallbackProviderId}`
          : `${fallbacksPaused ? "запасные тоже на паузе" : "запасного нет"}, ходы падают с ошибкой`;
      options.logError(`[ВНИМАНИЕ провайдер] ${providerId}: ${SAID[kind]} — ${route}`);
    },
    pausedKind,
    admit(providerId) {
      const kind = pausedKind(providerId);
      const outage = outages.get(providerId);
      if (kind === undefined && outage) outage.probeUntil = options.now() + PROVIDER_OUTAGE_PROBE_MS;
      return kind;
    },
    recovered(providerId) {
      outages.delete(providerId);
    },
  };
}
