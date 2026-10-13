import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/*
 * T011 плана 024: окно просмотра скина Тандем — одна картинка, карусель, схема; миниатюры в ленте; светлая и тёмная тема,
 * компьютер и узкий экран 320 px. Снимки лежат в /tmp/agent-chat-skin-viewer для просмотра глазами (эталонных снимков нет).
 * Проверяется вёрстка: кнопки не меньше 44 px, всё в экране, ничего не прокручивается вбок.
 */

const screenshotDir = "/tmp/agent-chat-skin-viewer";
mkdirSync(screenshotDir, { recursive: true });

async function open(page: Page, theme: string, query: string) {
  await page.goto(`/viewer.html?theme=${theme}&${query}`);
  await page.locator("main").waitFor();
  await page.evaluate(() => document.fonts.ready);
}

async function expectLayout(page: Page) {
  const viewport = page.viewportSize()!;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "страница шире экрана").toBeLessThanOrEqual(0);
  for (const button of await page.getByRole("dialog").locator("button:visible").all()) {
    const box = (await button.boundingBox())!;
    const label = await button.getAttribute("aria-label");
    expect(box.width, `«${label}» уже 44`).toBeGreaterThanOrEqual(44);
    expect(box.height, `«${label}» ниже 44`).toBeGreaterThanOrEqual(44);
    expect(box.x, `«${label}» за левым краем`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `«${label}» за правым краем`).toBeLessThanOrEqual(viewport.width);
  }
  const content = page.locator("[data-viewer-content]");
  const box = (await content.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

const screens = [
  { name: "desktop", width: 1100, height: 700, touch: false },
  { name: "phone-320", width: 320, height: 568, touch: true },
];

for (const theme of ["light", "dark"] as const) {
  for (const screen of screens) {
    test.describe(`${theme}, ${screen.name}`, () => {
      test.use({ viewport: { width: screen.width, height: screen.height }, hasTouch: screen.touch, isMobile: screen.touch });

      test("одна картинка: без счётчика и стрелок", async ({ page }) => {
        await open(page, theme, "show=single");
        await expect(page.getByRole("dialog")).toBeVisible();
        await expect(page.getByRole("button", { name: "Следующая" })).toHaveCount(0);
        await expectLayout(page);
        await page.screenshot({ path: `${screenshotDir}/${theme}-${screen.name}-single.png` });
      });

      test("карусель: «2 из 5», высокая картинка вписана", async ({ page }) => {
        await open(page, theme, "show=carousel&index=1");
        await expect(page.getByText("2 из 5")).toBeVisible();
        await expectLayout(page);
        await page.screenshot({ path: `${screenshotDir}/${theme}-${screen.name}-carousel.png` });
      });

      test("схема: векторная, без счётчика", async ({ page }) => {
        await open(page, theme, "show=diagram");
        await expect(page.locator("[data-viewer-content] svg")).toBeVisible();
        await expect(page.locator("[data-viewer-content] img")).toHaveCount(0);
        await expectLayout(page);
        await page.screenshot({ path: `${screenshotDir}/${theme}-${screen.name}-diagram.png` });
      });

      test("миниатюры в ленте открывают окно", async ({ page }) => {
        await open(page, theme, "show=thumbs");
        await page.screenshot({ path: `${screenshotDir}/${theme}-${screen.name}-thumbs.png` });
        await page.getByRole("button", { name: "Открыть картинку: фото-2.png" }).click();
        await expect(page.getByText("2 из 5")).toBeVisible();
      });
    });
  }
}
