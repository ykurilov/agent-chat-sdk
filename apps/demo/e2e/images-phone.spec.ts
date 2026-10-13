import { expect, test } from "@playwright/test";
import { send, signIn } from "./support/chat";
import { expectNoHorizontalOverflow } from "./support/screen";

/*
 * Картинки агента на узком экране (320 px): сетка не вылезает, свайп листает картинки в окне просмотра.
 * Остальное проверено на компьютере (images.spec.ts).
 */

test.use({ viewport: { width: 320, height: 640 } });

test("320 px: картинки в сетке, свайп листает окно просмотра", async ({ page }) => {
  await signIn(page);
  await send(page, "Нарисуй три картинки");
  const ready = page.locator('[data-tile="ready"]');
  await expect(ready).toHaveCount(2);
  await expectNoHorizontalOverflow(page);

  await ready.first().tap();
  const viewer = page.getByRole("dialog");
  await expect(viewer.getByText("1 из 2")).toBeVisible();

  // Свайп пальцем: влево — следующая, вправо — предыдущая.
  const swipe = async (from: number, to: number) => {
    await page.mouse.move(from, 320);
    await page.mouse.down();
    await page.mouse.move((from + to) / 2, 320, { steps: 4 });
    await page.mouse.move(to, 320, { steps: 4 });
    await page.mouse.up();
  };
  await swipe(260, 60);
  await expect(viewer.getByText("2 из 2")).toBeVisible();
  await swipe(60, 260);
  await expect(viewer.getByText("1 из 2")).toBeVisible();

  await page.goBack();
  await expect(viewer).toHaveCount(0);
});
