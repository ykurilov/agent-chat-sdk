import { mkdirSync } from "node:fs";
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** Проверки и снимки того, что видно на экране: вёрстка не вылезает за край, снимок после смены темы. */

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "страница шире экрана").toBeLessThanOrEqual(0);
}

/** Элемент целиком в экране; `horizontalOnly` — только по ширине (длинную ленту можно прокрутить по высоте). */
export async function expectInsideViewport(page: Page, locator: Locator, { horizontalOnly = false } = {}) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box, "элемент не нарисован").not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  if (horizontalOnly) return;
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
}

/**
 * Смена темы идёт плавным переходом цветов: смотрим, когда все переходы закончились. Отменённый переход
 * (элемент убрали) тоже конец: его `finished` завершается отказом.
 */
export async function settleAnimations(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** Снимок экрана в папку для просмотра глазами, когда все переходы закончились. */
export async function saveScreenshot(page: Page, folder: string, name: string) {
  await settleAnimations(page);
  mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: `${folder}/${name}.png` });
}
