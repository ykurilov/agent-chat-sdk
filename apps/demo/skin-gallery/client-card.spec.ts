import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/*
 * Этап 8 плана 058: экран карточки клиента в скине Тандем рядом с экраном памяти. Один сквозной сценарий (стереть поле,
 * «Стереть всё» с подтверждением), светлая и тёмная тема снимками, телефон — узкая вёрстка и касание.
 * Снимки лежат в /tmp/client-card-shots для просмотра глазами (эталонных снимков нет).
 */

const screenshotDir = "/tmp/client-card-shots";
mkdirSync(screenshotDir, { recursive: true });

async function open(page: Page, theme: string, state = "ready") {
  await page.goto(`/client-card.html?theme=${theme}&state=${state}`);
  await page.evaluate(() => document.fonts.ready);
}

const card = (page: Page) => page.getByRole("region", { name: "Что агент знает о вас" });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("сценарий: поля по порядку, стереть одно, «Стереть всё» с подтверждением", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "light");

  const items = card(page).getByRole("listitem");
  await expect(items).toHaveCount(5);
  await expect(items.nth(0)).toContainText("Имя");
  await expect(items.nth(0)).toContainText("Ольга");
  await expect(items.nth(0)).toContainText("обновлено 10.10.2026");
  // Порядок полей — порядок важности сценария, а не порядок записи.
  await expect(items.nth(4)).toContainText("Откуда приходят люди");
  await expect(items.nth(3)).toContainText("может быть уже не так");
  await expect(items.nth(4)).toContainText("может быть уже не так");
  await expect(items.nth(0)).not.toContainText("может быть уже не так");
  // Рядом — экран памяти.
  await expect(page.getByRole("heading", { name: /память/i }).first()).toBeVisible();
  await page.screenshot({ path: `${screenshotDir}/light-desktop.png` });

  await items.nth(0).getByRole("button", { name: /Стереть/ }).click();
  await expect(items).toHaveCount(4);
  await expect(card(page)).not.toContainText("Ольга");

  await card(page).getByRole("button", { name: "Стереть всё" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Вернуть не получится");
  await page.screenshot({ path: `${screenshotDir}/light-confirm.png` });
  await dialog.getByRole("button", { name: "Отмена" }).click();
  await expect(items).toHaveCount(4);

  await card(page).getByRole("button", { name: "Стереть всё" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Стереть", exact: true }).click();
  await expect(card(page)).toContainText("Агент пока ничего о вас не запомнил.");
  await expect(card(page).getByRole("button", { name: "Стереть всё" })).toHaveCount(0);
  await page.screenshot({ path: `${screenshotDir}/light-empty.png` });
});

test("ошибка загрузки: «Повторить» загружает карточку", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "light", "failed");
  await expect(card(page)).toContainText("Не получилось загрузить");
  await page.screenshot({ path: `${screenshotDir}/light-failed.png` });
  await card(page).getByRole("button", { name: "Повторить" }).click();
  await expect(card(page).getByRole("listitem")).toHaveCount(5);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}, компьютер: экран карточки рядом с памятью`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, theme);
    await expect(card(page).getByRole("listitem")).toHaveCount(5);
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${screenshotDir}/${theme}-pair.png` });
  });
}

test.describe("телефон", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme}: узкая вёрстка без сдвига вбок, стирание касанием`, async ({ page }) => {
      await open(page, theme);
      const items = card(page).getByRole("listitem");
      await expect(items).toHaveCount(5);
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
      await card(page).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${screenshotDir}/${theme}-phone.png` });
      await items.nth(0).getByRole("button", { name: /Стереть/ }).tap();
      await expect(items).toHaveCount(4);
      await card(page).getByRole("button", { name: "Стереть всё" }).tap();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${screenshotDir}/${theme}-phone-confirm.png` });
    });
  }
});
