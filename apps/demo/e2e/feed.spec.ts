import { expect, test } from "@playwright/test";
import { lastAnswer, send } from "./support/chat";
import {
  distanceFromBottom,
  expectCleanSweep,
  expectFeedFollowsAnswer,
  openLongChat,
  slowDownCpu,
  sweepFeed,
  FIRST_QUESTION_MARKER,
  readerFling,
  scrollIntoFeedView,
  lastAnswerMarker,
  waitUntilFeedStill,
} from "./support/feed";

/*
 * Длинная лента (фича 002, US1) на экране телефона: в Chromium (`iphone-light`, процессор в 4 раза медленнее)
 * и в WebKit (`iphone-webkit`, Safari отличается прокруткой и замером высот). Здесь поведение: лента едет за ответом,
 * не тащит читателя, раскрытое переживает уход за край. Время открытия и долгие задачи — perf-feed.spec.ts.
 * В WebKit нет замедления процессора и чтения буфера обмена: копирование там пропускается.
 */

const MESSAGE_COUNT = 500;

test.describe.configure({ timeout: 180_000 });

test.beforeEach(async ({ page }) => {
  await slowDownCpu(page);
});

test("прокрутка до самого начала и обратно без пустот (WebKit; в Chromium это делает perf-feed.spec.ts вместе с замером)", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "webkit", "в Chromium тот же проход идёт в perf-feed.spec.ts");
  await openLongChat(page, MESSAGE_COUNT);

  // Бросками по 8 экранов с остановкой, как листает читатель. Один проход на все 330 экранов без остановки — не жест:
  // библиотека окна на iPhone копит поправки высот до конца прокрутки и потом применяет разом, и лента уезжает с верха в середину.
  // Живой бросок и остановку она держит ровно: на экране остаётся то же сообщение на том же месте.
  await expectCleanSweep(page, "up", MESSAGE_COUNT, { flingScreens: 8 });
  await expectCleanSweep(page, "down", MESSAGE_COUNT, { flingScreens: 8 });
});

test("сообщение, отправленное сверху, приводит ленту вниз, и лента едет за ответом", async ({ browserName, page }) => {
  await openLongChat(page, MESSAGE_COUNT);
  await sweepFeed(page, "up", FIRST_QUESTION_MARKER, lastAnswerMarker(MESSAGE_COUNT), readerFling(browserName));

  await send(page, "Дай длинный ответ");
  const answer = lastAnswer(page);
  await expect(answer).toHaveAttribute("data-status", "streaming");
  await expect(answer).toBeInViewport();
  // Пока ответ растёт, читатель остаётся у его низа. Конца ответа (минута) не ждём.
  await expectFeedFollowsAnswer(page, answer);
});

test("открыл длинный чат и сразу отправил, не дожидаясь, пока лента осядет: лента едет за ответом", async ({ page }) => {
  await openLongChat(page, MESSAGE_COUNT);

  await send(page, "Дай длинный ответ");
  const answer = lastAnswer(page);
  await expect(answer).toHaveAttribute("data-status", "streaming");
  await expectFeedFollowsAnswer(page, answer);
});

// Окно ленты доводит прокрутку первого показа, пока сообщения измеряются, и целилось в прежний конец ленты. Высокое
// вставленное сообщение уводило низ от этого конца дальше порога прилипания, и новый ответ уходил под поле ввода.
test("открыл длинный чат и сразу вставил длинный текст: лента едет за ответом до конца", async ({ page }) => {
  await openLongChat(page, MESSAGE_COUNT);
  // Ждём конец именно нового ответа: прежние помечены до отправки.
  await page.evaluate(() => document.querySelectorAll("[data-status]").forEach((answer) => answer.setAttribute("data-old", "")));

  const field = page.getByRole("textbox", { name: "Сообщение" });
  await field.fill([...Array.from({ length: 20 }, (_, index) => `Строка вставленного текста ${index + 1}.`), "Расскажи подробно"].join("\n"));
  await field.press("Enter");
  await page.waitForFunction(
    () => {
      const answers = document.querySelectorAll("[data-status]");
      const last = answers[answers.length - 1];
      return last !== undefined && !last.hasAttribute("data-old") && last.getAttribute("data-status") === "complete";
    },
    undefined,
    { polling: "raf", timeout: 30_000 },
  );

  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
});

test("набор текста с пробелом в поле, Enter, длинный ответ одним куском: лента у низа", async ({ page }) => {
  await openLongChat(page, MESSAGE_COUNT);

  // Клавиши нажимаются в поле, как у человека: пробел из поля не должен снимать прилипание ленты к низу.
  const field = page.getByRole("textbox", { name: "Сообщение" });
  await field.pressSequentially("Расскажи подробно");
  await field.press("Enter");

  const answer = lastAnswer(page);
  await expect(answer).toContainText("Пункт 50:", { timeout: 30_000 });
  await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2);
});

test("прокрутка вверх во время ответа: положение не меняется, пока ответ дописывается", async ({ page }) => {
  await openLongChat(page, MESSAGE_COUNT);

  await send(page, "Дай длинный ответ");
  const answer = lastAnswer(page);
  await expect(answer).toHaveAttribute("data-status", "streaming");
  const scroller = page.getByRole("log").locator("xpath=..");
  await scroller.evaluate((element) => {
    element.scrollTop -= 3 * element.clientHeight;
  });
  // Положение читателя — это место на экране, а не число прокрутки: окно ленты, измерив сообщения
  // над экраном, само поправляет прокрутку, и содержимое при этом стоит на месте.
  // Поэтому ждём, пока окно ленты уляжется после прыжка.
  const spot = await waitUntilFeedStill(page);
  const topBefore = await spot.evaluate((element) => element.getBoundingClientRect().top);

  // Пока ответ дописывается (до конца, это минута, не ждём), место на экране не меняется.
  await expect(answer).toContainText("Абзац 12:", { timeout: 30_000 });
  const stillInFeed = await spot.evaluate((element) => element.isConnected);
  expect(stillInFeed, "сообщение, на котором стоял читатель, пропало из окна ленты").toBe(true);
  const topAfter = await spot.evaluate((element) => element.getBoundingClientRect().top);
  expect(Math.abs(topAfter - topBefore), "лента сдвинулась, пока ответ дописывался").toBeLessThanOrEqual(2);
});

test("медленная прокрутка колесом вверх у низа: лента уходит вверх и не возвращается вниз", async ({ browserName, page }) => {
  test.skip(browserName === "webkit", "мобильный WebKit не умеет колесо мыши; ввод читателя там проверяют юнит-тесты");
  await openLongChat(page, MESSAGE_COUNT);
  await waitUntilFeedStill(page);
  await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2);
  const scroller = page.getByRole("log").locator("xpath=..");
  await scroller.hover();

  // Мелкие шаги тачпада: каждый меньше порога прилипания (96 px). Окно ленты на каждом шаге меняет разметку:
  // следующий шаг — только после двух кадров, когда прокрутка применена и лента перерисовалась.
  for (let step = 0; step < 12; step++) {
    await page.mouse.wheel(0, -8);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }

  // Шаги ушли вверх и остались там: ждём, пока окно ленты уляжется, и смотрим ещё раз.
  await waitUntilFeedStill(page);
  expect(await distanceFromBottom(page), "лента вернулась к низу после медленной прокрутки вверх").toBeGreaterThan(40);
});

test("раскрытое в старом ответе переживает уход за край, копирование и «Остановлено» у старого ответа работают", async ({
  browserName,
  page,
}) => {
  await openLongChat(page, MESSAGE_COUNT);

  // Ход с остановленным ответом лежит в самой середине чата.
  const stoppedTurn = Math.ceil(MESSAGE_COUNT / 4);
  const scroller = page.getByRole("log").locator("xpath=..");
  const target = page.locator("[data-feed-item]", { hasText: `Ответ ${stoppedTurn}` }).first();
  // Сперва до самого верха: пока сообщения не измерены, окно ленты считает их по прикидке, и точное
  // положение ответа на экране не проверить. Потом вниз, пока ответ из середины не появится в окне.
  await sweepFeed(page, "up", FIRST_QUESTION_MARKER, lastAnswerMarker(MESSAGE_COUNT), readerFling(browserName));
  await scroller.evaluate(async (element, turn) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (let index = 0; index < 800; index++) {
      const found = [...document.querySelectorAll("[data-feed-item]")].some((item) => item.textContent?.includes(`Ответ ${turn}`));
      if (found) return;
      element.scrollTop += element.clientHeight * 0.8;
      await frame();
    }
  }, stoppedTurn);
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();

  await expect(target.getByText("Остановлено")).toBeVisible();

  const reasoning = target.getByRole("button", { name: /Думал/ }).first();
  const tool = target.getByRole("button", { name: /current_time/ }).first();
  await scrollIntoFeedView(page, reasoning);
  await reasoning.click();
  await scrollIntoFeedView(page, tool);
  await tool.click();
  await expect(reasoning).toHaveAttribute("aria-expanded", "true");
  await expect(tool).toHaveAttribute("aria-expanded", "true");
  const positionBefore = await target.evaluate((element) => element.getBoundingClientRect().top);

  // Пять экранов вверх и обратно: ответ уходит из окна ленты и возвращается. Шаг целый: у половины
  // экрана в 261,5 px браузер округляет шаг вверх и вниз по-разному, и возврат не был бы точным.
  const travel = await scroller.evaluate(async (element) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const step = Math.floor(element.clientHeight / 2);
    const start = element.scrollTop;
    for (let moved = 0; moved < step * 10; moved += step) {
      element.scrollTop -= step;
      await frame();
    }
    await frame();
    const midway = element.scrollTop;
    for (let moved = 0; moved < step * 10; moved += step) {
      element.scrollTop += step;
      await frame();
    }
    await frame();
    return { start, midway, end: element.scrollTop };
  });
  expect(travel.midway).toBeLessThan(travel.start);
  await expect(target).toBeVisible();
  const backAgain = page.locator("[data-feed-item]", { hasText: `Ответ ${stoppedTurn}` }).first();
  await expect(backAgain.getByRole("button", { name: /Думал/ }).first()).toHaveAttribute("aria-expanded", "true");
  await expect(backAgain.getByRole("button", { name: /current_time/ }).first()).toHaveAttribute("aria-expanded", "true");
  const positionAfter = await backAgain.evaluate((element) => element.getBoundingClientRect().top);
  expect(Math.abs(positionAfter - positionBefore), "ответ сдвинулся на экране").toBeLessThanOrEqual(4);

  if (browserName !== "webkit") {
    await backAgain.getByRole("button", { name: "Скопировать код" }).first().click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(`const difference${stoppedTurn} =`);
    await backAgain.getByRole("button", { name: "Скопировать ответ" }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(`### Ответ ${stoppedTurn}`);
    expect(copied).toContain("| Токио | 18:");
    expect(copied).toContain("- второй пункт с **выделением**");
  }
});
