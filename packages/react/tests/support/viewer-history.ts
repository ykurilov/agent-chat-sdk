/*
 * «Назад» в jsdom не мгновенный: история сдвигается и шлёт `popstate` через пару задач. Окно просмотра,
 * закрываясь (в том числе при уборке теста), само просит «назад». Следующий тест ждёт ответа на каждую
 * такую просьбу, а не паузу: под нагрузкой пауза кончается раньше ответа, тест видит запись окна, просит
 * «назад» ещё раз — и лишний «назад» уводит историю со страницы посреди следующего теста.
 */

let unansweredBacks = 0;
let onAllAnswered: (() => void) | undefined;

const pageBack = history.back.bind(history);
history.back = () => {
  unansweredBacks += 1;
  pageBack();
};
addEventListener("popstate", () => {
  if (unansweredBacks > 0) unansweredBacks -= 1;
  if (unansweredBacks === 0) {
    onAllAnswered?.();
    onAllAnswered = undefined;
  }
});

function allBacksAnswered(): Promise<void> {
  return unansweredBacks === 0 ? Promise.resolve() : new Promise((resolve) => (onAllAnswered = resolve));
}

/** Запись истории, которую поставило окно просмотра. */
export const viewerEntry = () => (history.state as Record<string, unknown> | null)?.agentChatViewer;

/** Возвращает историю к странице: дожидается ответа на уже заданные «назад» и уходит с записей окна, если они остались. */
export async function leaveViewerHistory(): Promise<void> {
  await allBacksAnswered();
  while (viewerEntry() !== undefined) {
    history.back();
    await allBacksAnswered();
  }
}
