import { DEFAULT_FIRST_MESSAGES, type FirstMessagesRules, type FirstMessagesSetting } from "./flow-run";
import { clockMinutes, nextClockTime, parseClock, startOfNextDay } from "./zoned-time";

export { localDay } from "./zoned-time";

export interface FirstMessageInput {
  /** Когда агент хочет написать, мс. */
  at: number;
  timeZone: string;
  /** Сколько уже написал первым за эти сутки человека (`localDay`). */
  sentToday: number;
}

/** Настройка приложения поверх значений SDK (→ В10). `false` — правила выключены: `null`, агент пишет первым без ограничений. */
export function resolveFirstMessages(setting: FirstMessagesSetting | undefined): FirstMessagesRules | null {
  if (setting === false) return null;
  const rules: FirstMessagesRules = {
    quietHours: { ...DEFAULT_FIRST_MESSAGES.quietHours, ...setting?.quietHours },
    maxPerDay: setting?.maxPerDay ?? DEFAULT_FIRST_MESSAGES.maxPerDay,
    ...(setting?.canWriteNow ? { canWriteNow: setting.canWriteNow } : {}),
  };
  for (const clock of [rules.quietHours.from, rules.quietHours.to]) {
    if (parseClock(clock) === null) throw new Error(`Тихие часы пишутся как «ЧЧ:ММ», например «21:00», а не «${clock}».`);
  }
  return rules;
}

type QuietHours = FirstMessagesRules["quietHours"];

/** Тихо ли сейчас на часах человека. Тихие часы могут идти через полночь; `from` = `to` — тихих часов нет. */
function isQuiet(quietHours: QuietHours, at: number, timeZone: string): boolean {
  const from = parseClock(quietHours.from)!;
  const to = parseClock(quietHours.to)!;
  const now = clockMinutes(at, timeZone);
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** Первый момент от `at`, когда не тихо. */
function firstAwake(quietHours: QuietHours, at: number, timeZone: string): number {
  return isQuiet(quietHours, at, timeZone) ? nextClockTime(at, parseClock(quietHours.to)!, timeZone) : at;
}

/**
 * Можно ли написать первым сейчас; нет — на когда перенести. Тихие часы → их конец. Потолок за сутки исчерпан →
 * следующие сутки человека, после тихих часов.
 */
export function firstMessageSlot(
  rules: Omit<FirstMessagesRules, "canWriteNow">,
  input: FirstMessageInput,
): { allowed: true } | { allowed: false; retryAt: number } {
  const { at, timeZone } = input;
  if (input.sentToday >= rules.maxPerDay) {
    return { allowed: false, retryAt: firstAwake(rules.quietHours, startOfNextDay(at, timeZone), timeZone) };
  }
  const awake = firstAwake(rules.quietHours, at, timeZone);
  return awake === at ? { allowed: true } : { allowed: false, retryAt: awake };
}
