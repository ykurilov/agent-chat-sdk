/**
 * Строки пометок «агент написал первым» на экране чата (`flowNoticeLines`, право чата `appNotices`): по строке на
 * причину, несколько причин — через запятую в одной строке.
 */
export interface FlowNoticeLabels {
  /** Вся строка: «Агент написал первым — {причины}». */
  wroteFirst: (reasons: string) => string;
  /** Разделитель причин. */
  separator: string;
  /** «человек молчал 1 ч 7 мин». */
  silentFor: (duration: string) => string;
  /** Касание при молчании, длительность неизвестна. */
  silence: string;
  morning: string;
  /** Касание по расписанию (`dailyAt`). */
  daily: (at: string) => string;
  /** Ответ на сообщения, оставшиеся без ответа ночью или при лимите. */
  nightMessages: (count: number) => string;
  /** Прощание при «срок вышел». */
  farewell: string;
  /** Срок ноды: `condition` — условие словами, `stateTitle` — куда переход; нет — без них. */
  stateDeadline: (condition: string | undefined, stateTitle: string | undefined) => string;
  /** Общий срок от начала разговора. */
  overallDeadline: (condition: string | undefined, stateTitle: string | undefined) => string;
  /** Условия срока словами. */
  conditions: {
    stateDays: (duration: string) => string;
    programDay: (day: number) => string;
    timeOfDay: (at: string) => string;
    silence: (duration: string) => string;
    inState: (duration: string) => string;
    sinceStart: (duration: string) => string;
  };
  /** Единицы длительности: «1 д 3 ч 20 мин». */
  units: { day: string; hour: string; minute: string };
  lessThanMinute: string;
}

const withTarget = (head: string, condition: string | undefined, stateTitle: string | undefined) =>
  `${head}${condition ? ` (${condition})` : ""}${stateTitle ? ` → «${stateTitle}»` : ""}`;

export const russianFlowNoticeLabels: FlowNoticeLabels = {
  wroteFirst: (reasons) => `Агент написал первым — ${reasons}`,
  separator: ", ",
  silentFor: (duration) => `человек молчал ${duration}`,
  silence: "касание после молчания",
  morning: "утро нового дня",
  daily: (at) => `касание по расписанию в ${at}`,
  nightMessages: (count) => `ответ на ночные сообщения (${count})`,
  farewell: "прощание: срок программы вышел",
  stateDeadline: (condition, stateTitle) => withTarget("срок шага вышел", condition, stateTitle),
  overallDeadline: (condition, stateTitle) => withTarget("общий срок вышел", condition, stateTitle),
  conditions: {
    stateDays: (duration) => `шаг длился ${duration}`,
    programDay: (day) => `наступил день ${day}`,
    timeOfDay: (at) => `наступило ${at}`,
    silence: (duration) => `тишина ${duration}`,
    inState: (duration) => `в шаге ${duration}`,
    sinceStart: (duration) => `${duration} с начала разговора`,
  },
  units: { day: "д", hour: "ч", minute: "мин" },
  lessThanMinute: "меньше минуты",
};

export const englishFlowNoticeLabels: FlowNoticeLabels = {
  wroteFirst: (reasons) => `The agent wrote first — ${reasons}`,
  separator: ", ",
  silentFor: (duration) => `the person was silent for ${duration}`,
  silence: "a nudge after silence",
  morning: "a new day's morning",
  daily: (at) => `a scheduled nudge at ${at}`,
  nightMessages: (count) => `a reply to night messages (${count})`,
  farewell: "a farewell: the program is over",
  stateDeadline: (condition, stateTitle) => withTarget("the step's time is up", condition, stateTitle),
  overallDeadline: (condition, stateTitle) => withTarget("the overall time is up", condition, stateTitle),
  conditions: {
    stateDays: (duration) => `the step lasted ${duration}`,
    programDay: (day) => `day ${day} began`,
    timeOfDay: (at) => `it's ${at}`,
    silence: (duration) => `silence for ${duration}`,
    inState: (duration) => `${duration} in the step`,
    sinceStart: (duration) => `${duration} since the start`,
  },
  units: { day: "d", hour: "h", minute: "min" },
  lessThanMinute: "less than a minute",
};
