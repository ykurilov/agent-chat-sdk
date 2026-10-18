/** Надписи тестового чата редактора: живой разговор по сценарию с перемоткой часов. */
export interface FlowTestChatLabels {
  title: string;
  state: string;
  /** «+20 мин». */
  advance: (label: string) => string;
  clock: string;
  /** Часы чата не сдвинуты. */
  noOffset: string;
  /** Единицы сдвига: «3 ч 20 мин». */
  units: { day: string; hour: string; minute: string };
  reset: string;
  close: string;
  /** Тестовый чат не открылся или часы не перемотались. */
  failed: string;
  /** Перемотка к началу следующего дня сценария. */
  nextDay: string;
  /** Перемотка к моменту, когда сценарий сам напишет первым. */
  nextFirstMessage: string;
  /** Впереди сценарий сам ничего не напишет: перематывать к напоминанию не к чему. */
  nothingScheduled: string;
  /** Поле «своё время»: подпись, пример и подсказка на непонятное. */
  customTime: string;
  customTimePlaceholder: string;
  customTimeInvalid: string;
  /** «День 2 из 3», «День 2». */
  day: (day: number, totalDays?: number) => string;
  /** Вечер позднего старта: первый день ещё не начался. */
  beforeFirstDay: string;
}

export const russianFlowTestChatLabels: FlowTestChatLabels = {
  title: "Тестовый чат",
  state: "Сейчас в состоянии",
  advance: (label) => `+${label}`,
  clock: "Часы чата",
  noOffset: "как сейчас",
  units: { day: "д", hour: "ч", minute: "мин" },
  reset: "Начать заново",
  close: "Закрыть",
  failed: "Не получилось — попробуйте ещё раз",
  nextDay: "К началу следующего дня",
  nextFirstMessage: "К следующему напоминанию",
  nothingScheduled: "Впереди сценарий сам ничего не напишет",
  customTime: "Своё время",
  customTimePlaceholder: "15 мин, 1 ч 30 мин, 2 дня",
  customTimeInvalid: "Не понял время — например, «1 ч 30 мин» или «2 дня»",
  day: (day, totalDays) => (totalDays === undefined ? `День ${day}` : `День ${day} из ${totalDays}`),
  beforeFirstDay: "До первого дня",
};

export const englishFlowTestChatLabels: FlowTestChatLabels = {
  title: "Test chat",
  state: "Current state",
  advance: (label) => `+${label}`,
  clock: "Chat clock",
  noOffset: "now",
  units: { day: "d", hour: "h", minute: "min" },
  reset: "Start over",
  close: "Close",
  failed: "Something went wrong — try again",
  nextDay: "To the start of the next day",
  nextFirstMessage: "To the next reminder",
  nothingScheduled: "The flow won't write first from here on",
  customTime: "Custom time",
  customTimePlaceholder: "15 min, 1h 30m, 2 days",
  customTimeInvalid: "Couldn't read the time — try “1h 30m” or “2 days”",
  day: (day, totalDays) => (totalDays === undefined ? `Day ${day}` : `Day ${day} of ${totalDays}`),
  beforeFirstDay: "Before day one",
};
