import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { settleAnimations } from "../e2e/support/screen";

/*
 * T505 плана 016: голосовой режим скина Тандем в светлой и тёмной теме и на узком экране телефона.
 * Снимки лежат в /tmp/agent-chat-skin-dialog для просмотра глазами (эталонных снимков нет: шрифты зависят от машины).
 * Проверяется вёрстка: кнопки не меньше 44 пунктов, панель не выше нижней трети экрана, ничего не прокручивается.
 */

const screenshotDir = "/tmp/agent-chat-skin-dialog";
mkdirSync(screenshotDir, { recursive: true });

const themes = ["light", "dark"] as const;
const phones = [
  { name: "iphone-15", width: 393, height: 852 },
  { name: "small-phone", width: 320, height: 568 },
];

/** Самое тесное: длинная ошибка, озвучки нет, длинное имя голоса — всё это должно поместиться. */
const tightest = "state=error&error=microphone_missing&speech=0&voices=3";
const scenarios: Array<[string, string]> = [
  ["off", "state=off"],
  ["off-idle-reason", "state=off&error=idle"],
  ["connecting", "state=connecting&voices=3"],
  ["listening", "state=listening&level=0.7&voices=3"],
  ["thinking", "state=thinking&voices=3"],
  ["speaking", "state=speaking&voices=3"],
  ["interrupted", "state=interrupted&voices=3&cut=Завтра в Батуми будет солнечно"],
  ["error-denied", "state=error&error=microphone_denied"],
  ["error-missing-tightest", tightest],
  ["no-speech", "state=listening&level=0.3&speech=0"],
];

async function open(page: Page, theme: string, query: string) {
  await page.goto(`/?theme=${theme}&${query}`);
  await page.locator("main").waitFor();
  await page.evaluate(() => document.fonts.ready);
}

for (const theme of themes) {
  for (const phone of phones) {
    test.describe(`${theme}, ${phone.name}`, () => {
      test.use({ viewport: { width: phone.width, height: phone.height }, hasTouch: true, isMobile: true });

      for (const [name, query] of scenarios) {
        test(name, async ({ page }) => {
          await open(page, theme, query);
          await page.screenshot({ path: `${screenshotDir}/${theme}-${phone.name}-${name}.png` });

          // Ничего не вылезает за край и не прокручивается вбок.
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow, "страница шире экрана").toBeLessThanOrEqual(0);

          // Кнопки не меньше 44 пунктов.
          const controls = page.locator("main button:visible");
          for (const button of await controls.all()) {
            const box = (await button.boundingBox())!;
            const label = (await button.getAttribute("aria-label")) ?? (await button.textContent());
            // Кнопки чата вне голосового режима (копировать, микрофон диктовки) — не предмет этой проверки.
            if (!/Выйти|Голос|Голосовой режим/.test(label ?? "")) continue;
            expect(box.width, `«${label}» уже 44`).toBeGreaterThanOrEqual(44);
            expect(box.height, `«${label}» ниже 44`).toBeGreaterThanOrEqual(44);
          }

          // Панель режима не выше нижней трети экрана и без собственной прокрутки.
          const panel = page.locator("[data-state]").filter({ has: page.locator("[data-level]") });
          if (await panel.count()) {
            const box = (await panel.boundingBox())!;
            expect(box.height, "панель выше трети экрана").toBeLessThanOrEqual(phone.height / 3);
            expect(box.y + box.height, "панель ниже экрана").toBeLessThanOrEqual(phone.height);
            const scrolls = await panel.evaluate((element) => element.scrollHeight > element.clientHeight);
            expect(scrolls, "в панели появилась прокрутка").toBe(false);
            // Поля ввода в режиме нет.
            await expect(page.getByRole("textbox")).toHaveCount(0);
          }
        });
      }

      test("меню голосов открыто", async ({ page }) => {
        await open(page, theme, "state=listening&level=0.5&voices=5");
        await page.getByRole("button", { name: /^Голос:/ }).click();
        const items = page.getByRole("menuitemradio");
        await expect(items).toHaveCount(5);
        // Меню при открытии вырастает: мерить нужно после конца анимации.
        await settleAnimations(page);
        await page.screenshot({ path: `${screenshotDir}/${theme}-${phone.name}-menu-open.png` });
        for (const item of await items.all()) {
          const box = (await item.boundingBox())!;
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(phone.width);
        }
        await expect(items.first()).toHaveAttribute("aria-checked", "true");
      });
    });
  }

  test(`${theme}, компьютер: покой, режим, обрыв`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 700 });
    await open(page, theme, "state=off&voices=3");
    await page.screenshot({ path: `${screenshotDir}/${theme}-desktop-off.png` });
    await open(page, theme, "state=listening&level=0.6&voices=3&cut=Завтра в Батуми будет солнечно");
    await page.screenshot({ path: `${screenshotDir}/${theme}-desktop-listening.png` });
    await open(page, theme, "state=error&error=network&voices=3");
    await page.screenshot({ path: `${screenshotDir}/${theme}-desktop-error.png` });
  });
}
