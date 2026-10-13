import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/*
 * T015 плана 021: панель агента скина Тандем в светлой и тёмной теме — открыта, закрыта, со списком поверх чата, на узком экране.
 * Снимки лежат в /tmp/agent-chat-skin-panel для просмотра глазами (эталонных снимков нет: шрифты зависят от машины).
 */

const screenshotDir = "/tmp/agent-chat-skin-panel";
mkdirSync(screenshotDir, { recursive: true });

async function open(page: Page, theme: string, query = "") {
  await page.goto(`/panel.html?theme=${theme}&${query}`);
  await page.locator("main").waitFor();
  await page.evaluate(() => document.fonts.ready);
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test("компьютер: закрыта, открыта, список поверх", async ({ page }) => {
      await page.setViewportSize({ width: 1100, height: 700 });
      await open(page, theme, "open=0");
      await expect(page.getByRole("complementary")).toHaveCount(0);
      await page.screenshot({ path: `${screenshotDir}/${theme}-desktop-closed.png` });

      await open(page, theme, "busy=1");
      const panel = page.getByRole("complementary", { name: "Панель агента" });
      expect((await panel.boundingBox())!.width).toBe(420);
      await page.screenshot({ path: `${screenshotDir}/${theme}-desktop-open.png` });

      // Без затемнения: кнопка страницы под страницей кликается, пока панель открыта.
      await page.locator("[data-page-button]").click();
      await expect(page.locator("[data-page-button]")).toContainText("1");

      await page.getByRole("button", { name: "Чаты" }).click();
      await expect(page.getByText("Про Грецию").first()).toBeVisible();
      await page.screenshot({ path: `${screenshotDir}/${theme}-desktop-list.png` });
      await page.getByRole("button", { name: "К чату" }).click();
      await expect(page.getByRole("textbox")).toBeVisible();
    });

    test("режим push и своя ширина", async ({ page }) => {
      await page.setViewportSize({ width: 1100, height: 700 });
      await open(page, theme, "mode=push&width=360");
      expect((await page.getByRole("complementary").boundingBox())!.width).toBe(360);
      await page.screenshot({ path: `${screenshotDir}/${theme}-desktop-push.png` });
    });

    for (const phone of [
      { name: "iphone-15", width: 393, height: 852 },
      { name: "small-phone", width: 320, height: 568 },
    ]) {
      test(`телефон ${phone.name}: на весь экран, «Закрыть» видна, без прокрутки вбок`, async ({ page }) => {
        await page.setViewportSize({ width: phone.width, height: phone.height });
        for (const [name, query] of [
          ["open", ""],
          ["list", "list=1"],
        ]) {
          await open(page, theme, query);
          const box = (await page.getByRole("complementary").boundingBox())!;
          expect(box.width).toBe(phone.width);
          expect(box.height).toBe(phone.height);
          const close = page.getByRole("complementary").getByRole("button", { name: "Закрыть панель агента" });
          await expect(close).toBeVisible();
          const closeBox = (await close.boundingBox())!;
          expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(phone.width);
          expect(closeBox.width).toBeGreaterThanOrEqual(44);
          expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
          await page.screenshot({ path: `${screenshotDir}/${theme}-${phone.name}-${name}.png` });
        }
      });
    }
  });
}
