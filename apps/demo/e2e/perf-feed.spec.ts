import { expect, test } from "@playwright/test";
import { lastAnswer, send } from "./support/chat";
import {
  distanceFromBottom,
  FEED_ITEMS_LIMIT,
  expectCleanSweep,
  feedItems,
  LONG_TASK_LIMIT_MS,
  longest,
  observeLongTasks,
  OPEN_LIMIT_MS,
  openLongChat,
  slowDownCpu,
  takeLongTasks,
  waitForLastAnswerStatus,
} from "./support/feed";

/*
 * Замеры скорости длинной ленты (фича 002, SC-001–SC-003): телефон, процессор в 4 раза медленнее.
 * Группа `perf-phone`: только в `pnpm test:e2e:perf`, без проверок поведения, по одному тесту за раз — соседи не шумят.
 * Демо раздаётся собранным (`vite build`): так страницу видит пользователь; режим разработки замерам не подходит
 * (см. research.md, R15). Пороги 1 с и 200 мс — из спецификации.
 */

const HUGE_ANSWER_MIN_LENGTH = 40_000;

// Запись трассы Playwright снимает снимки страницы посреди замера и сама даёт долгие задачи: в замерах она выключена.
test.use({ trace: "off" });

test.beforeEach(async ({ page }) => {
  await observeLongTasks(page);
  await slowDownCpu(page);
});

for (const messageCount of [500, 2000]) {
  test(`чат на ${messageCount} сообщений открывается за ${OPEN_LIMIT_MS} мс после прихода истории, на странице не больше ${FEED_ITEMS_LIMIT} сообщений`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const opening = await openLongChat(page, messageCount);
    const openingTasks = await takeLongTasks(page, opening.historyArrivedAt);
    const itemCount = await feedItems(page).count();
    console.log(
      `[${testInfo.project.name}] ${messageCount} сообщений: открытие ${Math.round(opening.openingMs)} мс, ` +
        `долгие задачи после прихода истории, мс: ${JSON.stringify(openingTasks.map(Math.round))}, сообщений на странице ${itemCount}`,
    );

    expect(opening.openingMs).toBeLessThanOrEqual(OPEN_LIMIT_MS);
    expect(longest(openingTasks)).toBeLessThanOrEqual(LONG_TASK_LIMIT_MS);
    expect(itemCount).toBeGreaterThan(0);
    expect(itemCount).toBeLessThanOrEqual(FEED_ITEMS_LIMIT);
    expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
  });
}

test("прокрутка до самого начала и обратно: долгих задач нет, пустоты не видно, сообщений на странице не больше 40", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const messageCount = 500;
  await openLongChat(page, messageCount);
  await takeLongTasks(page);

  const up = await expectCleanSweep(page, "up", messageCount);
  const upTasks = await takeLongTasks(page);
  const down = await expectCleanSweep(page, "down", messageCount);
  const downTasks = await takeLongTasks(page);

  console.log(
    `[${testInfo.project.name}] прокрутка: кадров ${up.frames} вверх и ${down.frames} вниз, больше всего сообщений на странице ${Math.max(up.maxItems, down.maxItems)}, ` +
      `долгие задачи, мс: вверх ${JSON.stringify(upTasks.map(Math.round))}, вниз ${JSON.stringify(downTasks.map(Math.round))}`,
  );
  expect(longest(upTasks)).toBeLessThanOrEqual(LONG_TASK_LIMIT_MS);
  expect(longest(downTasks)).toBeLessThanOrEqual(LONG_TASK_LIMIT_MS);
});

test("огромный ответ у низа: лента едет за ним без долгих задач", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const messageCount = 500;
  await openLongChat(page, messageCount);

  // Без ожидания, пока лента осядет: собеседник открыл чат и сразу отправил (FR-004).
  await takeLongTasks(page);
  await send(page, "Напиши огромный ответ");
  // Последним в окне может быть ещё прошлый ответ: ждём, пока появится новый и начнёт расти.
  await waitForLastAnswerStatus(page, "streaming");
  await waitForLastAnswerStatus(page, "complete", 120_000);
  const growTasks = await takeLongTasks(page);
  const answer = lastAnswer(page);
  expect((await answer.innerText()).length).toBeGreaterThan(HUGE_ANSWER_MIN_LENGTH);
  expect(await answer.locator("table").count()).toBeGreaterThan(50);
  expect(await answer.locator("pre code").count()).toBeGreaterThan(50);
  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
  console.log(`[${testInfo.project.name}] долгие задачи, пока рос огромный ответ, мс: ${JSON.stringify(growTasks.map(Math.round))}`);
  expect(longest(growTasks)).toBeLessThanOrEqual(LONG_TASK_LIMIT_MS);
});

// Когда ответ дописан, под ним появляется строка с кнопками, а по ходу дописывается последний блок. Если стили
// устроены так, что от этого меняется «последний ли это элемент» у большого куска ответа, браузер пересчитывает
// стили каждого элемента разом: на 50 000 символов это 1 200–4 500 элементов, а на ответе вдвое длиннее — вдвое больше.
// Считаем не время (оно зависит от машины), а размах: сколько элементов браузер пересчитывает за раз.
// Но крупный пересчёт бывает и не по нашей вине: в конце ответа окно ленты (virtua) примерно в половине прогонов
// переставляет последнее сообщение, и браузер пересчитывает стили всего сообщения (~2 500 элементов). Их различает
// причина в трассе: у окна ленты это только смена `style` у обёрток; у ошибки скина — правило из таблицы стилей
// (совпало по имени тега или классу, «сбросить стили поддерева»). Крупный пересчёт с такой причиной — дефект.
const RESTYLED_ELEMENTS_LIMIT = 1_000;
const SELECTOR_DRIVEN_REASON = /matched|invalidates subtree/i;

interface TraceEvent {
  name: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: { elementCount?: number; data?: { reason?: string } };
}

test("огромный ответ: браузер не пересчитывает стили всего ответа разом из-за правил скина, ни по ходу, ни в конце", async ({ browser, page }) => {
  test.setTimeout(240_000);
  await openLongChat(page, 500);

  await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline.invalidationTracking"] });
  await send(page, "Напиши огромный ответ");
  await waitForLastAnswerStatus(page, "streaming");
  await waitForLastAnswerStatus(page, "complete", 120_000);
  // Конец ответа: строка с кнопками появляется, лента оседает.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const trace = JSON.parse((await browser.stopTracing()).toString()) as { traceEvents: TraceEvent[] };

  const restyles = trace.traceEvents.filter((event) => event.name === "UpdateLayoutTree");
  expect(restyles.length, "в трассе есть пересчёты стилей").toBeGreaterThan(0);
  const invalidations = trace.traceEvents.filter((event) => event.name === "StyleInvalidatorInvalidationTracking" || event.name === "StyleRecalcInvalidationTracking");
  // Крупные пересчёты с причиной из таблицы стилей: причины берём из событий между прошлым пересчётом и этим.
  const bySelectorRules = restyles.flatMap((restyle, index) => {
    const size = restyle.args?.elementCount ?? 0;
    if (size <= RESTYLED_ELEMENTS_LIMIT) return [];
    // Правила из таблицы стилей срабатывают внутри самого пересчёта, поэтому окно — от конца прошлого до конца этого.
    const since = restyles[index - 1] ? restyles[index - 1]!.ts + (restyles[index - 1]!.dur ?? 0) : 0;
    const causedBySelector = invalidations.some(
      (event) => event.tid === restyle.tid && event.ts > since && event.ts <= restyle.ts + (restyle.dur ?? 0) && SELECTOR_DRIVEN_REASON.test(event.args?.data?.reason ?? ""),
    );
    return causedBySelector ? [size] : [];
  });
  const largest = Math.max(0, ...restyles.map((event) => event.args?.elementCount ?? 0));
  console.log(`пересчёт стилей: ${restyles.length} раз, больше всего ${largest} элементов, крупных из-за правил скина: ${JSON.stringify(bySelectorRules)}`);
  expect(bySelectorRules, "крупные пересчёты стилей из-за правил скина").toEqual([]);
});
