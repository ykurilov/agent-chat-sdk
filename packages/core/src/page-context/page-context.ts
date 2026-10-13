/** Где сейчас человек в приложении. Живёт в браузере и уходит в теле запроса хода; в хранилище не пишется. */
export interface ScreenPlace {
  /** Для модели: «Карточка клиента «ООО Ромашка», id 42». */
  description: string;
  /** Только для инструментов; JSON. */
  data?: Record<string, unknown>;
}

/** Инструмент изменил данные приложения. */
export interface DataChange {
  /** 1–100 знаков, например `tasks`. */
  tag: string;
  /** JSON до 4 КБ. */
  details?: unknown;
}

/** С чем пришёл запрос хода: место на экране, вкладка, которая его отправила, и часовой пояс человека. */
export interface TurnRequestContext {
  place?: ScreenPlace | null;
  tabId?: string;
  /** Пояс браузера человека (`Intl.DateTimeFormat().resolvedOptions().timeZone`): по нему дата в запросе. Не IANA — не берётся. */
  timeZone?: string;
}

/**
 * Запрос страницы для продолжения после поправок на лету. Вкладка и пояс — последней присланной страницы: браузерные
 * инструменты продолжения идут на вкладку последней поправки. Место — последней поправки, где оно есть (`null` — «места
 * нет»), иначе начала хода: поправка только с вкладкой место не стирает.
 */
export function continuationRequestContext(start: TurnRequestContext | undefined, corrections: readonly TurnRequestContext[]): TurnRequestContext | undefined {
  const last = corrections.at(-1) ?? start;
  if (last === undefined) return undefined;
  const place = (corrections.findLast((page) => page.place !== undefined) ?? start)?.place;
  return {
    ...(place !== undefined && { place }),
    ...(last.tabId !== undefined && { tabId: last.tabId }),
    ...(last.timeZone !== undefined && { timeZone: last.timeZone }),
  };
}

/** Кусок потока ответа: данные приложения изменены. Временный, в хранилище не попадает. */
export const APP_CHANGE_PART_TYPE = "data-app-change";

/** Кусок потока ответа: вкладка должна выполнить браузерный инструмент. Временный, в хранилище не попадает. */
export const BROWSER_CALL_PART_TYPE = "data-browser-call";
