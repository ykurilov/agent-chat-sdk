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
  day: (day, totalDays) => (totalDays === undefined ? `Day ${day}` : `Day ${day} of ${totalDays}`),
  beforeFirstDay: "Before day one",
};
