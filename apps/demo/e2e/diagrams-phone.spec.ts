import { expect, test } from "@playwright/test";
import { send, signIn } from "./support/chat";
import { expectNoHorizontalOverflow } from "./support/screen";

/*
 * Схемы на узком экране (320 px): только то, что зависит от экрана. Логика окна проверена на компьютере (diagrams.spec.ts).
 */

test.use({ viewport: { width: 320, height: 640 } });

test("320 px: широкая схема прокручивается вбок, касание открывает окно, «назад» его закрывает", async ({ page }) => {
  await signIn(page);
  await send(page, "Нарисуй широкую схему");
  const ready = page.locator('[data-diagram="ready"]');
  await expect(ready).toBeVisible();

  // Схема шире ленты: прокручивается внутри себя, страница вбок не едет.
  const scroller = ready.locator("div.overflow-x-auto");
  await expect.poll(() => scroller.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeGreaterThan(0);
  await scroller.evaluate((node) => (node.scrollLeft = 120));
  expect(await scroller.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await expectNoHorizontalOverflow(page);

  const dialog = page.getByRole("dialog", { name: "схема на экране" });
  await ready.getByRole("button", { name: "Открыть схему" }).tap();
  await expect(dialog).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(ready).toBeVisible();
});
