import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/*
 * T047 плана 024: картинки агента в скине Тандем — 1, 3 и 8 картинок, частичный сбой со «Стопом», заглушки; светлая и
 * тёмная тема — снимками; компьютер и узкий экран 320 px. Снимки лежат в /tmp/agent-chat-skin-images для просмотра
 * глазами (эталонных снимков нет). Проверяется вёрстка: всё в экране, ничего не прокручивается вбок.
 */

const screenshotDir = "/tmp/agent-chat-skin-images";
mkdirSync(screenshotDir, { recursive: true });

async function open(page: Page, theme: string, show: string) {
  await page.goto(`/images.html?theme=${theme}&show=${show}`);
  await page.locator("main").waitFor();
  await page.evaluate(() => document.fonts.ready);
}

async function expectLayout(page: Page) {
  const viewport = page.viewportSize()!;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "страница шире экрана").toBeLessThanOrEqual(0);
  for (const tile of await page.locator("[data-tile]").all()) {
    const box = (await tile.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  }
}

const screens = [
  { name: "desktop", width: 1100, height: 760, touch: false },
  { name: "phone-320", width: 320, height: 640, touch: true },
];
const shows = ["one", "three", "eight", "partial", "loading"];

for (const screen of screens) {
  test.describe(screen.name, () => {
    test.use({ viewport: { width: screen.width, height: screen.height }, hasTouch: screen.touch, isMobile: screen.touch });

    test("вёрстка и снимки: 1, 3, 8, частичный сбой, заглушки; светлая и тёмная тема", async ({ page }) => {
      for (const show of shows) {
        for (const theme of ["light", "dark"]) {
          await open(page, theme, show);
          if (theme === "light") await expectLayout(page);
          await page.screenshot({ path: `${screenshotDir}/${theme}-${screen.name}-${show}.png` });
        }
      }
    });
  });
}

test("заглушка и готовая картинка одного размера; Enter открывает окно на этой картинке", async ({ page }) => {
  await open(page, "light", "loading");
  const placeholder = (await page.locator('[data-tile="loading"]').first().boundingBox())!;
  await open(page, "light", "three");
  const image = (await page.locator('[data-tile="ready"]').first().boundingBox())!;
  expect(Math.round(image.width)).toBe(Math.round(placeholder.width));
  expect(Math.round(image.height)).toBe(Math.round(placeholder.height));

  await page.getByRole("button", { name: "Открыть картинку: Маяк на рассвете" }).nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("2 из 3")).toBeVisible();
});

test("частичный сбой: упавшая подписана словами, «Стоп» — надписью", async ({ page }) => {
  await open(page, "light", "partial");
  await expect(page.locator('[data-tile="failed"]')).toContainText("Картинка не создалась");
  await expect(page.getByText("Создание остановлено")).toBeVisible();
});
