/** Надписи экрана карточки клиента. */
export interface ClientCardLabels {
  title: string;
  empty: string;
  /** «обновлено 12.10.2026». */
  updatedAt: (date: string) => string;
  stale: string;
  /** Название строки свободного факта («ведёт блог») в списке. */
  fact: string;
  forgetField: string;
  forgetAll: string;
  forgetAllConfirm: string;
  confirm: string;
  cancel: string;
  loading: string;
  failed: string;
  retry: string;
}

export const russianClientCardLabels: ClientCardLabels = {
  title: "Что агент знает о вас",
  empty: "Агент пока ничего о вас не запомнил.",
  updatedAt: (date) => `обновлено ${date}`,
  stale: "может быть уже не так",
  fact: "Факт",
  forgetField: "Стереть",
  forgetAll: "Стереть всё",
  forgetAllConfirm: "Стереть всё, что агент знает о вас? Вернуть не получится.",
  confirm: "Стереть",
  cancel: "Отмена",
  loading: "Загружаем…",
  failed: "Не получилось загрузить. Попробуйте ещё раз",
  retry: "Повторить",
};

export const englishClientCardLabels: ClientCardLabels = {
  title: "What the agent knows about you",
  empty: "The agent has not remembered anything about you yet.",
  updatedAt: (date) => `updated ${date}`,
  stale: "may be out of date",
  fact: "Fact",
  forgetField: "Erase",
  forgetAll: "Erase everything",
  forgetAllConfirm: "Erase everything the agent knows about you? This cannot be undone.",
  confirm: "Erase",
  cancel: "Cancel",
  loading: "Loading…",
  failed: "Could not load. Try again",
  retry: "Retry",
};
