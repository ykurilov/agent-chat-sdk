import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/*
 * T029 плана 026: скин песочницы Тандем — журнал из трёх записей с раскрытым обращением, редактор инструкции, редактор
 * ответа с JSON результата, правленый ответ с отметками; светлая и тёмная тема — снимками; компьютер и узкий экран 320 px.
 * Снимки лежат в /tmp/agent-chat-skin-sandbox для просмотра глазами (эталонных снимков нет).
 */

const screenshotDir = "/tmp/agent-chat-skin-sandbox";
mkdirSync(screenshotDir, { recursive: true });

async function open(page: Page, theme: string, query = "") {
  await page.goto(`/sandbox.html?theme=${theme}&${query}`);
  await page.locator("main").waitFor();
  await page.evaluate(() => document.fonts.ready);
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const theme of ["light", "dark"] as const) {
  test(`${theme}, компьютер: чат и журнал рядом`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, theme);
    const journal = page.getByRole("region", { name: "Журнал" });
    await expect(journal).toBeVisible();
    await expect(journal.getByRole("button", { expanded: true })).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Правка ответа" })).toBeVisible();
    await expect(page.getByText("Изменено человеком")).toBeVisible();
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${screenshotDir}/${theme}-desktop.png`, fullPage: true });
  });

  test(`${theme}, 320 px: журнал в выдвижной панели`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, theme);
    await expect(page.getByRole("region", { name: "Журнал" })).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${screenshotDir}/${theme}-phone-320-chat.png` });

    await page.getByRole("button", { name: "Открыть журнал" }).click();
    const panel = page.getByRole("dialog", { name: "Журнал" });
    await expect(panel).toBeVisible();
    // Панель выезжает плавно: снимок и замеры — когда переходы закончились.
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    await page.screenshot({ path: `${screenshotDir}/${theme}-phone-320-journal.png` });
  });
}

test("строки журнала раскрываются с клавиатуры", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "light");
  const row = page.getByRole("region", { name: "Журнал" }).getByRole("button", { name: /Поиск туров/ });
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Space");
  await expect(row).toHaveAttribute("aria-expanded", "false");
});
